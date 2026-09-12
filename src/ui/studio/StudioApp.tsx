import { useEffect, useState } from 'react';
import {
  guestSession, photoUrl, compositeUrl, saveComposite, listFrames, listColorPresets,
  type SessionInfo, type PhotoInfo, type CompositeInfo, type ApiFrame,
  type ColorPreset,
} from '../../api';
import { loadPhotosFromUrls, loadOverlay } from '../../media/assets';
import { framePx, type FormatId } from '../../core/format';
import { DEFAULT_COLOR, DEFAULT_CONTENT } from '../../core/types';
import type { ColorState, Frame, Photo, SlotContent } from '../../core/types';
import { exportStrip } from '../../render/export';
import { PRESETS } from '../../render/color';
import { resetContent } from '../../core/interaction';
import { clampContent, slackOf, slotRectPx, MIN_ZOOM, MAX_ZOOM } from '../../core/placement';
import { StripCanvas } from '../StripCanvas';
import './studio.css';

type Step = 'loading' | 'frame' | 'pick' | 'edit' | 'saved' | 'error';
type Tool = 'align' | 'color';

/**
 * Bước dịch mỗi lần bấm nút mũi tên, trên thang -1..1 của offset.
 * Đủ nhỏ để căn chính xác, đủ lớn để bấm một cái là thấy ảnh nhúc nhích.
 */
const NUDGE = 0.08;

/**
 * Khung từ server -> khung mà phần render dùng.
 *
 * Chỉ đổi kiểu, không đổi số: toạ độ ô đã chuẩn hoá 0..1 ở cả hai phía, nên
 * `drawStrip` và `exportStrip` không cần biết khung đến từ đâu.
 */
const toFrame = (f: ApiFrame): Frame => ({
  id: f.id,
  label: f.label,
  slotCount: f.slotCount,
  formatId: f.formatId as FormatId,
  widthInch: f.widthInch,
  heightInch: f.heightInch,
  overlaySrc: f.overlaySrc,
  slots: f.slots,
});

