import { getDb } from './db.ts';

/**
 * Thiết lập nhân viên đổi được lúc server đang chạy.
 *
 * Khác với CONFIG (đọc từ biến môi trường, cố định suốt một lần chạy): những
 * thứ ở đây đổi ngay trên trang quản lý, có hiệu lực lập tức.
 *
 * Mọi giá trị đọc ra đều đã được kẹp về khoảng hợp lệ, kể cả khi trong
 * database là rác — chỉnh tay database hay lỗi nửa chừng không được phép
 * làm server hành xử kỳ quặc.
 */

/** Trần ảnh mặc định cho một phiên khi nhân viên chưa đổi gì. */
export const MAX_PHOTOS_DEFAULT = 100;

/**
 * Khoảng cho phép của trần ảnh.
 *
 * Trần trên 500 không phải giới hạn kỹ thuật mà là lưới an toàn: nếu thư mục
 * chụp bị trỏ nhầm vào kho ảnh cũ, "Đã chụp xong" sẽ nạp sạch kho đó vào
 * phiên của khách. Có trần thì thiệt hại dừng ở 500 ảnh thay vì cả ổ đĩa.
 */
export const MAX_PHOTOS_MIN = 1;
export const MAX_PHOTOS_MAX = 500;

const KEY_MAX_PHOTOS = 'max_photos_per_session';

function readRaw(key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function writeRaw(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

/** Kẹp về số nguyên trong khoảng cho phép. Không đọc được thì trả mặc định. */
export function clampMaxPhotos(value: unknown): number {
  /*
   * Chặn null / undefined / chuỗi rỗng TRƯỚC khi ép kiểu.
   *
   * Number(null) và Number('') đều ra 0 — một số hợp lệ về mặt kiểu, và sẽ bị
   * kẹp lên 1. Tức là "không có giá trị" lặng lẽ biến thành "trần bằng 1", và
   * cả quán chỉ chụp được đúng một ảnh mỗi phiên. Ba trường hợp này phải rơi
   * về mặc định, không phải về biên dưới.
   */
  if (value === null || value === undefined || value === '') {
    return MAX_PHOTOS_DEFAULT;
  }
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return MAX_PHOTOS_DEFAULT;
  return Math.min(MAX_PHOTOS_MAX, Math.max(MAX_PHOTOS_MIN, n));
}

/** Trần ảnh áp cho các phiên tạo MỚI. Phiên đã tạo giữ trần lúc nó ra đời. */
export function maxPhotosPerSession(): number {
  const raw = readRaw(KEY_MAX_PHOTOS);
  if (raw === null) return MAX_PHOTOS_DEFAULT;
  return clampMaxPhotos(raw);
}

/** Trả về giá trị đã thực sự lưu (sau khi kẹp), để giao diện hiện đúng. */
export function setMaxPhotosPerSession(value: unknown): number {
  const n = clampMaxPhotos(value);
  writeRaw(KEY_MAX_PHOTOS, String(n));
  return n;
}
