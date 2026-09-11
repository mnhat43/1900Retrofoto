import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import sharp from 'sharp';

import { CONFIG } from './config.ts';
import { getDb, now } from './db.ts';
import { detectSlots, type DetectedSlot } from './detect.ts';
import { FRAMES as BUILTIN_FRAMES } from '../src/frames/index.ts';
import { FORMATS } from '../src/core/format.ts';

/**
 * Quản lý khung ảnh do nhân viên tải lên.
 *
 * File PNG nằm ở <dataDir>/frames/, thông tin ở bảng `frames`. Để ngoài mã
 * nguồn như vậy thì khung không mất khi cập nhật code, và thêm/sửa/xoá được
 * ngay trên giao diện mà không phải build lại app.
 */

export type FrameRow = {
  id: string;
  label: string;
  slot_count: number;
  format_id: string;
  slots: string;
  filename: string;
  width: number;
  height: number;
  enabled: number;
  builtin: number;
  sort_order: number;
  created_at: number;
  width_inch: number | null;
  height_inch: number | null;
};

export type FrameInfo = {
  id: string;
  label: string;
  slotCount: number;
  formatId: string;
  slots: Array<{ id: string; rect: DetectedSlot }>;
  overlaySrc: string;
  enabled: boolean;
  builtin: boolean;
  /** Kích thước file PNG, pixel. */
  width: number;
  height: number;
  /** Kích thước in do nhân viên khai, inch. */
  widthInch?: number;
  heightInch?: number;
};

export class FrameError extends Error {}

/** Thư mục chứa file khung. */
export const framesDir = () => join(CONFIG.dataDir, 'frames');

function framePath(filename: string): string {
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new FrameError('Tên file không hợp lệ');
  }
  const root = resolve(framesDir());
  const full = resolve(root, filename);
  if (!full.startsWith(root + sep)) throw new FrameError('Đường dẫn không hợp lệ');
  return full;
}

/**
 * Đoán khổ giấy từ tỉ lệ ảnh.
 *
 * Chọn khổ có tỉ lệ GẦN NHẤT thay vì đòi khớp chính xác — file thiết kế thật
 * hay lệch vài pixel so với tỉ lệ chuẩn, bắt khớp tuyệt đối sẽ từ chối những
 * khung hoàn toàn dùng được.
 */
export function guessFormat(width: number, height: number): string {
  const ratio = width / height;
  let best = 'strip';
  let bestDiff = Infinity;
  for (const f of Object.values(FORMATS)) {
    const diff = Math.abs(f.widthInch / f.heightInch - ratio);
    if (diff < bestDiff) { bestDiff = diff; best = f.id; }
  }
  return best;
}

/**
 * Suy kích thước in từ tỉ lệ ảnh.
 *
 * Nếu tỉ lệ khớp một khổ dựng sẵn (sai số 2%) thì lấy đúng khổ đó — khung
 * 2×6 quen thuộc vẫn ra 2×6. Không khớp khổ nào thì giữ nguyên tỉ lệ và
 * chuẩn hoá cạnh dài về 6 inch, để khung lạ vẫn in ra đúng hình dạng thay vì
 * bị ép vào khổ gần nhất rồi méo.
 */
