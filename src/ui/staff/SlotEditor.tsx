import { useRef, useState } from 'react';

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Nắn lại các ô trên khung bằng chuột.
 *
 * Dò tự động đúng với phần lớn khung, nhưng khung vẽ tay có thể có lỗ dính
 * nhau, lỗ trang trí, hoặc viền mờ làm lệch mép. Màn này để sửa nốt những
 * trường hợp đó mà không phải bỏ cả file.
 *
 * Toạ độ luôn CHUẨN HOÁ 0..1 — giống hệt thứ server lưu và phần render dùng,
 * nên kéo trên ảnh xem trước bao nhiêu pixel cũng không quan trọng.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Ô nhỏ hơn mức này coi như bấm nhầm, không cho tạo. */
const MIN_SIZE = 0.02;

type Drag =
  | { mode: 'move'; i: number; dx: number; dy: number }
  | { mode: 'resize'; i: number }
  | { mode: 'draw'; i: number; x0: number; y0: number };

export default function SlotEditor({
  src, slots, onChange,
}: {
  src: string;
  slots: Rect[];
  onChange: (slots: Rect[]) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [active, setActive] = useState<number | null>(null);

  /** Toạ độ chuột -> toạ độ chuẩn hoá trong ảnh. */
  function at(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = box.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  }

  function onMove(e: React.PointerEvent) {
    if (!drag) return;
    const p = at(e);
    const next = [...slots];

    if (drag.mode === 'move') {
      const s = next[drag.i];
      next[drag.i] = {
        ...s,
        x: clamp01(Math.min(p.x - drag.dx, 1 - s.w)),
        y: clamp01(Math.min(p.y - drag.dy, 1 - s.h)),
      };
    } else if (drag.mode === 'resize') {
      const s = next[drag.i];
      next[drag.i] = { ...s, w: clamp01(p.x - s.x), h: clamp01(p.y - s.y) };
    } else {
      // Vẽ ô mới: neo ở điểm bấm xuống, kéo ra hướng nào cũng được
      next[drag.i] = {
        x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y),
        w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0),
      };
    }
    onChange(next);
  }

  function onUp() {
    // Vẽ hụt tay ra ô tí xíu -> bỏ, coi như bấm nhầm
    if (drag?.mode === 'draw') {
      const s = slots[drag.i];
      if (s.w < MIN_SIZE || s.h < MIN_SIZE) {
        onChange(slots.filter((_, i) => i !== drag.i));
        setActive(null);
      }
    }
    setDrag(null);
  }

  /** Bấm vào nền (không trúng ô nào) -> vẽ ô mới. */
  function onDown(e: React.PointerEvent) {
    if (e.target !== box.current && !(e.target as HTMLElement).classList.contains('se-img')) return;
    const p = at(e);
    const i = slots.length;
    onChange([...slots, { x: p.x, y: p.y, w: 0, h: 0 }]);
    setActive(i);
    setDrag({ mode: 'draw', i, x0: p.x, y0: p.y });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  const picked = active != null && slots[active] ? active : null;

  return (
    <div className="slot-editor">
      {/*
        Tiêu đề cùng kiểu với các nhãn ở cột thông tin, để hai cột bắt đầu
        cùng một hàng thay vì ảnh cao hơn nhãn bên cạnh.
      */}
      <span className="field-label">Các ô ảnh · {slots.length} ô</span>

      <div
        className="preview-img se-box"
        ref={box}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <img className="se-img" src={src} alt="" draggable={false} />

        {slots.map((s, i) => (
          <span
            key={i}
            className={i === active ? 'slot-box on' : 'slot-box'}
            data-n={i + 1}
            style={{
              left: `${s.x * 100}%`, top: `${s.y * 100}%`,
              width: `${s.w * 100}%`, height: `${s.h * 100}%`,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              const p = at(e);
              setActive(i);
              setDrag({ mode: 'move', i, dx: p.x - s.x, dy: p.y - s.y });
              (e.currentTarget.parentElement as HTMLElement)
                .setPointerCapture(e.pointerId);
            }}
          >
            {/* Tay cầm góc dưới-phải để kéo giãn ô */}
            <i
              className="se-handle"
              onPointerDown={(e) => {
                e.stopPropagation();
                setActive(i);
                setDrag({ mode: 'resize', i });
                (e.currentTarget.parentElement!.parentElement as HTMLElement)
                  .setPointerCapture(e.pointerId);
              }}
            />
          </span>
        ))}
      </div>

      <p className="se-hint muted small">
        Kéo ô để di chuyển · kéo góc để đổi cỡ · kéo trên nền để thêm ô
      </p>

      {/*
        Hàng này CÓ MẶT SẴN cả khi chưa chọn ô nào.
        Hiện nút theo lúc chọn thì mỗi cú bấm vào ô lại đẩy cả cột thông tin
        bên dưới nhảy lên nhảy xuống.
      */}
      <div className="se-sel">
        {picked == null ? (
          <span className="muted small">Bấm vào một ô để chọn</span>
        ) : (
          <>
            <span className="se-tag">Đang chọn ô {picked + 1}</span>
            <button
              type="button"
              className="link danger"
              onClick={() => {
                onChange(slots.filter((_, i) => i !== picked));
                setActive(null);
              }}
            >
              Xoá ô này
            </button>
          </>
        )}
      </div>
    </div>
  );
}
