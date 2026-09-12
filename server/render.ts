import sharp from 'sharp';

import { readFileFrom, saveFile } from './storage.ts';
import { getFrame, readFrameImage } from './frames.ts';
import { listPhotos } from './capture.ts';
import type { Session } from './session.ts';
import { resolveImagePlacement, slotRectPx } from '../src/core/placement.ts';
import { framePx, SERVER_DPI, DPI } from '../src/core/format.ts';
import { applyColor, isIdentity } from '../src/render/color.ts';
import type { ColorState } from '../src/core/types.ts';

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

/*
 * Chỉnh màu dùng LẠI applyColor của app, không viết lại.
 *
 * Trước đây chỗ này là bản cài đặt thứ hai của cùng phép toán — đúng thứ
 * README cảnh báo phải tránh. Thêm một thanh chỉnh mới ở client mà quên sửa
 * ở đây thì ảnh khách tải về sẽ khác ảnh khách thấy.
 *
 * applyColor nhận ImageData; ở Node không có sẵn nên dựng một vật thể cùng
 * hình dạng — nó chỉ đọc .data, .width, .height.
 */
function applyColorRaw(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  c: NonNullable<Recipe['color']>,
): void {
  if (channels === 4) {
    applyColor(
      { data: data as unknown as Uint8ClampedArray, width, height } as ImageData,
      c as ColorState,
    );
    return;
  }
  // sharp có thể trả 3 kênh; applyColor bước 4 nên phải đệm thêm alpha
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < data.length; i += channels, j += 4) {
    rgba[j] = data[i]; rgba[j + 1] = data[i + 1]; rgba[j + 2] = data[i + 2];
    rgba[j + 3] = 255;
  }
  applyColor({ data: rgba, width, height } as ImageData, c as ColorState);
  for (let i = 0, j = 0; i < data.length; i += channels, j += 4) {
    data[i] = rgba[j]; data[i + 1] = rgba[j + 1]; data[i + 2] = rgba[j + 2];
  }
}

/**
 * Render một dải ảnh từ recipe + ảnh gốc.
 *
 * Trả null nếu thiếu dữ kiện (khung đã xoá, ảnh gốc không còn) — gọi bên
 * ngoài sẽ giữ nguyên bản khách đã gửi lên thay vì làm hỏng kết quả.
 */
/** Chiều rộng khung tính bằng inch — để suy ra DPI thật sau khi fitDpi hạ. */
function frameInchW(frame: Parameters<typeof framePx>[0]): number {
  return framePx(frame, 1).w;
}

/** Ngưỡng điểm ảnh an toàn cho một lần dựng: ~70MB canvas RGBA. */
const MAX_PIXELS = 18_000_000;

/**
 * Kích thước trang ở SERVER_DPI, hạ xuống nếu vượt ngưỡng RAM.
 *
 * Khổ dải 2x6in ở 1200 DPI là 17.3M điểm ảnh — vừa khít. Khổ vuông lớn thì
 * không, nên phải hạ. Hạ theo căn bậc hai vì số điểm ảnh tăng theo bình
 * phương DPI.
 */
function fitDpi(frame: Parameters<typeof framePx>[0]) {
  const full = framePx(frame, SERVER_DPI);
  const px = full.w * full.h;
  if (px <= MAX_PIXELS) return full;
  const dpi = Math.floor(SERVER_DPI * Math.sqrt(MAX_PIXELS / px));
  return framePx(frame, Math.max(DPI, dpi));
}

export async function renderFromOriginals(
  session: Session,
  recipe: Recipe,
): Promise<{ data: Buffer; width: number; height: number } | null> {
  const frame = getFrame(recipe.frameId);
  if (!frame) return null;

  /*
   * Dựng ở SERVER_DPI, không phải DPI của trình duyệt — đây chính là lý do
   * bước dựng lại ở server tồn tại: điện thoại vướng trần canvas iOS, server
   * thì không.
   *
   * Nhưng có trần RAM: khổ 12x12in ở 1200 DPI là 207M điểm ảnh, tốn ~791MB
   * chỉ riêng canvas — đủ để giết server giữa ca. Khổ nào vượt ngưỡng thì hạ
   * DPI xuống cho vừa, vẫn nét hơn bản 300 DPI của điện thoại.
   */
  const page = fitDpi(frame);
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
  // isIdentity nhập từ color.ts — tự bao gồm mọi thanh mới
  if (recipe.color && !isIdentity(recipe.color as ColorState)) {
    const { data, info } = await sharp(out).raw()
      .toBuffer({ resolveWithObject: true });
    applyColorRaw(data, info.width, info.height, info.channels, recipe.color!);
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

  /*
   * Ghi DPI vao metadata anh.
   *
   * Khong ghi thi sharp de mac dinh 72, va phan mem in doc so do se tinh ra
   * kho giay sai — anh 2x6 inch bi hieu thanh 16x50 inch.
   */
  /*
   * DPI THẬT của trang, không phải SERVER_DPI — khổ lớn đã bị fitDpi hạ
   * xuống. Ghi sai là phần mềm in tính ra khổ giấy sai.
   */
  const realDpi = Math.round(page.w / frameInchW(frame));
  out = await sharp(out).withMetadata({ density: realDpi }).png().toBuffer();

  return { data: out, width: page.w, height: page.h };
}
