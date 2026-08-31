/**
 * Khổ giấy — phụ thuộc vào khung, không còn là hằng số toàn cục.
 *
 * Chọn số ô là ra khổ tương ứng:
 *   3, 4 ô  -> dải dọc 2x6 inch   (600x1800)
 *   6 ô     -> tờ 4x6 inch        (1200x1800), lưới 2x3
 *   9 ô     -> tờ vuông 6x6 inch  (1800x1800), lưới 3x3
 *
 * Tất cả đều cách rất xa trần canvas của iOS Safari (16.7MP) — lớn nhất là
 * 9 ô ở 3.2MP — nên không cần render theo dải (tiled) hay WebGL.
 * Canvas 2D thuần là đủ.
 *
 * Toạ độ ô là chuẩn hoá 0..1 nên cùng một khung chạy đúng ở mọi khổ và mọi DPI.
 */
export const DPI = 300;

export type PageFormat = {
  id: string;
  label: string;
  widthInch: number;
  heightInch: number;
};

export const FORMATS = {
  /** Dải dọc photobooth cổ điển. */
  strip: {
    id: 'strip',
    label: '2×6 inch',
    widthInch: 2,
    heightInch: 6,
  },
  /** Tờ 4x6 nằm dọc — lưới 2 cột. */
  sheet46: {
    id: 'sheet46',
    label: '4×6 inch',
    widthInch: 4,
    heightInch: 6,
  },
  /** Tờ vuông 6x6 — lưới 3x3. */
  square66: {
    id: 'square66',
    label: '6×6 inch',
    widthInch: 6,
    heightInch: 6,
  },
} as const satisfies Record<string, PageFormat>;

export type FormatId = keyof typeof FORMATS;

/** Kích thước pixel của một khổ ở 300 DPI. */
export function formatPx(format: PageFormat) {
  return {
    w: Math.round(format.widthInch * DPI),
    h: Math.round(format.heightInch * DPI),
  };
}

/**
 * Kích thước pixel của một khung.
 *
 * Khung tải lên có thể tự khai kích thước in (widthInch/heightInch) — quán in
 * khổ nào cũng được, không bó vào 3 khổ dựng sẵn. Không khai thì quay về khổ
 * theo formatId như cũ.
 */
export function framePx(frame: {
  formatId: string;
  widthInch?: number;
  heightInch?: number;
}) {
  if (frame.widthInch && frame.heightInch) {
    return {
      w: Math.round(frame.widthInch * DPI),
      h: Math.round(frame.heightInch * DPI),
    };
  }
  const f = FORMATS[frame.formatId as FormatId] ?? FORMATS.strip;
  return formatPx(f);
}

/** Nhãn hiển thị: "4×6 inch". Rút gọn số lẻ thừa (4.0 -> 4). */
export function frameSizeLabel(frame: {
  formatId: string;
  widthInch?: number;
  heightInch?: number;
}): string {
  if (frame.widthInch && frame.heightInch) {
    const n = (v: number) => String(Number(v.toFixed(2)));
    return `${n(frame.widthInch)}×${n(frame.heightInch)} inch`;
  }
  return FORMATS[frame.formatId as FormatId]?.label ?? frame.formatId;
}
