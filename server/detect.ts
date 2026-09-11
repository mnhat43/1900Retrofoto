import sharp from 'sharp';

/**
 * Dò các ô (vùng trong suốt) trong file khung PNG.
 *
 * Khung ảnh là một tấm PNG có các "lỗ" trong suốt; ảnh của khách hiện qua các
 * lỗ đó. App cần biết TOẠ ĐỘ từng lỗ để đặt ảnh vào, nên ở đây ta đọc kênh
 * alpha rồi gom các pixel trong suốt liền nhau thành từng vùng.
 *
 * Toạ độ trả về đã CHUẨN HOÁ (0..1) chứ không phải pixel — đúng như `Slot`
 * mà phần render đang dùng, nên khung dò ra dùng chung được mọi khổ giấy.
 */

/** Alpha dưới ngưỡng này coi là trong suốt. Không lấy 0 vì PNG hay có viền mờ. */
const ALPHA_THRESHOLD = 128;

/**
 * Bỏ qua vùng nhỏ hơn 0.5% diện tích ảnh.
 * Khung thật hay có lỗ li ti do khử răng cưa hoặc do người thiết kế để lại;
 * gom chúng vào thì khách sẽ thấy những "ô" bé xíu không đặt được ảnh nào.
 */
const MIN_AREA_RATIO = 0.005;

export type DetectedSlot = {
  /** Chuẩn hoá 0..1 theo bề rộng/chiều cao ảnh. */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DetectResult = {
  width: number;
  height: number;
  slots: DetectedSlot[];
};

/**
 * Gom pixel trong suốt liền nhau thành vùng (connected components).
 *
 * Dùng vòng lặp với ngăn xếp tự quản, KHÔNG đệ quy: một vùng có thể tới hàng
 * triệu pixel, đệ quy sẽ tràn ngăn xếp trên đúng những file khung lớn mà ta
 * cần xử lý nhất.
 */
function findRegions(
  alpha: Uint8Array,
  w: number,
  h: number,
): Array<{ x0: number; y0: number; x1: number; y1: number; area: number }> {
  const seen = new Uint8Array(w * h);
  const regions: Array<{ x0: number; y0: number; x1: number; y1: number; area: number }> = [];
  const stack: number[] = [];

  for (let start = 0; start < alpha.length; start++) {
    if (seen[start] || alpha[start] >= ALPHA_THRESHOLD) continue;

    let x0 = start % w, x1 = x0, y0 = (start / w) | 0, y1 = y0, area = 0;

    seen[start] = 1;
    stack.push(start);

    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i / w) | 0;

      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;

      // 4 hướng là đủ: lỗ khung là hình chữ nhật đặc, không phải nét mảnh chéo
      if (x > 0)     { const n = i - 1; if (!seen[n] && alpha[n] < ALPHA_THRESHOLD) { seen[n] = 1; stack.push(n); } }
      if (x < w - 1) { const n = i + 1; if (!seen[n] && alpha[n] < ALPHA_THRESHOLD) { seen[n] = 1; stack.push(n); } }
      if (y > 0)     { const n = i - w; if (!seen[n] && alpha[n] < ALPHA_THRESHOLD) { seen[n] = 1; stack.push(n); } }
      if (y < h - 1) { const n = i + w; if (!seen[n] && alpha[n] < ALPHA_THRESHOLD) { seen[n] = 1; stack.push(n); } }
    }

    regions.push({ x0, y0, x1, y1, area });
  }

  return regions;
}

/**
 * Sắp xếp ô theo thứ tự đọc: trên xuống dưới, trái sang phải.
 *
 * So sánh y theo NGƯỠNG chứ không so bằng: các ô cùng một hàng hiếm khi khớp
 * y đúng từng pixel, so bằng thì thứ tự ô sẽ nhảy lung tung giữa các lần dò.
 */
function readingOrder(slots: DetectedSlot[]): DetectedSlot[] {
  if (slots.length === 0) return slots;
  const avgH = slots.reduce((s, r) => s + r.h, 0) / slots.length;
  const sameRow = avgH * 0.5;

  return [...slots].sort((a, b) =>
    Math.abs(a.y - b.y) < sameRow ? a.x - b.x : a.y - b.y,
  );
}

