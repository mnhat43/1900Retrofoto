import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { drawStrip, type StripState } from '../render/draw';
import { slotRectPx } from '../core/placement';
import { panByPixels, zoomAt, hitSlot } from '../core/interaction';
import { framePx } from '../core/format';
import type { SlotContent } from '../core/types';

type Props = {
  state: StripState;
  overlay: HTMLImageElement | null;
  activeSlot: string | null;
  onActivate: (slotId: string | null) => void;
  onChange: (slotId: string, content: SlotContent) => void;
  onCommit: () => void;
  /**
   * Tự co theo chỗ trống của phần tử cha thay vì dùng kích thước cố định.
   * Bật cho giao diện điện thoại để dải ảnh luôn vừa màn hình, không bị
   * cắt mất ô dưới cùng.
   */
  fit?: boolean;
};

/** Khung hiển thị tối đa khi KHÔNG bật `fit` (px CSS). */
const VIEW_MAX_W = 460;
const VIEW_MAX_H = 880;

export function StripCanvas({
  state,
  overlay,
  activeSlot,
  onActivate,
  onChange,
  onCommit,
  fit = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Chỗ trống thực tế của phần tử cha, đo bằng ResizeObserver
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  // Theo dõi kích thước cha để canvas co giãn theo màn hình và theo
  // việc xoay ngang/dọc — không dùng số cố định.
  useEffect(() => {
    if (!fit) return;
    const el = wrapRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      if (r.width > 0 && r.height > 0) setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // Kích thước hiển thị theo đúng tỉ lệ khổ giấy của khung đang chọn.
  const view = useMemo(() => {
    const page = framePx(state.frame);
    const maxW = fit ? (box?.w ?? VIEW_MAX_W) : VIEW_MAX_W;
    const maxH = fit ? (box?.h ?? VIEW_MAX_H) : VIEW_MAX_H;
    const scale = Math.min(maxW / page.w, maxH / page.h);
    return {
      w: Math.max(1, Math.round(page.w * scale)),
      h: Math.max(1, Math.round(page.h * scale)),
    };
  }, [state.frame.formatId, state.frame.widthInch, state.frame.heightInch, fit, box]);

  // Giữ state mới nhất cho các handler mà không cần gắn lại listener.
  const latest = useRef({ state, overlay, activeSlot, view });
  latest.current = { state, overlay, activeSlot, view };

  // Vẽ lại, gom vào một requestAnimationFrame — khi kéo có rất nhiều
  // pointer event mỗi frame, không được vẽ lại từng cái.
  const draw = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const { view: v } = latest.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = v.w * dpr;
      const h = v.h * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawStrip(ctx, latest.current.state, w, h, latest.current.overlay);

      // Viền ô đang chọn — chỉ ở preview, không bao giờ vào file xuất.
      const active = latest.current.activeSlot;
      if (active) {
        const slot = latest.current.state.frame.slots.find((s) => s.id === active);
        if (slot) {
          const r = slotRectPx(slot.rect, w, h);
          ctx.save();
          ctx.strokeStyle = '#2563eb';
          ctx.lineWidth = 2 * dpr;
          ctx.setLineDash([6 * dpr, 4 * dpr]);
          ctx.strokeRect(r.x, r.y, r.w, r.h);
          ctx.restore();
        }
      }
    });
  }, []);

  useEffect(() => {
    draw();
  }, [state, overlay, activeSlot, view, draw]);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  /** Đổi toạ độ con trỏ sang hệ pixel của trang preview. */
  const toPage = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current!;
    const box = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * view.w,
      y: ((e.clientY - box.top) / box.height) * view.h,
    };
  };

  const drag = useRef<{ id: number; x: number; y: number; slot: string } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toPage(e);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const slotId = hitSlot(state.frame.slots, p.x, p.y, view.w, view.h);
    onActivate(slotId);
    if (!slotId || !state.contents.has(slotId)) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: p.x, y: p.y, slot: slotId };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Hai ngón -> pinch zoom
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const slotId = drag.current?.slot ?? activeSlot;
      if (pinch.current != null && slotId) {
        const content = state.contents.get(slotId);
        const slot = state.frame.slots.find((s) => s.id === slotId);
        const photo = content && state.photos.get(content.photoId);
        if (content && slot && photo) {
          const mid = toPage({
            clientX: (a.x + b.x) / 2,
            clientY: (a.y + b.y) / 2,
          });
          const rect = slotRectPx(slot.rect, view.w, view.h);
          onChange(
            slotId,
            zoomAt(content, photo.natural, rect, dist / pinch.current, mid),
          );
        }
      }
      pinch.current = dist;
      drag.current = null;
      return;
    }

    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;

    const content = state.contents.get(d.slot);
    const slot = state.frame.slots.find((s) => s.id === d.slot);
    const photo = content && state.photos.get(content.photoId);
    if (!content || !slot || !photo) return;

    const p = toPage(e);
    const rect = slotRectPx(slot.rect, view.w, view.h);
    onChange(d.slot, panByPixels(content, photo.natural, rect, p.x - d.x, p.y - d.y));
    drag.current = { ...d, x: p.x, y: p.y };
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (drag.current?.id === e.pointerId) {
      drag.current = null;
      onCommit();
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const p = toPage(e);
    const slotId = hitSlot(state.frame.slots, p.x, p.y, view.w, view.h);
    if (!slotId) return;
    const content = state.contents.get(slotId);
    const slot = state.frame.slots.find((s) => s.id === slotId);
    const photo = content && state.photos.get(content.photoId);
    if (!content || !slot || !photo) return;

    const rect = slotRectPx(slot.rect, view.w, view.h);
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    onChange(slotId, zoomAt(content, photo.natural, rect, factor, p));
  };

  return (
    <div ref={wrapRef} style={{ display: 'contents' }}>
      <canvas
        ref={canvasRef}
        className="strip-canvas"
        style={{ width: view.w, height: view.h, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onWheel={onWheel}
      />
    </div>
  );
}
