import { useEffect, useRef, useState } from 'react';
import {
  staffColorPresets, createColorPreset, updateColorPreset, deleteColorPreset,
  type ColorPreset,
} from '../../api';
import { applyColor } from '../../render/color';
import { DEFAULT_COLOR } from '../../core/types';
import type { ColorState } from '../../core/types';
import { useDialog } from './useDialog';

/**
 * Tạo bộ chỉnh màu dùng lại được.
 *
 * Chỉnh trên một ảnh mẫu cho ưng ý rồi lưu thành bộ — những ảnh sau chỉ việc
 * chọn đúng bộ đó. Vì mọi thanh chạy -1..1 (không phụ thuộc ảnh cụ thể), bộ
 * số áp được cho MỌI ảnh về sau.
 *
 * Xem trước dùng CHÍNH applyColor của phần render, nên cái nhìn thấy ở đây
 * đúng bằng cái khách sẽ nhận.
 */

type SliderDef = { key: keyof ColorState; label: string };

/** Nhóm theo cách Lightroom xếp — đúng thứ tự người ta quen chỉnh. */
const GROUPS: Array<{ title: string; items: SliderDef[] }> = [
  {
    title: 'Ánh sáng',
    items: [
      { key: 'exposure', label: 'Phơi sáng' },
      { key: 'contrast', label: 'Tương phản' },
      { key: 'highlights', label: 'Vùng sáng' },
      { key: 'shadows', label: 'Vùng tối' },
      { key: 'white', label: 'Điểm trắng' },
      { key: 'black', label: 'Điểm đen' },
      { key: 'brightness', label: 'Độ sáng' },
    ],
  },
  {
    title: 'Màu sắc',
    items: [
      { key: 'temperature', label: 'Nhiệt độ' },
      { key: 'tint', label: 'Sắc thái' },
      { key: 'vibrance', label: 'Rực màu' },
      { key: 'saturation', label: 'Bão hoà' },
    ],
  },
  {
    title: 'Chi tiết',
    items: [
      { key: 'clarity', label: 'Độ nét' },
      { key: 'smoothSkin', label: 'Mịn da' },
    ],
  },
];

const num = (v: unknown) => (typeof v === 'number' ? v : 0);

const countChanged = (p: Record<string, unknown>) =>
  Object.entries(p).filter(([k, v]) => k !== 'presetId' && v !== 0).length;