export default function StudioApp() {
  // /c/<token> ghép khung, /v/<token> chỉ xem
  const parts = location.pathname.split('/').filter(Boolean);
  const mode = parts[0] ?? 'c';
  const token = parts[1] ?? '';

  const [step, setStep] = useState<Step>('loading');
  const [error, setError] = useState('');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [available, setAvailable] = useState<PhotoInfo[]>([]);
  const [photos, setPhotos] = useState<Map<string, Photo>>(new Map());
  const [frames, setFrames] = useState<Frame[]>([]);
  const [shopPresets, setShopPresets] = useState<ColorPreset[]>([]);
  /** Bộ của quán đang chọn — tách riêng vì nó thay cả bộ thông số. */
  const [shopId, setShopId] = useState<string | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [contents, setContents] = useState<Map<string, SlotContent>>(new Map());
  const [color, setColor] = useState<ColorState>(DEFAULT_COLOR);
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState('');
  const [tool, setTool] = useState<Tool>('align');
  const [result, setResult] = useState<{ composite: CompositeInfo; blob: Blob } | null>(null);

  useEffect(() => {
    if (!token) { setError('Liên kết không hợp lệ'); setStep('error'); return; }
    // Tải phiên và thư viện khung song song — khung do nhân viên quản lý nên
    // phải hỏi server, không nằm sẵn trong mã nguồn nữa.
    Promise.all([guestSession(token), listFrames(), listColorPresets()])
      .then(([r, fr, cp]) => {
        setSession(r.session);
        setAvailable(r.photos);
        setFrames(fr.frames.map(toFrame));
        setShopPresets(cp.presets);
        if (r.photos.length === 0) {
          setError('Phiên này chưa có ảnh nào');
          setStep('error');
        } else {
          setStep(mode === 'v' ? 'pick' : 'frame');
        }
      })
      .catch((e) => { setError(e.message); setStep('error'); });
  }, [token, mode]);

  useEffect(() => {
    if (!frame) return;
    loadOverlay(frame.overlaySrc).then(setOverlay).catch(() => setOverlay(null));
  }, [frame]);

  function pickFrame(f: Frame) {
    setFrame(f);
    setChosen([]);
    setStep('pick');
  }

  function toggle(id: string) {
    if (!frame) return;
    setChosen((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= frame.slotCount) return cur;
      return [...cur, id];
    });
  }

  /** Tải ảnh đã chọn về máy khách rồi vào editor. */
  async function startEdit() {
    if (!frame || chosen.length !== frame.slotCount) return;
    setBusy('Đang tải ảnh...');
    try {
      const need = chosen.filter((id) => !photos.has(id));
      if (need.length) {
        const loaded = await loadPhotosFromUrls(
          need.map((id) => ({ url: photoUrl(id, token), id })),
          (d, t) => setBusy(`Đang tải ảnh ${d}/${t}...`),
        );
        setPhotos((cur) => {
          const next = new Map(cur);
          for (const p of loaded) next.set(p.id, p);
          return next;
        });
      }
      const next = new Map<string, SlotContent>();
      frame.slots.forEach((slot, i) => next.set(slot.id, DEFAULT_CONTENT(chosen[i])));
      setContents(next);
      // Chọn sẵn ô đầu tiên để bảng căn chỉnh không mở ra trong trạng thái trống.
      setActiveSlot(frame.slots[0].id);
      setTool('align');
      setStep('edit');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được ảnh');
      setStep('error');
    } finally {
      setBusy('');
    }
  }

  /** Render trên máy khách rồi gửi lên server. */
  async function onSave() {
    if (!frame) return;
    setBusy('Đang lưu...');
    try {
      const state = { frame, contents, photos, color };
      const blob = await exportStrip(state, overlay, 'png');
      const page = framePx(frame);
      const recipe = {
        frameId: frame.id,
        color,
        slots: [...contents.entries()].map(([slotId, c]) => ({
          slotId, photoId: c.photoId, zoom: c.zoom, offset: c.offset,
        })),
      };
      const r = await saveComposite(token, {
        frameId: frame.id, width: page.w, height: page.h, recipe, blob,
      });
      setResult({ composite: r.composite, blob });
      setStep('saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lưu thất bại');
      setStep('error');
    } finally {
      setBusy('');
    }
  }

  // ------------------------------------------------------------------
  // Đang tải / lỗi
  // ------------------------------------------------------------------

  if (step === 'loading') {
    return (
      <div className="studio">
        <div className="body center">
          <div className="loading">
            <div className="spinner" />
            <p className="muted">Đang tải ảnh của bạn...</p>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="studio">
        <div className="body center">
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Không mở được</h2>
            <p className="muted">{error}</p>
            <p className="muted small" style={{ marginTop: 12 }}>
              Liên kết chỉ dùng được khi điện thoại đang nối WiFi cửa hàng.
            </p>
            {session && (
              <button className="btn btn-ghost wide" style={{ marginTop: 16 }}
                onClick={() => location.reload()}>
                Thử lại
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Đã lưu xong
  // ------------------------------------------------------------------

  if (step === 'saved' && result) {
    return (
      // Khoá chiều cao để ảnh không đẩy phần nhắc nhở ra khỏi màn hình
      <div className="studio fixed">
        <div className="bar">
          <span className="brand">
            <span className="n">1900</span><span className="w">Retrofoto</span>
          </span>
        </div>

        <div className="body result-body">
          <div className="result-wrap">
            <img
              className="result"
              src={compositeUrl(result.composite.id, result.composite.slug)}
              alt="Dải ảnh đã ghép"
            />
          </div>
          <p className="tip">
            Trên iPhone: <b>bấm giữ vào ảnh</b> rồi chọn "Lưu vào ảnh"
          </p>
          <p className="warn">
            Hãy tải ảnh về máy <b>trước khi rời quán</b>
          </p>
        </div>

        {/* Chỉ còn một việc cần làm ở màn này: tải ảnh về. */}
        <div className="actions">
          {/*
            Tải bản SERVER dựng, không phải result.blob điện thoại tự ghép.
            Điện thoại ghép ở 300 DPI vì vướng trần canvas iOS; server dựng
            lại từ ảnh gốc ở 600 DPI. Tải nhầm blob là khách xem ảnh nét trên
            màn hình rồi nhận về bản mờ — mà ảnh hiện ngay bên trên chính là
            bản nét, nên không ai nghĩ là tải sai.
          */}
          <a
            className="btn btn-primary wide"
            href={compositeUrl(result.composite.id, result.composite.slug)}
            download={`photostrip-${session?.code ?? 'anh'}.png`}
          >
            Tải xuống
          </a>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Chọn khung
  // ------------------------------------------------------------------

  if (step === 'frame') {
    const usable = frames.filter((f) => f.slotCount <= available.length);
    return (
      <div className="studio fixed">
        <div className="bar">
          <span className="brand">
            <span className="n">1900</span><span className="w">Retrofoto</span>
          </span>
          <span className="meta">{available.length} ảnh</span>
        </div>
        <div className="body">
          {usable.length > 0 ? (
            <>
              <p className="lead">Chọn kiểu dải ảnh bạn muốn</p>
              <div className="scroll-area">
              <div className="frame-grid">
                {usable.map((f) => (
                  <button key={f.id} className="frame-item" onClick={() => pickFrame(f)}>
                    <span className="frame-thumb">
                      <img src={f.overlaySrc} alt={f.label} />
                    </span>
                    <b>{f.label}</b>
                    <span className="cnt">{f.slotCount} ảnh</span>
                  </button>
                ))}
              </div>
              </div>
            </>
          ) : (
            <div className="panel" style={{ margin: '40px auto' }}>
              <p className="muted" style={{ textAlign: 'center' }}>
                {/* Không còn khung nào bật -> đây là việc của nhân viên,
                    đừng bắt khách đoán. Math.min() của mảng rỗng ra Infinity
                    nên phải tách hẳn hai trường hợp. */}
                {frames.length === 0
                  ? 'Hệ thống đang gặp lỗi, vui lòng liên hệ nhân viên.'
                  : `Chưa đủ ảnh cho khung nào. Cần ít nhất ${
                      Math.min(...frames.map((f) => f.slotCount))
                    } ảnh, hiện có ${available.length}.`}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Chọn ảnh / chỉ xem
  // ------------------------------------------------------------------

  if (step === 'pick') {
    const viewOnly = mode === 'v';
    const need = frame?.slotCount ?? 0;
    const done = chosen.length === need;

    return (
      <div className="studio fixed">
        <div className="bar">
          {!viewOnly && (
            <button className="back" onClick={() => setStep('frame')}>← Khung</button>
          )}
          <h1>{viewOnly ? 'Ảnh của bạn' : 'Chọn ảnh'}</h1>
          {!viewOnly && (
            <span className="meta" style={{ color: done ? '#15803d' : undefined }}>
              {chosen.length}/{need}
            </span>
          )}
        </div>

        <div className="body">
          {!viewOnly && (
            <p className="lead">
              {done
                ? 'Đã đủ ảnh — bấm Tiếp tục'
                : `Chạm chọn ${need} ảnh theo thứ tự bạn muốn`}
            </p>
          )}

          <div className="scroll-area">
          <div className="photo-grid">
            {available.map((p) => {
              const idx = chosen.indexOf(p.id);
              return viewOnly ? (
                <a
                  key={p.id}
                  className="photo"
                  href={`/media/originals/${p.id}?t=${encodeURIComponent(token)}`}
                  download={`anh-${String(p.seq).padStart(2, '0')}.jpg`}
                >
                  <img src={photoUrl(p.id, token)} alt="" loading="lazy" />
                </a>
              ) : (
                <button
                  key={p.id}
                  className={idx >= 0 ? 'photo on' : 'photo'}
                  onClick={() => toggle(p.id)}
                  aria-label={`Ảnh ${p.seq}${idx >= 0 ? `, đã chọn thứ ${idx + 1}` : ''}`}
                >
                  <img src={photoUrl(p.id, token)} alt="" loading="lazy" />
                  {idx >= 0 && <span className="num">{idx + 1}</span>}
                </button>
              );
            })}
          </div>
          </div>

          {viewOnly && <p className="tip">Bấm giữ vào ảnh để lưu về máy</p>}
        </div>

        {!viewOnly && (
          <div className="actions">
            <button
              className="btn btn-primary wide"
              disabled={!done || !!busy}
              onClick={startEdit}
            >
              {busy || (done ? 'Tiếp tục' : `Còn thiếu ${need - chosen.length} ảnh`)}
            </button>
          </div>
        )}

        {busy && (
          <div className="overlay">
            <div className="loading">
              <div className="spinner" />
              <p className="muted">{busy}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Chỉnh ảnh
  // ------------------------------------------------------------------

  if (step === 'edit' && frame) {
    const stripState = { frame, contents, photos, color };
    // Luôn có một ô đang chọn để bảng căn chỉnh không bao giờ trống.
    const slotId = activeSlot ?? frame.slots[0].id;
    const active = contents.get(slotId) ?? null;
    const slotIndex = frame.slots.findIndex((s) => s.id === slotId);

    /** Sửa một phần SlotContent của ô đang chọn — luôn đi qua clampContent. */
    const patch = (next: Partial<SlotContent>) => {
      if (!active) return;
      setContents((cur) => new Map(cur).set(slotId, clampContent({ ...active, ...next })));
    };
    const nudge = (dx: number, dy: number) => {
      if (!active) return;
      patch({ offset: { x: active.offset.x + dx, y: active.offset.y + dy } });
    };

    /*
     * Ở zoom = 1 luôn có một trục vừa khít ô, dịch theo trục đó không có tác
     * dụng gì. Làm mờ nút để khách hiểu là "phải phóng to trước", chứ không
     * ngồi bấm mãi rồi tưởng máy hỏng.
     */
    const activePhoto = active ? photos.get(active.photoId) : null;
    // Khổ nào cũng cho cùng kết quả vì phần thừa là tỉ lệ, không phải px tuyệt đối.
    const pagePx = framePx(frame);
    const slack = active && activePhoto
      ? slackOf(
          active,
          activePhoto.natural,
          slotRectPx(frame.slots[slotIndex].rect, pagePx.w, pagePx.h),
        )
      : { w: 0, h: 0 };
    const canX = slack.w > 0.5;
    const canY = slack.h > 0.5;

    return (
      // `fixed` khoá chiều cao đúng bằng màn hình để bảng công cụ và nút Lưu
      // luôn nhìn thấy, không bị canvas đẩy ra ngoài.
      <div className="studio fixed">
        <div className="bar">
          <button className="back" onClick={() => setStep('pick')}>← Ảnh</button>
          <h1>{frame.label}</h1>
        </div>

        <div className="editor">
          <div className="stage">
            <StripCanvas
              fit
              state={stripState}
              overlay={overlay}
              activeSlot={activeSlot}
              onActivate={setActiveSlot}
              onChange={(slotId, c) => setContents((cur) => new Map(cur).set(slotId, c))}
              onCommit={() => {}}
            />
          </div>

          <p className="hint">
            <b>Kéo</b> để căn ảnh · <b>chụm 2 ngón</b> để phóng to
          </p>

          <div className="tools">
            <div className="tool-tabs">
              <button
                className={tool === 'align' ? 'on' : ''}
                onClick={() => setTool('align')}
              >
                Căn ảnh
              </button>
              <button
                className={tool === 'color' ? 'on' : ''}
                onClick={() => setTool('color')}
              >
                Màu
              </button>
            </div>

            {tool === 'align' ? (
              <>
                <div className="presets">
                  {frame.slots.map((s, i) => (
                    <button
                      key={s.id}
                      className={s.id === slotId ? 'chip on' : 'chip'}
                      onClick={() => setActiveSlot(s.id)}
                    >
                      Ô{i + 1}
                    </button>
                  ))}
                </div>

                {active ? (
                  <div className="align">
                    {/* Bàn phím mũi tên: căn được mà không cần kéo chính xác
                        trên màn hình nhỏ. */}
                    <div className="pad">
                      <button className="pad-btn up" aria-label="Dịch lên" disabled={!canY}
                        onClick={() => nudge(0, -NUDGE)}>↑</button>
                      <button className="pad-btn left" aria-label="Dịch trái" disabled={!canX}
                        onClick={() => nudge(-NUDGE, 0)}>←</button>
                      <button className="pad-btn mid" aria-label="Căn giữa lại"
                        onClick={() =>
                          setContents((cur) => new Map(cur).set(slotId, resetContent(active)))
                        }>⌖</button>
                      <button className="pad-btn right" aria-label="Dịch phải" disabled={!canX}
                        onClick={() => nudge(NUDGE, 0)}>→</button>
                      <button className="pad-btn down" aria-label="Dịch xuống" disabled={!canY}
                        onClick={() => nudge(0, NUDGE)}>↓</button>
                    </div>

                    <div className="sliders align-sliders">
                      <Slider
                        label="Phóng" min={MIN_ZOOM} max={MAX_ZOOM} step={0.02}
                        value={active.zoom} format={(v) => v.toFixed(2) + '×'}
                        onChange={(v) => patch({ zoom: v })}
                      />
                      <Slider
                        label="Ngang" value={active.offset.x} disabled={!canX}
                        onChange={(v) => patch({ offset: { ...active.offset, x: v } })}
                      />
                      <Slider
                        label="Dọc" value={active.offset.y} disabled={!canY}
                        onChange={(v) => patch({ offset: { ...active.offset, y: v } })}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="slot-note">
                    <span>Ô {slotIndex + 1} chưa có ảnh</span>
                  </div>
                )}

                {active && (!canX || !canY) && (
                  <p className="pad-tip">
                    Phóng to để dịch được theo chiều {canX ? 'dọc' : 'ngang'}.
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="presets">
                  {/*
                    Bộ của quán đứng TRƯỚC bộ dựng sẵn — đây là tone quán muốn
                    khách dùng, nên phải thấy đầu tiên mà không phải vuốt.

                    Chọn bộ của quán = thay TOÀN BỘ thông số (giữ presetId
                    'none'), không chồng lên bộ dựng sẵn: chồng hai lớp thì
                    kết quả phụ thuộc thứ tự áp và không đoán được.
                  */}
                  {shopPresets.map((p) => {
                    const on = shopId === p.id;
                    return (
                      <button
                        key={p.id}
                        className={on ? 'chip shop on' : 'chip shop'}
                        onClick={() => {
                          setShopId(on ? null : p.id);
                          setColor(on
                            ? DEFAULT_COLOR
                            : { ...DEFAULT_COLOR, ...(p.params as unknown as ColorState) });
                        }}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      className={!shopId && color.presetId === p.id ? 'chip on' : 'chip'}
                      onClick={() => {
                        setShopId(null);
                        setColor({ ...DEFAULT_COLOR, presetId: p.id });
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="sliders">
                  <Slider label="Sáng" value={color.brightness}
                    onChange={(v) => setColor({ ...color, brightness: v })} />
                  <Slider label="Tương phản" value={color.contrast}
                    onChange={(v) => setColor({ ...color, contrast: v })} />
                  <Slider label="Bão hoà" value={color.saturation}
                    onChange={(v) => setColor({ ...color, saturation: v })} />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="actions">
          <button className="btn btn-primary wide" disabled={!!busy} onClick={onSave}>
            {busy || 'Hoàn thiện & Lưu'}
          </button>
        </div>

        {busy && (
          <div className="overlay">
            <div className="loading">
              <div className="spinner" />
              <p className="muted">{busy}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}

function Slider({
  label, value, onChange, min = -1, max = 1, step = 0.02, format, disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Cách hiển thị số; mặc định là phần trăm có dấu. */
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  return (
    <label className={disabled ? 'slider off' : 'slider'}>
      <span>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <b>
        {format
          ? format(value)
          : value === 0
            ? '—'
            : (value > 0 ? '+' : '') + Math.round(value * 100)}
      </b>
    </label>
  );
}
