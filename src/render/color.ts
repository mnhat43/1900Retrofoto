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
    c.brightness === 0 &&
    c.contrast === 0 &&
    c.saturation === 0
  );
}

export function applyColor(image: ImageData, c: ColorState): void {
  const preset = PRESET_MAP.get(c.presetId);
  const data = image.data;

  const m = preset?.matrix;
  // Thông số preset cộng dồn với slider người dùng — người dùng chỉnh thêm
  // trên nền preset, giống cách Instagram/Lightroom làm.
  const sat = 1 + c.saturation + (preset?.saturation ?? 0);
  const bright = (c.brightness + (preset?.brightness ?? 0)) * 255;
  const contrast = 1 + c.contrast + (preset?.contrast ?? 0);

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

    if (sat !== 1) {
      const lum = r * LUMA_R + g * LUMA_G + b * LUMA_B;
      r = lum + (r - lum) * sat;
      g = lum + (g - lum) * sat;
      b = lum + (b - lum) * sat;
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

    data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
}
