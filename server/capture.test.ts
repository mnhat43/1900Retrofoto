import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const dir = mkdtempSync(join(tmpdir(), 'pb-capture-'));
process.env.PHOTOBOOTH_DATA = dir;

const { getDb, closeDb } = await import('./db.ts');
const { createSession, claimSession } = await import('./session.ts');
const { addPhoto, listPhotos, countPhotos, CaptureError } = await import('./capture.ts');

const jpeg = (w = 800, h = 600) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 60, b: 60 } } })
    .jpeg()
    .toBuffer();

async function openSession(maxPhotos: number, room = '1') {
  const s = createSession({ maxPhotos });
  const r = claimSession(room, s.code);
  if (!r.ok) throw new Error('không mở được phiên');
  return r.session;
}

beforeEach(() => {
  getDb().exec('DELETE FROM photos; DELETE FROM sessions; DELETE FROM code_attempts;');
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('addPhoto', () => {
  it('đánh số thứ tự tăng dần', async () => {
    const s = await openSession(4);
    const a = await addPhoto(s, await jpeg());
    const b = await addPhoto(s, await jpeg());
    expect([a.photo.seq, b.photo.seq]).toEqual([1, 2]);
    expect(b.count).toBe(2);
    expect(b.remaining).toBe(2);
  });

  it('chặn khi vượt số ảnh của gói', async () => {
    const s = await openSession(2);
    await addPhoto(s, await jpeg());
    await addPhoto(s, await jpeg());
    await expect(addPhoto(s, await jpeg())).rejects.toThrow(CaptureError);
  });

  it('từ chối file không phải ảnh', async () => {
    const s = await openSession(4);
    await expect(addPhoto(s, Buffer.from('khong phai anh'))).rejects.toThrow(CaptureError);
  });

  it('file hỏng KHÔNG chiếm mất lượt của gói', async () => {
    const s = await openSession(2);
    await addPhoto(s, await jpeg());
    await expect(addPhoto(s, Buffer.from('rac'))).rejects.toThrow();

    // Vẫn còn 1 lượt chưa dùng
    expect(countPhotos(s.id)).toBe(1);
    const ok = await addPhoto(s, await jpeg());
    expect(ok.photo.seq).toBe(2);
  });

  it('phiên chưa mở khoá thì không nhận ảnh', async () => {
    const s = createSession({ maxPhotos: 4 });   // chưa claim
    await expect(addPhoto(s, await jpeg())).rejects.toThrow(CaptureError);
  });

  it('lưu kích thước đã xoay theo EXIF', async () => {
    const s = await openSession(4);
    const r = await addPhoto(s, await jpeg(1600, 1200));
    expect(r.photo.width).toBe(1600);
    expect(r.photo.height).toBe(1200);
  });
});

describe('nhiều ảnh gửi cùng lúc — chống mất ảnh', () => {
  /**
   * Máy ảnh chụp liên tiếp gửi nhiều ảnh song song. Trước đây tất cả cùng đọc
   * số ảnh hiện có rồi tính ra cùng một seq, làm ảnh bị mất khi ghi database.
   * Test này chốt lại hành vi đúng.
   */
  it('4 ảnh gửi song song thì nhận đủ 4, không mất ảnh nào', async () => {
    const s = await openSession(4);
    const imgs = await Promise.all([jpeg(), jpeg(), jpeg(), jpeg()]);

    const results = await Promise.all(imgs.map((b) => addPhoto(s, b)));

    expect(results).toHaveLength(4);
    expect(listPhotos(s.id)).toHaveLength(4);
    // Mỗi ảnh một seq riêng, không trùng
    expect(new Set(results.map((r) => r.photo.seq)).size).toBe(4);
    expect(results.map((r) => r.photo.seq).sort()).toEqual([1, 2, 3, 4]);
  });

  it('gửi song song nhiều hơn số ảnh của gói thì chỉ nhận đủ số cho phép', async () => {
    const s = await openSession(3);
    const imgs = await Promise.all([jpeg(), jpeg(), jpeg(), jpeg(), jpeg()]);

    const settled = await Promise.allSettled(imgs.map((b) => addPhoto(s, b)));
    const ok = settled.filter((r) => r.status === 'fulfilled');

    expect(ok).toHaveLength(3);
    expect(listPhotos(s.id)).toHaveLength(3);
  });
});

describe('listPhotos', () => {
  it('không hiện dòng đang giữ chỗ (ảnh chưa xử lý xong)', async () => {
    const s = await openSession(4);
    await addPhoto(s, await jpeg());

    // Giả lập một chỗ đã giữ nhưng chưa ghi xong
    getDb()
      .prepare(
        `INSERT INTO photos (id, session_id, seq, filename, source, created_at)
         VALUES ('tam', ?, 2, '', 'pending', 1)`,
      )
      .run(s.id);

    expect(listPhotos(s.id)).toHaveLength(1);
    // countPhotos VẪN đếm để giữ chỗ hoạt động đúng
    expect(countPhotos(s.id)).toBe(2);
  });
});
