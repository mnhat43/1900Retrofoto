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

/** inch -> cm, một số lẻ, dấu phẩy thập phân như cách viết ở Việt Nam. */
const cm = (inch: number) => (inch * 2.54).toFixed(1).replace('.', ',');

/**
 * Xem thử khung như khách sẽ thấy: ảnh lọt qua các lỗ, khung đè lên trên.
 *
 * Vì sao cần: màn nắn ô vẽ ô thành nét đứt ĐÈ LÊN khung, tức là ngược hẳn thứ
 * tự lúc render thật. Nhìn nó thì biết ô nằm đâu, nhưng không biết tấm ảnh
 * cuối cùng ra sao — mà đó mới là thứ khách nhận.
 *
 * Xếp lớp bằng CSS chứ không vẽ canvas: khung đã là PNG có lỗ trong suốt sẵn,
 * nên chỉ cần đặt các ô ảnh mẫu XUỐNG DƯỚI rồi phủ ảnh khung lên trên là ra
 * đúng kết quả, không phải nạp bitmap hay dựng lại phép ghép.
 *
 * Ảnh mẫu là dải màu chuyển, mỗi ô một sắc: đủ để thấy "chỗ này lọt ảnh" và
 * phân biệt được các ô, mà không giả vờ là ảnh thật của khách.
 */
function XemThu({ src, slots, ratio }: {
  src: string;
  slots: Array<{ x: number; y: number; w: number; h: number }>;
  ratio: number;
}) {
  return (
    <div className="frame-try" style={{ aspectRatio: `${ratio}` }}>
      {slots.map((s, i) => {
        const h = (i * 47 + 18) % 360;
        return (
          <span
            key={i}
            className="frame-try-o"
            style={{
              left: `${s.x * 100}%`,
              top: `${s.y * 100}%`,
              width: `${s.w * 100}%`,
              height: `${s.h * 100}%`,
              background: `linear-gradient(150deg, hsl(${h} 58% 78%), hsl(${h} 42% 58%))`,
            }}
          />
        );
      })}
      {/* Khung phủ lên trên cùng — đúng thứ tự lúc render thật */}
      <img src={src} alt="" draggable={false} />
    </div>
  );
}

