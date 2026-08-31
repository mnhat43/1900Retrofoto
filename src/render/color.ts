import type { ColorState } from '../core/types';

/**
 * Chỉnh màu bằng vòng lặp pixel thuần JS.
 *
 * VÌ SAO KHÔNG DÙNG CSS filter HAY ctx.filter:
 * - CSS filter chỉ ăn ở preview; muốn export phải viết lại logic -> hai bản
 *   cài đặt của cùng một phép toán, chắc chắn lệch nhau theo thời gian.
 * - ctx.filter: Safari hỗ trợ không ổn định (ẩn sau cờ preference), sẽ IM LẶNG
 *   không áp dụng trên iPhone — kiểu lỗi tệ nhất cho sản phẩm in.
 *
 * Hàm này chạy y hệt ở cả preview lẫn export, nên "nhìn sao xuất vậy" là do
 * CẤU TRÚC, không phải do giữ gìn thủ công.
 *
 * Hiệu năng: dải 600x1800 = 1.1MP, khoảng 15-40ms — thừa nhanh cho export,
 * và preview còn nhỏ hơn nhiều nên chạy realtime tốt.
 */

/** Hệ số sáng Rec.709 — ghi rõ để không bao giờ lệch ngầm giữa các nơi dùng. */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

export type Preset = {
  id: string;
  label: string;
  /** Ma trận màu tuỳ chọn, áp trước brightness/contrast/saturation. */
  matrix?: number[]; // 9 phần tử, hàng-chính
  saturation?: number;
  /** Cộng thêm vào slider của người dùng, -1..1. */
  brightness?: number;
  contrast?: number;
};

/**
 * Bộ lọc màu.
 *
 * Ma trận là phép biến đổi RGB tuyến tính: mỗi hàng nói kênh đầu ra lấy bao
 * nhiêu từ R, G, B đầu vào. Tổng mỗi hàng quanh 1.0 thì giữ nguyên độ sáng;
 * lớn hơn thì sáng lên, nhỏ hơn thì tối đi.
 */
export const PRESETS: Preset[] = [
  { id: 'none', label: 'Gốc' },

  // --- Cổ điển ---
  { id: 'bw', label: 'Đen trắng', saturation: -1, contrast: 0.12 },
  {
    id: 'sepia',
    label: 'Sepia',
    matrix: [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131],
  },
  {
    id: 'vintage',
    label: 'Hoài cổ',
    matrix: [1.05, 0.08, 0.02, 0.03, 0.95, 0.04, 0.05, 0.08, 0.82],
    saturation: -0.15,
    brightness: 0.04,
  },

  // --- Nhiệt độ màu ---
  {
    id: 'warm',
    label: 'Ấm',
    matrix: [1.08, 0.03, 0.0, 0.02, 1.0, 0.0, 0.0, 0.0, 0.9],
  },
  {
    id: 'cool',
    label: 'Lạnh',
    matrix: [0.9, 0.0, 0.03, 0.0, 1.0, 0.02, 0.0, 0.03, 1.09],
  },
  {
    id: 'sunset',
    label: 'Hoàng hôn',
    matrix: [1.14, 0.06, 0.0, 0.04, 0.96, 0.0, 0.02, 0.0, 0.86],
    saturation: 0.12,
  },
  {
    id: 'mint',
    label: 'Bạc hà',
    matrix: [0.88, 0.04, 0.02, 0.0, 1.06, 0.03, 0.02, 0.06, 1.0],
    brightness: 0.05,
  },

  // --- Film ---
  {
    id: 'film',
    label: 'Film',
    matrix: [1.02, 0.05, -0.03, 0.02, 0.98, 0.02, 0.03, 0.06, 0.95],
  },
  {
    id: 'kodak',
    label: 'Kodak',
    matrix: [1.12, 0.02, -0.02, 0.0, 1.02, 0.0, -0.02, 0.02, 0.92],
    saturation: 0.18,
    contrast: 0.08,
  },
  {
    id: 'fuji',
    label: 'Fuji',
    matrix: [0.96, 0.04, 0.0, 0.0, 1.06, 0.02, 0.0, 0.04, 1.02],
    saturation: 0.1,
  },
  {
    id: 'polaroid',
    label: 'Polaroid',
    matrix: [1.06, 0.06, 0.04, 0.03, 1.0, 0.04, 0.05, 0.06, 0.98],
    saturation: -0.1,
    brightness: 0.08,
    contrast: -0.1,
  },

  // --- Hiện đại ---
  { id: 'fade', label: 'Phai màu', saturation: -0.35, contrast: -0.12, brightness: 0.06 },
  { id: 'vivid', label: 'Rực rỡ', saturation: 0.4, contrast: 0.14 },
  {
    id: 'candy',
    label: 'Kẹo ngọt',
    matrix: [1.08, 0.02, 0.06, 0.02, 1.0, 0.06, 0.06, 0.02, 1.06],
    saturation: 0.25,
    brightness: 0.06,
  },
  {
    id: 'noir',
    label: 'Noir',
    saturation: -1,
    contrast: 0.34,
    brightness: -0.05,
  },
];

