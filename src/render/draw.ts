import { orientedSize, resolveImagePlacement, slotRectPx } from '../core/placement';
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
    const place = resolveImagePlacement(content, orientedSize(photo.natural, content), rect);

    ctx.save();
    clipSlot(ctx, rect, slot.radius, pageW, pageH);
    drawOriented(ctx, photo.bitmap, place, content.rotate ?? 0, !!content.flipX);
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

/**
 * Vẽ bitmap vào khung `place` (khung của ảnh ĐÃ xoay), có xoay và lật.
 *
 * Thứ tự biến đổi: xoay trước, lật ngang sau — tức lật theo đúng hướng khách
 * đang nhìn. server/render.ts làm y hệt thứ tự này (rotate rồi flop); đổi ở
 * một bên mà quên bên kia thì ảnh tải về sẽ lật khác ảnh khách thấy.
 */
function drawOriented(
  ctx: CanvasRenderingContext2D,
  bitmap: CanvasImageSource,
  place: { x: number; y: number; w: number; h: number },
  rotate: number,
  flipX: boolean,
): void {
  if (!rotate && !flipX) {
    ctx.drawImage(bitmap, place.x, place.y, place.w, place.h);
    return;
  }
  // Xoay 90/270 thì bitmap gốc nằm ngang so với khung: đổi chiều rộng/cao.
  const quarter = rotate === 90 || rotate === 270;
  const dw = quarter ? place.h : place.w;
  const dh = quarter ? place.w : place.h;
  ctx.save();
  ctx.translate(place.x + place.w / 2, place.y + place.h / 2);
  if (flipX) ctx.scale(-1, 1);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(bitmap, -dw / 2, -dh / 2, dw, dh);
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
