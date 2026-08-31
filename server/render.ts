import sharp from 'sharp';

import { readFileFrom, saveFile } from './storage.ts';
import { getFrame, readFrameImage } from './frames.ts';
import { listPhotos } from './capture.ts';
import type { Session } from './session.ts';
import { resolveImagePlacement, slotRectPx } from '../src/core/placement.ts';
import { framePx } from '../src/core/format.ts';
import { PRESETS } from '../src/render/color.ts';

/**
 * Dựng lại ảnh ghép ở server, từ ẢNH GỐC máy chụp.
 *
 * VÌ SAO CẦN BƯỚC NÀY:
 * Điện thoại khách ghép ảnh từ bản preview 1400px — bắt buộc, vì giải nén
 * ảnh Canon 6000x4000 tốn 92MB RAM mỗi tấm, khung 9 ô là 824MB và Safari
 * trên iPhone sẽ sập. Nhưng server thì không có giới hạn đó.
 *
 * Nên: khách vẫn ghép trên điện thoại như cũ (nhanh, xem trước tức thì), rồi
 * server dựng lại đúng tấm ấy từ ảnh gốc. Khách tải về bản NÉT NHẤT mà máy
 * ảnh cho được, không phải bản dựng từ preview.
 *
 * VÌ SAO KHÔNG LỆCH VỚI BẢN KHÁCH THẤY:
 * Dùng LẠI chính `resolveImagePlacement` và bảng màu `PRESETS` của app, không
 * chép lại công thức. `placement.ts` bất biến theo scale nên cùng một recipe
 * cho ra cùng một khung hình ở mọi độ phân giải — đây là tính chất đã được
 * verify-export kiểm ở mức lệch 0 pixel.
 */

export type Recipe = {
  frameId: string;
  color?: { presetId: string; brightness: number; contrast: number; saturation: number };
  slots: Array<{
    slotId: string;
    photoId: string;
    zoom: number;
    offset: { x: number; y: number };
  }>;
};

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/**
 * Áp màu lên buffer RGB thô.
 *
 * Cùng thứ tự phép toán với src/render/color.ts: matrix -> saturation ->
 * brightness -> contrast. Hằng số preset lấy thẳng từ PRESETS nên thêm bộ lọc
 * mới ở client là server tự có theo.
 */
function applyColorRaw(
  data: Buffer,
  channels: number,
  c: NonNullable<Recipe['color']>,
): void {
  const preset = PRESETS.find((p) => p.id === c.presetId);
  const m = preset?.matrix;
  const sat = 1 + c.saturation + (preset?.saturation ?? 0);
  const bright = (c.brightness + (preset?.brightness ?? 0)) * 255;
  const contrast = 1 + c.contrast + (preset?.contrast ?? 0);

  for (let i = 0; i < data.length; i += channels) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    if (m) {
      const nr = r * m[0] + g * m[1] + b * m[2];
      const ng = r * m[3] + g * m[4] + b * m[5];
      const nb = r * m[6] + g * m[7] + b * m[8];
      r = nr; g = ng; b = nb;
    }
    if (sat !== 1) {
      const lum = r * LUMA_R + g * LUMA_G + b * LUMA_B;
      r = lum + (r - lum) * sat;
      g = lum + (g - lum) * sat;
      b = lum + (b - lum) * sat;
    }
    if (bright !== 0) { r += bright; g += bright; b += bright; }
    if (contrast !== 1) {
      r = (r - 128) * contrast + 128;
      g = (g - 128) * contrast + 128;
      b = (b - 128) * contrast + 128;
    }

    data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
}

const isIdentity = (c?: Recipe['color']) =>
  !c || (c.presetId === 'none' && !c.brightness && !c.contrast && !c.saturation);

/**
 * Render một dải ảnh từ recipe + ảnh gốc.
 *
 * Trả null nếu thiếu dữ kiện (khung đã xoá, ảnh gốc không còn) — gọi bên
 * ngoài sẽ giữ nguyên bản khách đã gửi lên thay vì làm hỏng kết quả.
 */
export async function renderFromOriginals(
  session: Session,
  recipe: Recipe,
): Promise<{ data: Buffer; width: number; height: number } | null> {
  const frame = getFrame(recipe.frameId);
  if (!frame) return null;

  const page = framePx(frame);
  const photos = listPhotos(session.id);

  // Nền trắng, đúng như drawStrip ở client
  const canvas = sharp({
    create: {
      width: page.w, height: page.h, channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  });

  const layers: sharp.OverlayOptions[] = [];

  for (const slot of frame.slots) {
    const entry = recipe.slots.find((s) => s.slotId === slot.id);
    if (!entry) continue;
    const photo = photos.find((p) => p.id === entry.photoId);
    if (!photo) continue;

    let original: Buffer;
    try {
      original = await readFileFrom(session.dir, 'originals', photo.filename);
    } catch {
      return null;                       // mất ảnh gốc -> không dựng lại được
    }

    const meta = await sharp(original).rotate().metadata();
    if (!meta.width || !meta.height) return null;

    const rect = slotRectPx(slot.rect, page.w, page.h);
    const place = resolveImagePlacement(
      { photoId: entry.photoId, zoom: entry.zoom, offset: entry.offset },
      { w: meta.width, h: meta.height },
      rect,
    );

    /*
     * Cắt đúng phần ảnh lọt vào ô rồi mới thu nhỏ.
     * Làm ngược lại (thu nhỏ cả tấm rồi cắt) sẽ phí công giải nén phần ảnh
     * nằm ngoài ô, với ảnh 24MP thì chênh lệch rất đáng kể.
     */
    const sx = (rect.x - place.x) / place.w * meta.width;
    const sy = (rect.y - place.y) / place.h * meta.height;
    const sw = rect.w / place.w * meta.width;
    const sh = rect.h / place.h * meta.height;

    const left = Math.max(0, Math.round(sx));
    const top = Math.max(0, Math.round(sy));
    const width = Math.max(1, Math.min(Math.round(sw), meta.width - left));
    const height = Math.max(1, Math.min(Math.round(sh), meta.height - top));

    const piece = await sharp(original)
      .rotate()
      .extract({ left, top, width, height })
      .resize(Math.max(1, Math.round(rect.w)), Math.max(1, Math.round(rect.h)), {
        fit: 'fill',
        kernel: 'lanczos3',            // thu nhỏ chất lượng cao
      })
      .toBuffer();

    layers.push({
      input: piece,
      left: Math.round(rect.x),
      top: Math.round(rect.y),
    });
  }

  let out = await canvas.composite(layers).png().toBuffer();

  // Chỉnh màu áp lên ảnh, TRƯỚC khi đặt khung lên — khung giữ màu thiết kế
  if (!isIdentity(recipe.color)) {
    const { data, info } = await sharp(out).raw()
      .toBuffer({ resolveWithObject: true });
    applyColorRaw(data, info.channels, recipe.color!);
    out = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    }).png().toBuffer();
  }

  // Khung PNG đè lên trên cùng
  const overlay = readFrameImage(frame.id);
  if (overlay) {
    const resized = await sharp(overlay)
      .resize(page.w, page.h, { fit: 'fill' })
      .toBuffer();
    out = await sharp(out).composite([{ input: resized }]).png().toBuffer();
  }

  return { data: out, width: page.w, height: page.h };
}