const PRESET_MAP = new Map(PRESETS.map((p) => [p.id, p]));

/** Không cần xử lý gì -> bỏ qua cả vòng lặp pixel. */
export function isIdentity(c: ColorState): boolean {
  return (
    (c.presetId === 'none' || !PRESET_MAP.has(c.presetId)) &&
    // Mọi thanh phải bằng 0. Thiếu một cái ở đây thì thanh đó sẽ bị bỏ qua
    // im lặng — kéo mà ảnh không đổi gì.
    !c.brightness && !c.contrast && !c.saturation &&
    !c.exposure && !c.highlights && !c.shadows && !c.white && !c.black &&
    !c.temperature && !c.tint && !c.vibrance &&
    !c.clarity && !c.smoothSkin
  );
}

/** Không đổi gì -> bỏ qua cả vòng lặp pixel. */
const off = (v: number | undefined) => !v;

/**
 * Áp thông số màu lên ảnh.
 *
 * THỨ TỰ PHÉP TOÁN theo đúng cách Lightroom làm, và không được đổi tuỳ tiện:
 *   matrix (preset) -> nhiệt độ/tint -> exposure -> vùng sáng/tối
 *   -> điểm trắng/đen -> brightness -> contrast -> vibrance -> saturation
 *
 * Đổi thứ tự sẽ cho ảnh khác hẳn với cùng bộ số, làm hỏng những bộ lọc
 * nhân viên đã lưu từ trước.
 */
export function applyColor(image: ImageData, c: ColorState): void {
  const preset = PRESET_MAP.get(c.presetId);
  const data = image.data;

  const m = preset?.matrix;
  // Thông số preset cộng dồn với slider người dùng — người dùng chỉnh thêm
  // trên nền preset, giống cách Instagram/Lightroom làm.
  const sat = 1 + c.saturation + (preset?.saturation ?? 0);
  const bright = (c.brightness + (preset?.brightness ?? 0)) * 255;
  const contrast = 1 + c.contrast + (preset?.contrast ?? 0);

  // Exposure là phép NHÂN theo cấp số nhân (giống bù sáng trên máy ảnh),
  // khác brightness là phép cộng — nên hai thanh này cho cảm giác khác nhau.
  const expMul = off(c.exposure) ? 1 : Math.pow(2, c.exposure!);

  // Nhiệt độ: ấm thì thêm đỏ bớt lam, lạnh thì ngược lại
  const tempR = off(c.temperature) ? 0 : c.temperature! * 30;
  const tempB = off(c.temperature) ? 0 : -c.temperature! * 30;
  const tintG = off(c.tint) ? 0 : -c.tint! * 24;
  const tintRB = off(c.tint) ? 0 : c.tint! * 12;

  const hi = c.highlights ?? 0;
  const sh = c.shadows ?? 0;
  const wh = c.white ?? 0;
  const bl = c.black ?? 0;
  const vib = c.vibrance ?? 0;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    if (m) {
      const nr = r * m[0] + g * m[1] + b * m[2];
      const ng = r * m[3] + g * m[4] + b * m[5];
      const nb = r * m[6] + g * m[7] + b * m[8];
      r = nr;
      g = ng;
      b = nb;
    }

    if (tempR !== 0 || tintG !== 0) {
      r += tempR + tintRB;
      g += tintG;
      b += tempB + tintRB;
    }

    if (expMul !== 1) {
      r *= expMul;
      g *= expMul;
      b *= expMul;
    }

    /*
     * Vùng sáng / vùng tối.
     *
     * Trọng số theo độ sáng của chính pixel: pixel càng sáng thì thanh
     * "vùng sáng" càng ăn, pixel càng tối thì thanh "vùng tối" càng ăn.
     * Nhờ vậy kéo vùng tối lên không làm bệch cả bầu trời.
     */
    if (hi !== 0 || sh !== 0 || wh !== 0 || bl !== 0) {
      const lum = (r * LUMA_R + g * LUMA_G + b * LUMA_B) / 255;

      if (hi !== 0) {
        const w = lum * lum;                 // chỉ ăn mạnh ở vùng sáng
        const d = hi * 90 * w;
        r += d; g += d; b += d;
      }
      if (sh !== 0) {
        const t = 1 - lum;
        const w = t * t;                     // chỉ ăn mạnh ở vùng tối
        const d = sh * 90 * w;
        r += d; g += d; b += d;
      }
      if (wh !== 0) {
        const d = wh * 60 * lum;
        r += d; g += d; b += d;
      }
      if (bl !== 0) {
        const d = bl * 60 * (1 - lum);
        r += d; g += d; b += d;
      }
    }

    if (bright !== 0) {
      r += bright;
      g += bright;
      b += bright;
    }

    if (contrast !== 1) {
      r = (r - 128) * contrast + 128;
      g = (g - 128) * contrast + 128;
      b = (b - 128) * contrast + 128;
    }

    /*
     * Vibrance: đẩy màu NHẠT lên nhiều, màu đã đậm thì gần như để yên.
     * Đây là lý do nó giữ được màu da tự nhiên trong khi saturation thì không.
     */
    if (vib !== 0) {
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const cur = (mx - mn) / 255;           // độ bão hoà hiện tại 0..1
      const k = 1 + vib * (1 - cur);
      const lum = r * LUMA_R + g * LUMA_G + b * LUMA_B;
      r = lum + (r - lum) * k;
      g = lum + (g - lum) * k;
      b = lum + (b - lum) * k;
    }

    if (sat !== 1) {
      const lum = r * LUMA_R + g * LUMA_G + b * LUMA_B;
      r = lum + (r - lum) * sat;
      g = lum + (g - lum) * sat;
      b = lum + (b - lum) * sat;
    }

    data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }

  // Clarity và làm mịn da cần biết pixel xung quanh -> làm riêng sau vòng trên
  if (!off(c.clarity)) applyClarity(image, c.clarity!);
  if (!off(c.smoothSkin)) applySmoothSkin(image, c.smoothSkin!);
}

