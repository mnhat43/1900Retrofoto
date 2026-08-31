import { clampContent, coverScale, resolveImagePlacement } from './placement';
import type { Rect, Size, SlotContent } from './types';

/**
 * Đổi một cú kéo tính bằng pixel thành thay đổi offset (tỉ lệ phần thừa).
 * dxPx/dyPx phải cùng hệ pixel với slotRect.
 */
export function panByPixels(
  c: SlotContent,
  img: Size,
  slotRect: Rect,
  dxPx: number,
  dyPx: number,
): SlotContent {
  const scale = coverScale(img, slotRect) * c.zoom;
  const slackX = Math.max(0, img.w * scale - slotRect.w) / 2;
  const slackY = Math.max(0, img.h * scale - slotRect.h) / 2;

  return clampContent({
    ...c,
    offset: {
      // Không có phần thừa -> chiều đó không kéo được.
      x: slackX > 0 ? c.offset.x + dxPx / slackX : 0,
      y: slackY > 0 ? c.offset.y + dyPx / slackY : 0,
    },
  });
}

/**
 * Phóng to/thu nhỏ quanh một điểm neo (con trỏ), giữ điểm ảnh dưới con trỏ
 * đứng yên. Zoom quanh tâm ô cho cảm giác sai — đây là lỗi hay gặp nhất
 * ở loại UI này.
 */
export function zoomAt(
  c: SlotContent,
  img: Size,
  slotRect: Rect,
  factor: number,
  anchor: { x: number; y: number },
): SlotContent {
  const before = resolveImagePlacement(c, img, slotRect);
  // Điểm neo quy về toạ độ trên chính tấm ảnh (0..1).
  const u = (anchor.x - before.x) / before.w;
  const v = (anchor.y - before.y) / before.h;

  const next = clampContent({ ...c, zoom: c.zoom * factor });

  // Điểm neo rơi vào đâu với zoom mới nhưng offset cũ.
  const mid = resolveImagePlacement(next, img, slotRect);
  const dx = anchor.x - u * mid.w - mid.x;
  const dy = anchor.y - v * mid.h - mid.y;

  return panByPixels(next, img, slotRect, dx, dy);
}

/** Về mặc định: cover-fit căn giữa. */
export function resetContent(c: SlotContent): SlotContent {
  return { ...c, zoom: 1, offset: { x: 0, y: 0 } };
}

/** Tìm ô chứa điểm (toạ độ pixel trong dải). */
export function hitSlot(
  slots: Array<{ id: string; rect: { x: number; y: number; w: number; h: number } }>,
  px: number,
  py: number,
  stripW: number,
  stripH: number,
): string | null {
  for (const s of slots) {
    const x = s.rect.x * stripW;
    const y = s.rect.y * stripH;
    const w = s.rect.w * stripW;
    const h = s.rect.h * stripH;
    if (px >= x && px <= x + w && py >= y && py <= y + h) return s.id;
  }
  return null;
}
