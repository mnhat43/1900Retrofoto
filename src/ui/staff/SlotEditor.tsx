import { useRef, useState } from 'react';

import {
  type Rect, BUOC_VIEN, MIN_SIZE, clamp01, coNoi, xepLuoi,
} from './slots';

/**
 * Đặt các ô chứa ảnh khách lên khung.
 *
 * Hai đường vào màn này:
 *   - Khung có sẵn vùng trong suốt -> ô đã dò tự động, ở đây chỉ sửa nốt chỗ
 *     lệch (lỗ dính nhau, lỗ trang trí, viền mờ làm lệch mép).
 *   - Khung là ảnh đặc (JPG, hay PNG xuất kèm nền) -> KHÔNG có ô nào, nhân
 *     viên tự đặt. Lúc lưu, server khoét lỗ trong suốt theo đúng các ô này.
 *
 * Vì đường thứ hai bắt đầu từ con số không nên màn này phải tự làm được việc
 * đó cho nhanh: có nút xếp lưới sẵn và nút chừa viền, chứ kéo tay từng ô cho
 * đều nhau thì rất cực và không bao giờ thẳng hàng.
 *
 * Phần tính toán ô nằm ở ./slots — ở đây chỉ còn chuyện chuột và cách vẽ.
 */

type Drag =
  | { mode: 'move'; i: number; dx: number; dy: number }
  | { mode: 'resize'; i: number }
  | { mode: 'draw'; i: number; x0: number; y0: number };

export default function SlotEditor({
  src, slots, onChange, ratio = 1, duc = false,
}: {
  src: string;
  slots: Rect[];
  onChange: (slots: Rect[]) => void;
  /** Bề rộng / chiều cao của file ảnh — quyết định lưới dựng ra mấy cột. */
  ratio?: number;
  /**
   * Ảnh đặc: lúc lưu server sẽ KHOÉT THỦNG đúng các ô này.
   *
   * Đổi cách VẼ ô chứ không chỉ để hiện thêm chữ. Với ảnh đặc, ô không phải
   * cái khung ngắm mà là vết cắt, nên vẽ nó thành lỗ caro: kéo ô chờm lên
   * viền là thấy hoa văn biến mất ngay trước mắt. Nét đứt hồng không nói ra
   * được điều đó, và nhân viên chỉ phát hiện sau khi đã lưu.
   */
  duc?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [active, setActive] = useState<number | null>(null);
  /*
   * Lịch sử để hoàn tác. Nắn ô là thao tác kéo chuột nên rất dễ lỡ tay —
   * xoá nhầm một ô vừa căn xong mà không lùi lại được thì phải làm lại từ đầu.
   * Chỉ ghi lại các bước RỜI RẠC (thêm/xoá/xếp lưới), không ghi từng nhịp kéo.
   */
  const [undo, setUndo] = useState<Rect[][]>([]);

  /** Đổi danh sách ô kèm ghi lại bước trước đó để hoàn tác được. */
  function apply(next: Rect[]) {
    setUndo((h) => [...h.slice(-19), slots]);
    onChange(next);
  }

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
    // Lớp nhắc "chưa có ô nào" đè lên ảnh nhưng để pointer-events: none, nên
    // cú kéo vẫn rơi xuống .se-img phía dưới và không cần xét riêng ở đây.
    if (e.target !== box.current
      && !(e.target as HTMLElement).classList.contains('se-img')) return;
    const p = at(e);
    const i = slots.length;
    // Ghi lịch sử TRƯỚC khi thêm, để Hoàn tác quay về đúng lúc chưa có ô này
    setUndo((h) => [...h.slice(-19), slots]);
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

      {/*
        Thanh xếp nhanh. Đây là thứ cứu đường "khung là ảnh đặc": nhân viên
        vào màn này với 0 ô, và kéo tay 6 ô cho đều nhau thì vừa lâu vừa không
        thẳng hàng. Bấm một nút ra lưới đều rồi nắn lại vài ô là xong.
      */}
      <div className="se-tools">
        <span className="muted small">Xếp nhanh</span>
        {[1, 2, 3, 4, 6, 9].map((n) => (
          <button
            key={n}
            type="button"
            className="se-chip"
            onClick={() => apply(xepLuoi(n, ratio))}
            title={`Xếp ${n} ô đều nhau`}
          >
            {n}
          </button>
        ))}

        {/*
          Chừa viền: co/nới đồng loạt. Sau khi xếp lưới thì đây là nút hay
          dùng nhất — lưới xếp sẵn chừa lề 6%, khung nào viền dày hơn thế thì
          bấm co vài nhịp là hoa văn hiện lại đủ.
        */}
        <span className="se-chia" aria-hidden="true" />
        <span className="muted small">Chừa viền</span>
        <button
          type="button"
          className="se-chip"
          disabled={!slots.length}
          onClick={() => apply(coNoi(slots, -BUOC_VIEN))}
          title="Thu nhỏ tất cả ô để chừa thêm viền"
        >
          −
        </button>
        <button
          type="button"
          className="se-chip"
          disabled={!slots.length}
          onClick={() => apply(coNoi(slots, BUOC_VIEN))}
          title="Nới rộng tất cả ô"
        >
          +
        </button>

        <button
          type="button"
          className="link"
          disabled={!undo.length}
          onClick={() => {
            const prev = undo[undo.length - 1];
            if (!prev) return;
            setUndo((h) => h.slice(0, -1));
            onChange(prev);
            setActive(null);
          }}
        >
          Hoàn tác
        </button>
      </div>

      <div
        className={duc ? 'preview-img se-box se-duc' : 'preview-img se-box'}
        ref={box}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <img className="se-img" src={src} alt="" draggable={false} />

        {/*
          Khung đặc vào đây với 0 ô, và một tấm ảnh trơn không gợi ra rằng
          phải kéo lên nó. Nói thẳng ra, đặt ngay trên ảnh chứ không nhét
          xuống dòng chú thích phía dưới.
        */}
        {slots.length === 0 && (
          <div className="se-empty">
            <b>Chưa có ô nào</b>
            <span>Kéo trên ảnh để vẽ ô, hoặc bấm một số ở trên để xếp sẵn</span>
          </div>
        )}

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
        Kéo ô để di chuyển · kéo góc để đổi cỡ · kéo trên nền để thêm ô.
        {duc
          ? ' Vùng caro là lỗ sắp khoét — hoa văn nằm trong đó sẽ mất.'
          : ' Ô là chỗ ảnh khách hiện ra.'}
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
                apply(slots.filter((_, i) => i !== picked));
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