export function guessSize(width: number, height: number): {
  widthInch: number; heightInch: number;
} {
  const ratio = width / height;
  for (const f of Object.values(FORMATS)) {
    if (Math.abs(f.widthInch / f.heightInch - ratio) < 0.02) {
      return { widthInch: f.widthInch, heightInch: f.heightInch };
    }
  }
  return ratio >= 1
    ? { widthInch: 6, heightInch: round2(6 / ratio) }
    : { widthInch: round2(6 * ratio), heightInch: 6 };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Giới hạn kích thước in.
 *
 * Trần 12 inch không phải con số tuỳ tiện: 12×12 inch ở 300 DPI là 3600×3600
 * = 12.9 triệu pixel, vẫn dưới trần canvas 16.7MP của iOS Safari. Cho phép
 * lớn hơn thì điện thoại khách sẽ render ra ảnh TRẮNG mà không báo lỗi gì.
 */
const MIN_INCH = 1;
const MAX_INCH = 12;

function checkInch(v: number, what: string): number {
  if (!Number.isFinite(v) || v < MIN_INCH || v > MAX_INCH) {
    throw new FrameError(`Kích thước ${what} phải từ ${MIN_INCH} đến ${MAX_INCH} inch`);
  }
  return round2(v);
}

function toInfo(r: FrameRow): FrameInfo {
  const rects = JSON.parse(r.slots) as DetectedSlot[];
  return {
    id: r.id,
    label: r.label,
    slotCount: r.slot_count,
    formatId: r.format_id,
    slots: rects.map((rect, i) => ({ id: `s${i + 1}`, rect })),
    overlaySrc: `/api/frames/${r.id}/image`,
    enabled: r.enabled === 1,
    builtin: r.builtin === 1,
    width: r.width,
    height: r.height,
    widthInch: r.width_inch ?? undefined,
    heightInch: r.height_inch ?? undefined,
  };
}

/**
 * Nạp 6 khung dựng sẵn vào database ở lần chạy đầu.
 *
 * Nhờ vậy MỌI khung đều nằm chung một chỗ: nhân viên bật/tắt, đổi tên hay xoá
 * khung mẫu y như khung tự tải lên, không phải phân biệt hai loại.
 *
 * Chỉ chạy khi bảng rỗng — đã xoá khung mẫu thì không tự mọc lại.
 */
export function seedBuiltins(): void {
  const db = getDb();
  const n = (db.prepare('SELECT COUNT(*) AS n FROM frames').get() as { n: number }).n;
  if (n > 0) return;

  mkdirSync(framesDir(), { recursive: true });
  const t = now();

  BUILTIN_FRAMES.forEach((f, i) => {
    const src = join(process.cwd(), 'public', 'frames', `${f.id}.png`);
    if (!existsSync(src)) return;

    const filename = `${f.id}.png`;
    // Chép ĐỒNG BỘ: ghi bản ghi xong mà file chưa kịp có thì request đầu tiên
    // sẽ trả 404 cho một khung đang hiện trong danh sách.
    writeFileSync(framePath(filename), readFileSync(src));

    const fmt = FORMATS[f.formatId];
    db.prepare(`
      INSERT INTO frames
        (id, label, slot_count, format_id, slots, filename, width, height,
         enabled, builtin, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
    `).run(
      f.id, f.label, f.slotCount, f.formatId,
      JSON.stringify(f.slots.map((s) => s.rect)),
      filename,
      Math.round(fmt.widthInch * 300),
      Math.round(fmt.heightInch * 300),
      i, t,
    );
  });
}

export function listFrames(opts: { onlyEnabled?: boolean } = {}): FrameInfo[] {
  const db = getDb();
  const rows = db.prepare(
    opts.onlyEnabled
      ? 'SELECT * FROM frames WHERE enabled = 1 ORDER BY sort_order, created_at'
      : 'SELECT * FROM frames ORDER BY sort_order, created_at',
  ).all() as FrameRow[];
  return rows.map(toInfo);
}

export function getFrame(id: string): FrameInfo | null {
  const r = getDb().prepare('SELECT * FROM frames WHERE id = ?').get(id) as FrameRow | undefined;
  return r ? toInfo(r) : null;
}

/** Đọc file PNG của khung. Trả null nếu khung hoặc file không còn. */
export function readFrameImage(id: string): Buffer | null {
  const r = getDb().prepare('SELECT filename FROM frames WHERE id = ?').get(id) as
    { filename: string } | undefined;
  if (!r) return null;
  try {
    return readFileSync(framePath(r.filename));
  } catch {
    return null;
  }
}

/**
 * Dò thử một file khung mà CHƯA lưu.
 *
 * Có bước này thì nhân viên xem trước được kết quả dò rồi mới quyết định —
 * lưu thẳng rồi mới phát hiện dò sai thì khách đã kịp thấy khung hỏng.
 */
export async function analyzeFrame(png: Buffer): Promise<{
  width: number; height: number; formatId: string;
  widthInch: number; heightInch: number;
  slots: DetectedSlot[];
}> {
  const r = await detectSlots(png);
  if (r.slots.length === 0) {
    throw new FrameError('Không tìm thấy ô trống nào trong file khung');
  }
  const size = guessSize(r.width, r.height);
  return {
    width: r.width,
    height: r.height,
    formatId: guessFormat(r.width, r.height),
    widthInch: size.widthInch,
    heightInch: size.heightInch,
    slots: r.slots,
  };
}

export async function createFrame(opts: {
  label: string;
  png: Buffer;
  /** Ghi đè toạ độ dò tự động — dùng khi nhân viên nắn tay. */
  slots?: DetectedSlot[];
  formatId?: string;
  /** Kích thước in, inch. Không truyền thì suy từ tỉ lệ ảnh. */
  widthInch?: number;
  heightInch?: number;
}): Promise<FrameInfo> {
  const label = opts.label.trim();
  if (!label) throw new FrameError('Chưa đặt tên khung');

  const detected = await analyzeFrame(opts.png);
  const slots = opts.slots?.length ? opts.slots : detected.slots;
  const formatId = opts.formatId ?? detected.formatId;
  const widthInch = checkInch(opts.widthInch ?? detected.widthInch, 'chiều rộng');
  const heightInch = checkInch(opts.heightInch ?? detected.heightInch, 'chiều cao');

  const db = getDb();
  const id = randomUUID();
  const filename = `${id}.png`;

  /*
   * Lưu thành PNG THẬT, không ghi thẳng buffer gốc.
   *
   * Nhân viên tải lên được cả WebP/AVIF/GIF, nhưng file lưu ra tên .png và
   * mọi nơi phục vụ nó đều khai 'content-type: image/png'. Ghi nguyên buffer
   * thì thành file WebP đội lốt PNG — trình duyệt cũ và khâu in sẽ từ chối,
   * mà triệu chứng chỉ là "khung không hiện" chứ không nói vì sao.
   *
   * GIF nhiều khung thì chỉ lấy khung đầu: khung ảnh là hình tĩnh, và
   * detectSlots cũng chỉ đọc khung đầu nên toạ độ ô mới khớp với file lưu ra.
   */
  const kieuFile = (await sharp(opts.png).metadata()).format;
  const pngData = kieuFile === 'png'
    ? opts.png
    : await sharp(opts.png, { animated: false }).png().toBuffer();

  mkdirSync(framesDir(), { recursive: true });
  await writeFile(framePath(filename), pngData);

  const maxOrder = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM frames')
    .get() as { m: number }).m;

  db.prepare(`
    INSERT INTO frames
      (id, label, slot_count, format_id, slots, filename, width, height,
       enabled, builtin, sort_order, created_at, width_inch, height_inch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?)
  `).run(
    id, label, slots.length, formatId, JSON.stringify(slots), filename,
    detected.width, detected.height, maxOrder + 1, now(),
    widthInch, heightInch,
  );

  return getFrame(id)!;
}

