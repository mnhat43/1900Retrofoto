import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Trỏ dữ liệu vào thư mục tạm TRƯỚC khi import module dùng CONFIG.
const dir = mkdtempSync(join(tmpdir(), 'pb-set-'));
process.env.PHOTOBOOTH_DATA = dir;

const { getDb, closeDb } = await import('./db.ts');
const {
  maxPhotosPerSession,
  setMaxPhotosPerSession,
  clampMaxPhotos,
  MAX_PHOTOS_DEFAULT,
  MAX_PHOTOS_MIN,
  MAX_PHOTOS_MAX,
} = await import('./settings.ts');

beforeEach(() => {
  getDb().exec('DELETE FROM settings;');
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('trần ảnh mỗi phiên', () => {
  it('chưa đặt gì thì dùng mặc định', () => {
    expect(maxPhotosPerSession()).toBe(MAX_PHOTOS_DEFAULT);
  });

  it('đặt rồi thì đọc lại đúng', () => {
    setMaxPhotosPerSession(30);
    expect(maxPhotosPerSession()).toBe(30);
  });

  it('đặt lại thì ghi đè, không sinh dòng thứ hai', () => {
    setMaxPhotosPerSession(30);
    setMaxPhotosPerSession(45);
    expect(maxPhotosPerSession()).toBe(45);
    const n = getDb().prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number };
    expect(n.n).toBe(1);
  });

  it('trả về đúng giá trị đã lưu để giao diện hiện lại', () => {
    expect(setMaxPhotosPerSession(77)).toBe(77);
  });
});

/*
 * Giá trị trong database có thể là rác: người sửa tay bằng công cụ SQLite,
 * hoặc một bản cũ ghi kiểu khác. Đọc ra lúc nào cũng phải dùng được ngay,
 * không được để server hành xử kỳ quặc vì một ô dữ liệu hỏng.
 */
describe('kẹp giá trị về khoảng dùng được', () => {
  it('số âm và số 0 nâng lên mức tối thiểu', () => {
    expect(clampMaxPhotos(-5)).toBe(MAX_PHOTOS_MIN);
    expect(clampMaxPhotos(0)).toBe(MAX_PHOTOS_MIN);
  });

  it('số quá lớn hạ xuống mức tối đa', () => {
    expect(clampMaxPhotos(99999)).toBe(MAX_PHOTOS_MAX);
  });

  it('số lẻ cắt thành số nguyên', () => {
    expect(clampMaxPhotos(12.9)).toBe(12);
  });

  /*
   * Number(null) và Number('') đều ra 0 — nếu không chặn riêng thì "không có
   * giá trị" bị kẹp lên 1 và cả quán chỉ chụp được một ảnh mỗi phiên.
   */
  it('chữ và rỗng trả về mặc định, KHÔNG phải mức tối thiểu', () => {
    expect(clampMaxPhotos('abc')).toBe(MAX_PHOTOS_DEFAULT);
    expect(clampMaxPhotos(null)).toBe(MAX_PHOTOS_DEFAULT);
    expect(clampMaxPhotos(undefined)).toBe(MAX_PHOTOS_DEFAULT);
    expect(clampMaxPhotos('')).toBe(MAX_PHOTOS_DEFAULT);
  });

  it('database chứa rác thì vẫn đọc ra số dùng được', () => {
    getDb()
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .run('max_photos_per_session', 'khong-phai-so');
    expect(maxPhotosPerSession()).toBe(MAX_PHOTOS_DEFAULT);
  });

  it('database chứa số ngoài khoảng thì kẹp lại', () => {
    getDb()
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .run('max_photos_per_session', '100000');
    expect(maxPhotosPerSession()).toBe(MAX_PHOTOS_MAX);
  });
});
