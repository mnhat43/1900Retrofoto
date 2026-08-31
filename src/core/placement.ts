import type { NormRect, Rect, Size, SlotContent } from './types';

/**
 * Hệ số phóng để ảnh phủ KÍN ô (giống object-fit: cover).
 * Dùng max nên ảnh luôn tràn ra ít nhất một chiều — không bao giờ hở nền.
 */
export function coverScale(img: Size, slot: Size): number {
  return Math.max(slot.w / img.w, slot.h / img.h);
}

/** Đổi toạ độ chuẩn hoá 0..1 sang pixel ở một kích thước dải cụ thể. */
export function slotRectPx(rect: NormRect, stripW: number, stripH: number): Rect {
  return {
    x: rect.x * stripW,
    y: rect.y * stripH,
    w: rect.w * stripW,
    h: rect.h * stripH,
  };
}

/**
 * Tính vị trí vẽ ảnh trong ô, cùng hệ pixel với `slotRect`.
 *
 * BẤT BIẾN THEO SCALE — đây là tính chất cốt lõi của toàn app:
 * nhân `slotRect` với hệ số k bất kỳ thì kết quả cũng nhân đúng k.
 * Nhờ vậy preview (dải ~300px) và export (dải 1800px) cho khung hình
 * trùng khớp tuyệt đối, không cần đồng bộ thủ công.
 */
export function resolveImagePlacement(
  content: SlotContent,
  img: Size,
  slotRect: Rect,
): Rect {
  const scale = coverScale(img, slotRect) * content.zoom;

  const drawW = img.w * scale;
  const drawH = img.h * scale;

  // Phần thừa: ảnh dịch được bao xa trước khi mép ảnh lọt vào trong ô.
  const slackX = Math.max(0, drawW - slotRect.w) / 2;
  const slackY = Math.max(0, drawH - slotRect.h) / 2;

  // Tâm ô, dịch đi theo tỉ lệ phần thừa thực tế.
  const cx = slotRect.x + slotRect.w / 2 + content.offset.x * slackX;
  const cy = slotRect.y + slotRect.h / 2 + content.offset.y * slackY;

  return { x: cx - drawW / 2, y: cy - drawH / 2, w: drawW, h: drawH };
}

/**
 * Ảnh còn dịch được theo trục nào, tính bằng px.
 *
 * Vì coverScale dùng max(), ở zoom = 1 luôn có ĐÚNG MỘT trục vừa khít ô —
 * trục đó phần thừa bằng 0 nên dịch không có tác dụng gì. Giao diện cần biết
 * điều này để làm mờ nút mũi tên tương ứng, thay vì để khách bấm mãi mà ảnh
 * không nhúc nhích rồi tưởng máy hỏng.
 *
 * Dùng chung công thức với resolveImagePlacement để hai nơi không thể lệch.
 */
export function slackOf(content: SlotContent, img: Size, slotRect: Rect): Size {
  const scale = coverScale(img, slotRect) * content.zoom;
  return {
    w: Math.max(0, img.w * scale - slotRect.w) / 2,
    h: Math.max(0, img.h * scale - slotRect.h) / 2,
  };
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Giữ transform trong vùng hợp lệ.
 *
 * Vì offset lưu theo TỈ LỆ phần thừa (không phải pixel), clamp chỉ là
 * clamp(v, -1, 1) — đúng ở mọi độ phân giải, không có phép tính nào có thể
 * làm tròn khác nhau giữa preview và export. Kết hợp với zoom >= 1,
 * việc hở nền là bất khả thi về mặt toán học.
 */
export function clampContent(c: SlotContent): SlotContent {
  return {
    ...c,
    zoom: clamp(c.zoom, MIN_ZOOM, MAX_ZOOM),
    offset: {
      x: clamp(c.offset.x, -1, 1),
      y: clamp(c.offset.y, -1, 1),
    },
  };
}