export default function FramesPanel() {
  const [frames, setFrames] = useState<ApiFrame[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
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
        <div className="frames-head-actions">
          {/*
            CHỈ các định dạng giữ được vùng trong suốt. KHÔNG có JPG: định
            dạng đó không lưu được độ trong suốt, mà cả cơ chế khung dựa vào
            đúng thứ đó để biết lỗ nằm ở đâu. Để JPG lọt vào hộp chọn file chỉ
            khiến nhân viên chọn rồi nhận lỗi.
          */}
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/webp,image/avif,image/gif"
            hidden
            onChange={(e) => onPick(e.target.files?.[0])}
          />
          <button className="ghost" onClick={() => setHelpOpen(true)}>
            Cách chuẩn bị file
          </button>
          <button className="primary" disabled={!!busy}
            onClick={() => fileInput.current?.click()}>
            {busy || '+ Tải khung lên'}
          </button>
        </div>
      </div>

      {/*
        Hướng dẫn để trong MODAL, không phải khối gập/mở giữa trang.

        Để giữa trang thì lúc mở nó ăn hết chiều cao còn lại và thư viện khung
        chỉ còn ~110px. Mà thư viện là vùng duy nhất cuộn được, nên coi như
        mất luôn đường xem các khung phía dưới.
      */}
      {helpOpen && (
        <div className="modal" onClick={() => setHelpOpen(false)}>
          <div
            className="modal-inner frame-help"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>Cách chuẩn bị file khung ảnh</h2>
              <button className="ghost" onClick={() => setHelpOpen(false)}>
                Đóng
              </button>
            </header>

            {/*
              Phần mở đầu trải ngang cả khối, không nhét vào cột: đây là đoạn
              dài nhất, nhét vào cột hẹp thì nó xuống dòng sáu lần.
            */}
            <p className="frame-help-lead">
              Khung ảnh <b>không phải một tấm ảnh kín</b> — nó là tấm{' '}
              <b>có lỗ</b>. Hoa văn, chữ, viền nằm ở ngoài; chỗ để ảnh khách
              hiện ra phải <b>trống rỗng</b>, tức là <b>nền trong suốt</b>.
            </p>
            <p className="frame-help-lead2">
              Chỗ hay nhầm: <b>“trong suốt” khác “màu trắng”</b> — trắng vẫn là
              một màu, vẫn phủ kín. Nên đuôi <b>.png</b> cũng chưa chắc đúng:
              lúc xuất mà quên tắt nền thì bạn được file .png nền trắng bịt
              kín, và phần mềm sẽ từ chối y như JPG.
            </p>

            <div className="frame-help-cols">
              <section>
                <h4>Nhận file gì</h4>
                <p>
                  <b>PNG, WebP, AVIF, GIF</b> — miễn là file còn giữ vùng trong
                  suốt. Phần mềm tự dò ra các lỗ và đánh số sẵn cho bạn.
                </p>
                <p className="frame-help-no">
                  <b>Không nhận JPG.</b> Không phải do phần mềm chặn, mà do
                  định dạng JPG không lưu được vùng trong suốt — file JPG luôn
                  đặc kín nên không có lỗ nào.
                </p>
              </section>

              <section>
                <h4>Xuất file cho đúng</h4>
                <ul>
                  <li>
                    <b>Canva:</b> Share → Download → PNG → tick{' '}
                    <b>Transparent background</b> (cần Canva Pro)
                  </li>
                  <li><b>Figma:</b> xoá Fill của frame → Export → PNG</li>
                  <li>
                    <b>Photoshop:</b> xoá layer Background → File → Export As →
                    PNG → tick <b>Transparency</b>
                  </li>
                  <li>
                    <b>Illustrator:</b> File → Export As → PNG → Background:{' '}
                    <b>Transparent</b>
                  </li>
                </ul>
              </section>

              <section>
                <h4>Kích thước nên xuất (300 DPI)</h4>
                <ul>
                  <li>Dải dọc 3–4 ô · khổ 2×6 inch → <b>600 × 1800 px</b></li>
                  <li>Tờ 6 ô · khổ 4×6 inch → <b>1200 × 1800 px</b></li>
                  <li>Tờ vuông 9 ô · khổ 6×6 inch → <b>1800 × 1800 px</b></li>
                </ul>
                <p className="muted small">
                  Xuất to hơn vẫn tốt. Nhỏ hơn thì in ra rỗ.
                </p>
              </section>
            </div>

            <p className="frame-help-kiem">
              <b>Cách kiểm nhanh:</b> mở file trong phần mềm thiết kế, chỗ đặt
              ảnh khách phải hiện ra <b>ô caro</b> — giống hoa văn phía sau các
              khung trong thư viện. Thấy ô caro là đúng; thấy màu trắng phẳng
              là chưa được.
            </p>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {enabledCount === 0 && frames.length > 0 && (
        <p className="warn-box">
          Không có khung nào đang bật — khách sẽ không ghép được ảnh.
        </p>
      )}

      {/*
        Xem trước kết quả dò trước khi lưu — trong MODAL.
        Để inline giữa trang thì thẻ này cao hơn cả vùng còn lại, đẩy thư viện
        khung ra khỏi màn mà không có gì cuộn được.

        KHÔNG đóng khi bấm nền: một cú bấm chệch là mất cả tên vừa gõ và các ô
        vừa nắn. Chỉ nút Huỷ mới đóng.
      */}
      {pending && (
        <div className="modal">
          <div className="modal-inner frame-modal">
            <header>
              <h2>Khung mới</h2>
            </header>

            <div className="frame-preview">
              <SlotEditor
                src={pending.url}
                slots={pending.analysis.slots}
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

                {/*
                  Nhãn phải nói KHỔ GIẤY, không chỉ "khổ in": nhân viên không
                  đoán được con số này để làm gì, mà nó quyết định ảnh xuất ra
                  bao nhiêu pixel nên gõ sai là in ra sai cỡ.
                */}
                <label className="field-label">Khổ giấy in (inch)</label>
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

                {/*
                  Quy đổi ra cm vì inch không ai hình dung ra được: "2×6 inch"
                  không nói lên gì, "5,1 × 15,2 cm" thì đo được bằng thước ngay
                  trên tờ giấy ảnh đang dùng ở quán.
                */}
                <p className="muted small">
                  Tờ ảnh in ra sẽ to <b>{cm(pending.analysis.widthInch)} ×{' '}
                  {cm(pending.analysis.heightInch)} cm</b>, tức{' '}
                  {Math.round(pending.analysis.widthInch * 300)}×
                  {Math.round(pending.analysis.heightInch * 300)}px ở 300 DPI.
                </p>
                <p className="muted small">
                  File khung {pending.analysis.width}×{pending.analysis.height}px.
                  Kiểm tra các ô đánh số có trùng lỗ trên khung không rồi hãy lưu.
                </p>

                {pending.analysis.slots.length === 0 && (
                  <p className="warn-box small">
                    Chưa có ô nào — khách sẽ không có chỗ đặt ảnh. Kéo trên ảnh để
                    vẽ lại ô.
                  </p>
                )}

                {/*
                  Xem thử đặt ở ĐÁY CỘT PHẢI, chỗ trước đây bỏ trống.
                  Cột ảnh bên trái luôn cao hơn cột chữ (khung dải dọc cao gấp
                  ba bề rộng), nên chỗ này vốn là khoảng trắng thừa. Nhét bản
                  xem thử vào vừa lấp được nó, vừa cho hai cách nhìn cạnh nhau:
                  bên trái là ô đang nắn, bên phải là thứ khách sẽ nhận.
                */}
                {pending.analysis.slots.length > 0 && (
                  <div className="frame-try-wrap">
                    <span className="field-label">Khách sẽ thấy thế này</span>
                    <XemThu
                      src={pending.url}
                      slots={pending.analysis.slots}
                      ratio={pending.analysis.width / pending.analysis.height}
                    />
                    <span className="muted small">
                      Vùng màu là chỗ ảnh khách lọt qua
                    </span>
                  </div>
                )}
              </div>

              {/*
                Thanh hành động trải ngang CẢ HAI CỘT, không nhét vào cột phải.
                Cột ảnh cao hơn cột chữ nhiều (khung dải dọc cao gấp ba bề rộng),
                nên nút nằm trong cột phải thì bị đẩy xuống đáy cột và lửng lơ
                giữa một khoảng trắng lớn. Trải ngang thì nút luôn ở đúng một chỗ,
                và thứ tự đọc thành: xem ảnh -> điền tên -> bấm lưu.
              */}
            </div>

            {/*
              Thanh nút là FOOTER của modal, tách bằng đường kẻ.
              Dùng lại quy ước .dialog-actions của app: Huỷ bên trái, hành
              động chính bên phải, cùng cỡ và cùng đường chân.
            */}
            <div className="preview-actions">
              <button className="ghost" disabled={!!busy} onClick={() => {
                URL.revokeObjectURL(pending.url);
                setPending(null);
              }}>
                Huỷ
              </button>
              <button
                className="primary"
                disabled={!!busy || !pending.label.trim()
                  || pending.analysis.slots.length === 0}
                onClick={onSave}
              >
                {busy || 'Lưu khung'}
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