/**
 * Làm mờ hộp một lần, bán kính r — dùng làm nền cho clarity và mịn da.
 *
 * Tách hai chiều (ngang rồi dọc) nên chi phí là O(pixel) chứ không O(pixel·r²);
 * ở bán kính lớn thì đây là khác biệt giữa "mượt" và "treo máy".
 */
function boxBlur(src: Uint8ClampedArray, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h * 3);
  const out = new Float32Array(w * h * 3);
  const win = r * 2 + 1;

  for (let y = 0; y < h; y++) {
    for (let ch = 0; ch < 3; ch++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) {
        const xi = x < 0 ? 0 : x >= w ? w - 1 : x;
        sum += src[(y * w + xi) * 4 + ch];
      }
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 3 + ch] = sum / win;
        const xo = x - r, xn = x + r + 1;
        sum -= src[(y * w + (xo < 0 ? 0 : xo)) * 4 + ch];
        sum += src[(y * w + (xn >= w ? w - 1 : xn)) * 4 + ch];
      }
    }
  }

  for (let x = 0; x < w; x++) {
    for (let ch = 0; ch < 3; ch++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) {
        const yi = y < 0 ? 0 : y >= h ? h - 1 : y;
        sum += tmp[(yi * w + x) * 3 + ch];
      }
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 3 + ch] = sum / win;
        const yo = y - r, yn = y + r + 1;
        sum -= tmp[((yo < 0 ? 0 : yo) * w + x) * 3 + ch];
        sum += tmp[((yn >= h ? h - 1 : yn) * w + x) * 3 + ch];
      }
    }
  }
  return out;
}

/** Bán kính mờ theo cỡ ảnh, để hiệu ứng nhìn như nhau ở preview lẫn export. */
const radiusFor = (w: number, h: number, frac: number) =>
  Math.max(1, Math.round(Math.min(w, h) * frac));

/**
 * Clarity — tăng tương phản CỤC BỘ.
 *
 * Lấy ảnh trừ đi bản mờ để ra phần chi tiết, rồi cộng ngược lại có khuếch đại
 * (unsharp mask). Khác contrast ở chỗ nó không đụng tới tương phản tổng thể,
 * nên ảnh "đanh" hơn mà vùng sáng/tối không bị cháy.
 */
function applyClarity(image: ImageData, amount: number): void {
  const { width: w, height: h, data } = image;
  const blur = boxBlur(data, w, h, radiusFor(w, h, 0.012));
  const k = amount * 1.2;

  for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
    for (let ch = 0; ch < 3; ch++) {
      const v = data[i + ch] + (data[i + ch] - blur[p + ch]) * k;
      data[i + ch] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

/**
 * Làm mịn da.
 *
 * Trộn về phía bản mờ, nhưng CHỈ ở pixel có màu giống da. Làm mịn cả ảnh sẽ
 * xoá mất chi tiết tóc và quần áo, nhìn như tranh vẽ.
 *
 * Chỉ nhận diện theo màu, không dùng AI — đủ tốt cho ảnh chân dung trong
 * buồng chụp, và chạy được ngay trên điện thoại.
 */
function applySmoothSkin(image: ImageData, amount: number): void {
  if (amount <= 0) return;
  const { width: w, height: h, data } = image;
  const blur = boxBlur(data, w, h, radiusFor(w, h, 0.006));

  for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];

    // Khoảng màu da người, đủ rộng cho mọi tông da
    const isSkin =
      r > 60 && g > 30 && b > 15 &&
      r > g && g > b &&
      r - b > 12 && r - b < 130;
    if (!isSkin) continue;

    // Càng gần giữa dải da càng mịn nhiều, ra rìa thì nhạt dần -> không lộ mép
    const edge = Math.min(1, (r - b) / 40, (130 - (r - b)) / 40);
    const k = amount * Math.max(0, edge);

    for (let ch = 0; ch < 3; ch++) {
      data[i + ch] = data[i + ch] + (blur[p + ch] - data[i + ch]) * k;
    }
  }
}