export default function ColorPanel() {
  const [presets, setPresets] = useState<ColorPreset[]>([]);
  const [params, setParams] = useState<ColorState>({ ...DEFAULT_COLOR });
  const [editing, setEditing] = useState<string | null>(null);
  const [sample, setSample] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const { ask, dialog } = useDialog();

  const reload = () =>
    staffColorPresets().then((r) => setPresets(r.presets)).catch(() => {});

  useEffect(() => { reload(); }, []);

  // Blob URL của ảnh mẫu phải thu hồi, không thì đổi ảnh nhiều lần sẽ rò bộ nhớ
  useEffect(() => () => { if (sample) URL.revokeObjectURL(sample); }, [sample]);

  /** Vẽ lại ảnh xem trước mỗi khi thông số đổi. */
  useEffect(() => {
    const img = imgRef.current;
    const cv = canvasRef.current;
    if (!img || !cv) return;

    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);

    const data = ctx.getImageData(0, 0, cv.width, cv.height);
    applyColor(data, params);
    ctx.putImageData(data, 0, 0);
  }, [params, sample]);

  function onPickSample(file: File | undefined) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const cv = canvasRef.current;
      if (cv) {
        // Xem trước ở cỡ vừa phải: kéo thanh vẫn mượt mà đủ thấy khác biệt
        const k = Math.min(1, 520 / Math.max(img.width, img.height));
        cv.width = Math.round(img.width * k);
        cv.height = Math.round(img.height * k);
      }
      imgRef.current = img;
      setSample(url);
    };
    img.src = url;
    if (fileInput.current) fileInput.current.value = '';
  }

  const set = (k: keyof ColorState, v: number) =>
    setParams((p) => ({ ...p, [k]: v }));

  const reset = () => setParams({ ...DEFAULT_COLOR });

  function onSave() {
    ask({
      title: editing ? 'Lưu đè bộ chỉnh này?' : 'Lưu bộ chỉnh mới',
      input: editing
        ? undefined
        : { label: 'Tên bộ chỉnh', value: '', placeholder: 'Ví dụ: Tone quán' },
      message: editing ? 'Ghi đè thông số cũ bằng thông số đang chỉnh.' : undefined,
      confirmLabel: 'Lưu',
      onConfirm: async (label) => {
        setBusy('Đang lưu...');
        try {
          if (editing) await updateColorPreset(editing, { params });
          else await createColorPreset(label, params);
          setEditing(null);
          await reload();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Không lưu được');
        } finally {
          setBusy('');
        }
      },
    });
  }

  function load(p: ColorPreset) {
    setParams({ ...DEFAULT_COLOR, ...(p.params as unknown as ColorState) });
    setEditing(p.id);
  }

  function onDelete(p: ColorPreset) {
    ask({
      title: `Xoá bộ "${p.label}"?`,
      message: 'Khách sẽ không chọn được bộ này nữa. Không khôi phục lại được.',
      confirmLabel: 'Xoá',
      danger: true,
      onConfirm: async () => {
        await deleteColorPreset(p.id);
        if (editing === p.id) setEditing(null);
        reload();
      },
    });
  }

  const changed = countChanged(params as unknown as Record<string, unknown>);

  return (
    <div className="frames-panel">
      <div className="frames-head">
        <div>
          <h2>Bộ chỉnh màu</h2>
          <p className="muted small">
            {presets.length} bộ · {presets.filter((p) => p.enabled).length} đang cho khách chọn
          </p>
        </div>
        <div>
          <input
            ref={fileInput} type="file" accept="image/*" hidden
            onChange={(e) => onPickSample(e.target.files?.[0])}
          />
          <button className="ghost" onClick={() => fileInput.current?.click()}>
            {sample ? 'Đổi ảnh mẫu' : '+ Chọn ảnh mẫu'}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="color-work">
        <div className="color-preview">
          {sample ? (
            <canvas ref={canvasRef} />
          ) : (
            <p className="muted small">
              Chọn một ảnh mẫu để thấy ngay thông số ăn thế nào.
            </p>
          )}
        </div>

        <div className="color-sliders">
          {GROUPS.map((g) => (
            <div key={g.title} className="color-group">
              <span className="field-label">{g.title}</span>
              {g.items.map((s) => (
                <label key={s.key} className="slider">
                  <span>{s.label}</span>
                  <input
                    type="range" min={-1} max={1} step={0.01}
                    value={num(params[s.key])}
                    onChange={(e) => set(s.key, Number(e.target.value))}
                  />
                  <b>
                    {num(params[s.key]) === 0
                      ? '—'
                      : (num(params[s.key]) > 0 ? '+' : '') +
                        Math.round(num(params[s.key]) * 100)}
                  </b>
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="color-actions">
        <button className="primary" disabled={!!busy || changed === 0} onClick={onSave}>
          {busy || (editing ? 'Lưu đè' : 'Lưu thành bộ mới')}
        </button>
        <button className="ghost" onClick={reset}>Đặt lại</button>
        {editing && (
          <button className="ghost" onClick={() => { setEditing(null); reset(); }}>
            Thôi sửa
          </button>
        )}
      </div>

      <div className="preset-list">
        {presets.map((p) => (
          <div key={p.id} className={p.enabled ? 'preset-row' : 'preset-row off'}>
            <b>{p.label}</b>
            <span className="muted small">
              {countChanged(p.params as unknown as Record<string, unknown>)} thanh
            </span>
            <span className="preset-acts">
              <button className="link" onClick={() => load(p)}>Sửa</button>
              <button
                className="link"
                onClick={async () => {
                  await updateColorPreset(p.id, { enabled: !p.enabled });
                  reload();
                }}
              >
                {p.enabled ? 'Tắt' : 'Bật'}
              </button>
              <button className="link danger" onClick={() => onDelete(p)}>Xoá</button>
            </span>
          </div>
        ))}
        {presets.length === 0 && (
          <p className="muted" style={{ padding: 16, textAlign: 'center' }}>
            Chưa có bộ nào. Kéo các thanh bên trên rồi bấm &quot;Lưu thành bộ mới&quot;.
          </p>
        )}
      </div>

      {dialog}
    </div>
  );
}