/**
 * Đọc file khung và trả về các ô dò được.
 *
 * Nhận mọi định dạng sharp đọc được MIỄN LÀ có kênh alpha (PNG, WebP, AVIF,
 * GIF, và cả TIFF nén LZW). Điều kiện thật sự là độ trong suốt chứ không phải
 * đuôi file: cả cơ chế khung dựa vào việc đọc alpha để biết lỗ nằm ở đâu.
 *
 * Hộp chọn file chỉ gợi ý bốn loại đầu. TIFF tuỳ tuỳ chọn nén mà còn hay mất
 * alpha, nên không hứa trước — file nào còn thì vẫn nhận.
 *
 * Ném lỗi nếu file không có kênh alpha — ảnh đặc thì không có lỗ nào, mà báo
 * "tìm thấy 0 ô" thì người dùng không biết vì sao. JPEG luôn rơi vào nhánh
 * này: định dạng đó không lưu được độ trong suốt, nên nói thẳng ra thay vì
 * để người dùng thử đi thử lại.
 */
export async function detectSlots(png: Buffer): Promise<DetectResult> {
  const img = sharp(png);

  let meta;
  try {
    meta = await img.metadata();
  } catch {
    // sharp không nhận ra định dạng: file hỏng, hoặc không phải ảnh
    throw new Error('Không đọc được file này. Hãy chọn ảnh PNG, WebP, AVIF hoặc GIF.');
  }

  if (!meta.hasAlpha) {
    const loai = (meta.format ?? '').toUpperCase();
    // JPEG là nhầm lẫn hay gặp nhất, và không có đường sửa bằng cách đổi
    // tuỳ chọn xuất file - nói rõ để khỏi thử lại vô ích.
    if (loai === 'JPEG' || loai === 'JPG') {
      throw new Error(
        'File JPG không lưu được vùng trong suốt nên không dùng làm khung được. '
        + 'Xuất lại khung thành PNG (nền trong suốt) rồi tải lên.',
      );
    }
    throw new Error(
      `File khung phải có nền trong suốt (vùng để lộ ảnh khách).${loai ? ` File này là ${loai} đặc.` : ''}`,
    );
  }

  const { data, info } = await img
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;

  // Tách riêng kênh alpha cho vòng gom vùng đỡ phải nhân chỉ số mỗi lần đọc
  const alpha = new Uint8Array(w * h);
  for (let i = 0, p = info.channels - 1; i < alpha.length; i++, p += info.channels) {
    alpha[i] = data[p];
  }

  const minArea = w * h * MIN_AREA_RATIO;

  const kept = findRegions(alpha, w, h)
    .filter((r) => r.area >= minArea)
    /*
     * BỎ vùng chạm vào mép ảnh.
     *
     * Khung thật thường có nền ngoài trong suốt: thẻ bo góc tròn, hoặc ảnh
     * xuất ra rộng hơn khung một chút. Vùng đó nối liền quanh cả tấm ảnh nên
     * bị gom thành MỘT "ô" phủ kín 100% — hiện lên thành một ô thừa bao trọn
     * khung, làm sai cả số ô lẫn thứ tự đánh số.
     *
     * Lỗ đặt ảnh thật luôn nằm LỌT HẲN bên trong khung, không bao giờ chạm mép.
     *
     * Dùng NGƯỠNG 2% chứ không đòi chạm đúng pixel mép: thẻ bo góc tròn hay
     * ảnh có viền mờ thì vùng nền ngoài dừng lại cách mép vài pixel, đòi chạm
     * tuyệt đối sẽ để lọt đúng những khung đó.
     */
    .filter((r) => {
      const edge = Math.max(2, Math.round(Math.min(w, h) * 0.02));
      const touchesEdge =
        r.x0 <= edge || r.y0 <= edge || r.x1 >= w - 1 - edge || r.y1 >= h - 1 - edge;
      // Vùng bao gần trọn tấm ảnh là nền ngoài, không phải lỗ đặt ảnh
      const coversAll = (r.x1 - r.x0) > w * 0.95 && (r.y1 - r.y0) > h * 0.95;
      return !touchesEdge && !coversAll;
    });

  const slots = kept
    .map((r) => ({
      x: r.x0 / w,
      y: r.y0 / h,
      // +1 vì x1/y1 là chỉ số pixel cuối, tính cả nó
      w: (r.x1 - r.x0 + 1) / w,
      h: (r.y1 - r.y0 + 1) / h,
    }));

  return { width: w, height: h, slots: readingOrder(slots) };
}
