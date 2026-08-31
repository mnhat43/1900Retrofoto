import type { Frame, Slot } from '../core/types';
import type { FormatId } from '../core/format';

/**
 * Thư viện khung dựng sẵn.
 *
 * Mỗi khung = 1 file PNG (public/frames/*.png, đúng khổ của khung, có vùng
 * trong suốt) + 1 entry ở đây khai báo toạ độ ô khớp với các lỗ trên PNG.
 * Toạ độ vẽ bằng trang tuner, không gõ tay.
 *
 * Số ô quyết định bố cục và khổ giấy:
 *   3, 4 ô -> 1 cột, dải dọc 2x6 inch
 *   6 ô    -> 2 cột x 3 hàng, tờ 4x6 inch
 *   9 ô    -> 3 cột x 3 hàng, tờ vuông 6x6 inch
 */

type GridOpts = {
  cols: number;
  rows: number;
  /** Lề ngoài, chuẩn hoá theo chiều tương ứng. */
  padX: number;
  padTop: number;
  padBottom: number;
  /** Khoảng cách giữa các ô. */
  gapX?: number;
  gapY: number;
};

/** Sinh lưới ô đều nhau, đánh số theo hàng (trái sang phải, trên xuống dưới). */
export function gridSlots(o: GridOpts): Slot[] {
  const gapX = o.gapX ?? o.gapY;
  const usableW = 1 - o.padX * 2 - gapX * (o.cols - 1);
  const usableH = 1 - o.padTop - o.padBottom - o.gapY * (o.rows - 1);
  const w = usableW / o.cols;
  const h = usableH / o.rows;

  const slots: Slot[] = [];
  for (let r = 0; r < o.rows; r++) {
    for (let c = 0; c < o.cols; c++) {
      slots.push({
        id: `s${slots.length + 1}`,
        rect: {
          x: o.padX + c * (w + gapX),
          y: o.padTop + r * (h + o.gapY),
          w,
          h,
        },
      });
    }
  }
  return slots;
}

/** Cấu hình lưới chuẩn theo số ô — dùng chung cho app và script sinh khung. */
export const LAYOUTS: Record<
  number,
  { formatId: FormatId; grid: GridOpts }
> = {
  3: {
    formatId: 'strip',
    grid: { cols: 1, rows: 3, padX: 0.06, padTop: 0.04, padBottom: 0.14, gapY: 0.02 },
  },
  4: {
    formatId: 'strip',
    grid: { cols: 1, rows: 4, padX: 0.06, padTop: 0.035, padBottom: 0.13, gapY: 0.018 },
  },
  6: {
    formatId: 'sheet46',
    grid: {
      cols: 2,
      rows: 3,
      padX: 0.04,
      padTop: 0.035,
      padBottom: 0.11,
      gapX: 0.035,
      gapY: 0.02,
    },
  },
  9: {
    formatId: 'square66',
    grid: {
      cols: 3,
      rows: 3,
      padX: 0.035,
      padTop: 0.035,
      padBottom: 0.1,
      gapX: 0.028,
      gapY: 0.028,
    },
  },
};

/** Dựng một khung dùng lưới chuẩn của số ô đó. */
function preset(
  id: string,
  label: string,
  slotCount: number,
  tags: string[],
): Frame {
  const layout = LAYOUTS[slotCount];
  if (!layout) throw new Error(`Chưa có bố cục cho ${slotCount} ô`);
  return {
    id,
    label,
    slotCount,
    formatId: layout.formatId,
    overlaySrc: `/frames/${id}.png`,
    slots: gridSlots(layout.grid),
    tags,
  };
}

export const FRAMES: Frame[] = [
  preset('basic-3', 'Basic 3', 3, ['cơ bản', 'trắng']),
  preset('basic-4', 'Basic 4', 4, ['cơ bản', 'trắng']),
  preset('film-4', 'Film 4', 4, ['phim', 'đen']),
  preset('basic-6', 'Basic 6', 6, ['cơ bản', 'trắng', 'lưới']),
  preset('film-6', 'Film 6', 6, ['phim', 'đen', 'lưới']),
  preset('basic-9', 'Basic 9', 9, ['cơ bản', 'trắng', 'lưới']),
];

export const getFrame = (id: string): Frame | undefined =>
  FRAMES.find((f) => f.id === id);

/** Tìm khung theo tên hoặc tag, lọc theo số ô. */
export function searchFrames(query: string, slotCount?: number): Frame[] {
  const q = query.trim().toLowerCase();
  return FRAMES.filter((f) => {
    if (slotCount != null && f.slotCount !== slotCount) return false;
    if (!q) return true;
    return (
      f.label.toLowerCase().includes(q) ||
      f.id.toLowerCase().includes(q) ||
      (f.tags ?? []).some((t) => t.toLowerCase().includes(q))
    );
  });
}

/** Các số ô có trong thư viện, để dựng bộ lọc. */
export const SLOT_COUNTS = [...new Set(FRAMES.map((f) => f.slotCount))].sort(
  (a, b) => a - b,
);
