import { resolveImagePlacement, slotRectPx } from '../core/placement';
import type { Frame, Photo, SlotContent, ColorState } from '../core/types';
import { applyColor, isIdentity } from './color';

export type StripState = {
  frame: Frame;
  /** slotId -> nội dung ảnh */
  contents: Map<string, SlotContent>;
  photos: Map<string, Photo>;
  color: ColorState;
};

/**
 * Vẽ trang ảnh vào ctx, tại kích thước (pageW x pageH) bất kỳ.
 *
 * Đây là hàm dùng chung cho cả preview lẫn export — chỉ khác kích thước
 * truyền vào. Nhờ `resolveImagePlacement` bất biến theo scale, khung hình
 * ở hai đường render trùng khớp tuyệt đối.
 */
export function drawStrip(
  ctx: CanvasRenderingContext2D,
  state: StripState,
  pageW: number,
  pageH: number,
  overlay: HTMLImageElement | ImageBitmap | null,
): void {
  const { frame, contents, photos } = state;

  ctx.save();

  // Nền trắng để vùng chưa có ảnh không bị trong suốt khi xuất JPG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pageW, pageH);

  // 1. Vẽ ảnh vào từng ô, cắt theo hình ô.
  for (const slot of frame.slots) {
    const content = contents.get(slot.id);
    if (!content) continue;
    const photo = photos.get(content.photoId);
    if (!photo) continue;

    const rect = slotRectPx(slot.rect, pageW, pageH);
    const place = resolveImagePlacement(content, photo.natural, rect);

    ctx.save();
    clipSlot(ctx, rect, slot.radius, pageW, pageH);
    ctx.drawImage(photo.bitmap, place.x, place.y, place.w, place.h);
    ctx.restore();
  }

  // 2. Chỉnh màu — áp lên toàn dải, sau ảnh nhưng TRƯỚC khung.
  //    Khung trang trí giữ nguyên màu gốc như thiết kế.
  if (!isIdentity(state.color)) {
    const img = ctx.getImageData(0, 0, pageW, pageH);
    applyColor(img, state.color);
    ctx.putImageData(img, 0, 0);
  }

  // 3. Khung PNG đè lên trên. Vùng trong suốt để lộ ảnh bên dưới.
  if (overlay) {
    ctx.drawImage(overlay, 0, 0, pageW, pageH);
  }

  ctx.restore();
}

/** Cắt theo ô, hỗ trợ bo góc. */
function clipSlot(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  radius: number | undefined,
  pageW: number,
  pageH: number,
): void {
  ctx.beginPath();
  if (radius && radius > 0) {
    // radius chuẩn hoá theo cạnh ngắn của dải -> pixel
    const r = Math.min(radius * Math.min(pageW, pageH), rect.w / 2, rect.h / 2);
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, r);
  } else {
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
  }
  ctx.clip();
}
