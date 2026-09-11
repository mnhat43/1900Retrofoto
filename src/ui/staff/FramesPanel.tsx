import { useEffect, useRef, useState } from 'react';
import {
  staffFrames, analyzeFrame, uploadFrame, updateFrame, deleteFrame,
  type ApiFrame, type FrameAnalysis,
} from '../../api';
import { useDialog } from './useDialog';
import SlotEditor from './SlotEditor';
import { frameSizeLabel } from '../../core/format';

/**
 * Quản lý thư viện khung ảnh.
 *
 * Luồng tải lên: chọn file -> server dò các lỗ trong suốt -> HIỆN XEM TRƯỚC
 * để nhân viên kiểm tra -> lưu. Bước xem trước là quan trọng: dò sai mà lưu
 * thẳng thì khách sẽ thấy khung hỏng, còn ở đây thì chỉ việc bấm huỷ.
 */

type Pending = {
  file: File;
  url: string;
  analysis: FrameAnalysis;
  label: string;
};

/** Khớp giới hạn của server — 12in ở 300 DPI vẫn dưới trần canvas iOS. */
const MIN_INCH = 1;
const MAX_INCH = 12;

const round2 = (v: number) => Math.round(v * 100) / 100;

export default function FramesPanel() {
  const [frames, setFrames] = useState<ApiFrame[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const { ask, dialog } = useDialog();

  const enabledCount = frames.filter((f) => f.enabled).length;

  /** Đặt thẳng một chiều, không đụng chiều kia. */
  function setInch(key: 'widthInch' | 'heightInch', v: number) {
    if (!pending) return;
    setPending({ ...pending, analysis: { ...pending.analysis, [key]: v } });
  }

  /**
   * Tính lại chiều cao cho khớp tỉ lệ FILE ẢNH, giữ nguyên chiều rộng.
   *
   * Khai tỉ lệ khác tỉ lệ file thì in ra ảnh bị kéo méo, nên phải có đường
   * quay về nhanh sau khi nhân viên gõ tay.
   */
  function fitRatio() {
    if (!pending) return;
    const a = pending.analysis;
    setPending({
      ...pending,
      analysis: { ...a, heightInch: round2(a.widthInch / (a.width / a.height)) },
    });
  }

  // Sai quá 2% thì mắt thường đã thấy méo
  const ratioOff = !!pending && Math.abs(
    pending.analysis.widthInch / pending.analysis.heightInch
    - pending.analysis.width / pending.analysis.height,
  ) > 0.02;

  const reload = () => staffFrames().then((r) => setFrames(r.frames)).catch(() => {});

  useEffect(() => { reload(); }, []);

  // Blob URL của bản xem trước phải được thu hồi, nếu không mỗi lần chọn file
  // lại rò một ảnh trong bộ nhớ trình duyệt.
  useEffect(() => () => { if (pending) URL.revokeObjectURL(pending.url); }, [pending]);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError('');
    setBusy('Đang phân tích khung...');
    try {
      const analysis = await analyzeFrame(file);
      setPending({
        file,
        url: URL.createObjectURL(file),
        analysis,
        // Gợi ý tên từ tên file, bỏ đuôi — nhân viên sửa lại được
        label: file.name.replace(/\.[^.]+$/, ''),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không đọc được file khung');
    } finally {
      setBusy('');
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function onSave() {
    if (!pending) return;
    setBusy('Đang lưu...');
    try {
      await uploadFrame(pending.file, pending.label, {
        slots: pending.analysis.slots,
        formatId: pending.analysis.formatId,
        widthInch: pending.analysis.widthInch,
        heightInch: pending.analysis.heightInch,
      });
      URL.revokeObjectURL(pending.url);
      setPending(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được khung');
    } finally {
      setBusy('');
    }
  }

  async function onToggle(f: ApiFrame) {
    // Bật lại thì làm luôn — không có gì để mất, bấm nhầm thì tắt lại.
    if (!f.enabled) {
      await updateFrame(f.id, { enabled: true });
      reload();
      return;
    }
    // Tắt thì hỏi: khách đang chọn khung này sẽ không thấy nữa
    ask({
      title: `Tắt khung "${f.label}"?`,
      message:
        'Khách sẽ không chọn được khung này nữa. Bật lại bất cứ lúc nào.' +
        (enabledCount === 1
          ? '\nĐây là khung cuối cùng đang bật — tắt đi thì khách không ghép được ảnh.'
          : ''),
      confirmLabel: 'Tắt khung',
      onConfirm: async () => {
        await updateFrame(f.id, { enabled: false });
        reload();
      },
    });
  }

  function onRename(f: ApiFrame) {
    ask({
      title: 'Đổi tên khung',
      input: { label: 'Tên khung', value: f.label },
      confirmLabel: 'Lưu tên',
      onConfirm: async (label) => {
        if (label === f.label) return;
        await updateFrame(f.id, { label });
        reload();
      },
    });
  }

  function onDelete(f: ApiFrame) {
    ask({
      title: `Xoá khung "${f.label}"?`,
      message:
        'Khung sẽ biến mất khỏi danh sách của khách và không khôi phục lại được.\n' +
        'Ảnh khách đã ghép bằng khung này vẫn giữ nguyên.',
      confirmLabel: 'Xoá khung',
      danger: true,
      onConfirm: async () => {
        await deleteFrame(f.id);
        reload();
      },
    });
  }

  return (
    <div className="frames-panel">
      <div className="frames-head">
        <div>
          <h2>Khung ảnh</h2>
          <p className="muted small">
            {frames.length} khung · {enabledCount} đang cho khách chọn
          </p>
        </div>
        <div>
          {/*
            Nhận mọi loại ảnh. Ảnh có sẵn vùng trong suốt thì dò ô tự động;
            ảnh đặc (JPG...) thì nhân viên tự đặt ô và server khoét lỗ theo.
          */}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => onPick(e.target.files?.[0])}
          />
          <button className="primary" disabled={!!busy}
            onClick={() => fileInput.current?.click()}>
            {busy || '+ Tải khung lên'}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {enabledCount === 0 && frames.length > 0 && (
        <p className="warn-box">
          Không có khung nào đang bật — khách sẽ không ghép được ảnh.
        </p>
      )}

      {/* Xem trước kết quả dò trước khi lưu */}
      {pending && (
        <div className="frame-preview card">
          <SlotEditor
            src={pending.url}
            slots={pending.analysis.slots}
            ratio={pending.analysis.width / pending.analysis.height}
            onChange={(slots) => setPending({
              ...pending,
              analysis: { ...pending.analysis, slots },
            })}
          />

          <div className="preview-info">
            <label className="field-label">Tên khung</label>
            <input
              className="text-input"
              value={pending.label}
              onChange={(e) => setPending({ ...pending, label: e.target.value })}
            />

            <label className="field-label">Khổ in (inch)</label>
            <div className="size-row">
              <input
                className="text-input" type="number" step="0.25"
                min={MIN_INCH} max={MAX_INCH}
                value={pending.analysis.widthInch}
                onChange={(e) => setInch('widthInch', Number(e.target.value))}
              />
              <span>×</span>
              <input
                className="text-input" type="number" step="0.25"
                min={MIN_INCH} max={MAX_INCH}
                value={pending.analysis.heightInch}
                onChange={(e) => setInch('heightInch', Number(e.target.value))}
              />
              <button
                type="button"
                className="link"
                title="Tính lại chiều còn lại cho khớp tỉ lệ file"
                onClick={fitRatio}
              >
                Khớp tỉ lệ
              </button>
            </div>

            {/* Tỉ lệ khai khác tỉ lệ file -> in ra sẽ méo. Phải nói trước. */}
            {ratioOff && (
              <p className="warn-box small">
                Tỉ lệ khổ in khác tỉ lệ file ảnh — in ra ảnh sẽ bị kéo méo.
                Bấm “Khớp tỉ lệ” để sửa.
              </p>
            )}

            <p className="muted small">
              File {pending.analysis.width}×{pending.analysis.height}px · xuất ra{' '}
              {Math.round(pending.analysis.widthInch * 300)}×
              {Math.round(pending.analysis.heightInch * 300)}px ở 300 DPI.
            </p>
            {/*
              Hai đường vào màn này cần hai lời nhắc khác nhau. Khung đã có lỗ
              thì việc của nhân viên là ĐỐI CHIẾU ô với lỗ; khung đặc thì ô
              chính là thứ quyết định lỗ sẽ được khoét ở đâu — nói nhầm một
              câu là nhân viên làm nhầm việc.
            */}
            {pending.analysis.duc ? (
              <p className="muted small">
                Ảnh này không có sẵn vùng trong suốt, nên các ô bạn đặt sẽ được
                khoét thủng để ảnh khách hiện qua. Phần còn lại của khung giữ
                nguyên.
              </p>
            ) : (
              <p className="muted small">
                Kiểm tra các ô đánh số có trùng lỗ trên khung không rồi hãy lưu.
              </p>
            )}

            {pending.analysis.slots.length === 0 && (
              <p className="warn-box small">
                Chưa có ô nào — khách sẽ không có chỗ đặt ảnh. Kéo trên ảnh để
                vẽ ô, hoặc dùng nút xếp nhanh.
              </p>
            )}

            <div className="preview-actions">
              <button
                className="primary"
                disabled={!!busy || !pending.label.trim()
                  || pending.analysis.slots.length === 0}
                onClick={onSave}
              >
                {busy || 'Lưu khung'}
              </button>
              <button className="ghost" disabled={!!busy} onClick={() => {
                URL.revokeObjectURL(pending.url);
                setPending(null);
              }}>
                Huỷ
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="frame-list">
        {frames.map((f) => (
          <div key={f.id} className={f.enabled ? 'frame-card' : 'frame-card off'}>
            <div className="frame-card-img">
              <img src={f.overlaySrc} alt={f.label} />
            </div>
            <div className="frame-card-body">
              <b>{f.label}</b>
              <span className="muted small">
                {f.slotCount} ô · {frameSizeLabel(f)}
                {f.builtin ? ' · mẫu' : ''}
              </span>
            </div>
            <div className="frame-card-actions">
              <button className="link" onClick={() => onToggle(f)}>
                {f.enabled ? 'Tắt' : 'Bật'}
              </button>
              <button className="link" onClick={() => onRename(f)}>Đổi tên</button>
              <button className="link danger" onClick={() => onDelete(f)}>Xoá</button>
            </div>
          </div>
        ))}

        {frames.length === 0 && (
          <p className="muted" style={{ padding: 20, textAlign: 'center' }}>
            Chưa có khung nào. Tải một file ảnh khung lên để bắt đầu.
          </p>
        )}
      </div>

      {dialog}
    </div>
  );
}