export function updateFrame(
  id: string,
  patch: {
    label?: string; enabled?: boolean; slots?: DetectedSlot[]; formatId?: string;
    widthInch?: number; heightInch?: number;
  },
): FrameInfo | null {
  const db = getDb();
  if (!getFrame(id)) return null;

  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) throw new FrameError('Chưa đặt tên khung');
    db.prepare('UPDATE frames SET label = ? WHERE id = ?').run(label, id);
  }
  if (patch.enabled !== undefined) {
    db.prepare('UPDATE frames SET enabled = ? WHERE id = ?').run(patch.enabled ? 1 : 0, id);
  }
  if (patch.formatId !== undefined) {
    db.prepare('UPDATE frames SET format_id = ? WHERE id = ?').run(patch.formatId, id);
  }
  if (patch.widthInch !== undefined) {
    db.prepare('UPDATE frames SET width_inch = ? WHERE id = ?')
      .run(checkInch(patch.widthInch, 'chiều rộng'), id);
  }
  if (patch.heightInch !== undefined) {
    db.prepare('UPDATE frames SET height_inch = ? WHERE id = ?')
      .run(checkInch(patch.heightInch, 'chiều cao'), id);
  }
  if (patch.slots?.length) {
    db.prepare('UPDATE frames SET slots = ?, slot_count = ? WHERE id = ?')
      .run(JSON.stringify(patch.slots), patch.slots.length, id);
  }
  return getFrame(id);
}

/**
 * Xoá khung và file PNG của nó.
 *
 * Ảnh khách ĐÃ ghép không bị ảnh hưởng: file PNG kết quả đã lưu riêng. Chỉ
 * `recipe` là không dựng lại được — đổi lấy việc nhân viên dọn được khung cũ.
 */
export function deleteFrame(id: string): boolean {
  const db = getDb();
  const r = db.prepare('SELECT filename FROM frames WHERE id = ?').get(id) as
    { filename: string } | undefined;
  if (!r) return false;

  db.prepare('DELETE FROM frames WHERE id = ?').run(id);
  try {
    rmSync(framePath(r.filename), { force: true });
  } catch { /* mất file thì thôi, bản ghi đã xoá là đủ */ }
  return true;
}
