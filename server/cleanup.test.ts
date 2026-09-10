import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { rmSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pb-clean-'));
process.env.PHOTOBOOTH_DATA = dir;

const { getDb, closeDb } = await import('./db.ts');
const { createSession } = await import('./session.ts');
const { runCleanup, cleanupTiers, purgeOlderThan, CLEANUP_TIERS } =
  await import('./cleanup.ts');

const { saveFile, sessionDir } = await import('./storage.ts');

beforeEach(() => {
  getDb().exec('DELETE FROM photos; DELETE FROM sessions;');
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const expire = (id: string) =>
  getDb().prepare('UPDATE sessions SET expires_at = 1 WHERE id = ?').run(id);

describe('runCleanup', () => {
  it('xoá ảnh của phiên quá hạn', async () => {
    const s = createSession({ maxPhotos: 4 });
    await saveFile(s.dir, 'originals', '01.jpg', Buffer.from('anh'));
    expect(existsSync(sessionDir(s.dir))).toBe(true);

    expire(s.id);
    expect(runCleanup().purged).toBe(1);
    expect(existsSync(sessionDir(s.dir))).toBe(false);
  });

  it('KHÔNG xoá phiên còn hạn', async () => {
    const s = createSession({ maxPhotos: 4 });
    await saveFile(s.dir, 'originals', '01.jpg', Buffer.from('anh'));

    expect(runCleanup().purged).toBe(0);
    expect(existsSync(sessionDir(s.dir))).toBe(true);
  });

  it('giữ lại bản ghi để nhân viên còn tra được', () => {
    const s = createSession({ maxPhotos: 4 });
    expire(s.id);
    runCleanup();

    const row = getDb()
      .prepare('SELECT status, purged_at FROM sessions WHERE id = ?')
      .get(s.id) as { status: string; purged_at: number };
    expect(row.status).toBe('expired');
    expect(row.purged_at).toBeGreaterThan(0);
  });

  it('chạy lại không xoá thêm lần nữa', () => {
    const s = createSession({ maxPhotos: 4 });
    expire(s.id);
    expect(runCleanup().purged).toBe(1);
    expect(runCleanup().purged).toBe(0);
  });

  it('phiên đã xoá thì không truy cập được nữa', async () => {
    const { getByToken } = await import('./session.ts');
    const s = createSession({ maxPhotos: 4 });
    expire(s.id);
    runCleanup();
    expect(getByToken(s.access_token)).toBeNull();
  });
});

describe('storage — chặn path traversal', () => {
  it('từ chối tên file có ../', async () => {
    await expect(saveFile('x', 'originals', '../../hack.txt', Buffer.from('x')))
      .rejects.toThrow();
  });

  it('từ chối tên file có dấu gạch chéo', async () => {
    await expect(saveFile('x', 'originals', 'a/b.txt', Buffer.from('x')))
      .rejects.toThrow();
  });

  it('từ chối thư mục thoát ra ngoài dataDir', () => {
    expect(() => sessionDir('../../..')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Dọn dẹp theo giai đoạn — nhân viên tự bấm khi ổ đĩa gần đầy
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

/** Đẩy phiên về quá khứ và đặt trạng thái, vì tuổi tính theo created_at. */
const age = (id: string, days: number, status = 'closed') =>
  getDb()
    .prepare('UPDATE sessions SET created_at = ?, status = ? WHERE id = ?')
    .run(Date.now() - days * DAY, status, id);

const addPhotoRow = (sessionId: string, bytes: number) =>
  getDb()
    .prepare(
      `INSERT INTO photos (id, session_id, seq, filename, bytes, created_at)
       VALUES (?, ?, 1, '01.jpg', ?, ?)`,
    )
    .run(`p-${sessionId}`, sessionId, bytes, Date.now());

const tierFor = (days: number) => cleanupTiers().find((t) => t.days === days)!;

describe('cleanupTiers — xem trước sẽ dọn được bao nhiêu', () => {
  it('có đúng các mốc đã khai báo', () => {
    expect(cleanupTiers().map((t) => t.days)).toEqual([...CLEANUP_TIERS]);
  });

  it('mốc rộng hơn thì đếm được ít phiên hơn', () => {
    age(createSession({ maxPhotos: 4 }).id, 40);
    age(createSession({ maxPhotos: 4 }).id, 10);
    age(createSession({ maxPhotos: 4 }).id, 5);

    expect(tierFor(30).sessions).toBe(1);
    expect(tierFor(14).sessions).toBe(1);
    expect(tierFor(7).sessions).toBe(2);
    expect(tierFor(3).sessions).toBe(3);
  });

  it('cộng dung lượng ảnh của các phiên sẽ bị xoá', () => {
    const old = createSession({ maxPhotos: 4 });
    addPhotoRow(old.id, 5_000_000);
    age(old.id, 40);

    const fresh = createSession({ maxPhotos: 4 });
    addPhotoRow(fresh.id, 9_000_000);

    expect(tierFor(30).bytes).toBe(5_000_000);
  });

  it('KHÔNG đếm phiên đang có khách trong phòng', () => {
    // Phiên bị treo ở trạng thái "đang chụp" nhiều ngày vẫn không được xoá:
    // rất có thể khách còn trong buồng, hoặc nhân viên chưa đóng phiên.
    age(createSession({ maxPhotos: 4 }).id, 40, 'shooting');
    expect(tierFor(30).sessions).toBe(0);
  });
});

describe('purgeOlderThan — nhân viên bấm dọn', () => {
  it('xoá ảnh của phiên cũ, giữ phiên mới', async () => {
    const old = createSession({ maxPhotos: 4 });
    await saveFile(old.dir, 'originals', '01.jpg', Buffer.from('anh cu'));
    age(old.id, 40);

    const fresh = createSession({ maxPhotos: 4 });
    await saveFile(fresh.dir, 'originals', '01.jpg', Buffer.from('anh moi'));
    age(fresh.id, 1);

    expect(purgeOlderThan(30).purged).toBe(1);
    expect(existsSync(sessionDir(old.dir))).toBe(false);
    expect(existsSync(sessionDir(fresh.dir))).toBe(true);
  });

  it('KHÔNG xoá phiên đang có khách trong phòng', async () => {
    const busy = createSession({ maxPhotos: 4 });
    await saveFile(busy.dir, 'originals', '01.jpg', Buffer.from('anh'));
    age(busy.id, 40, 'active');

    expect(purgeOlderThan(30).purged).toBe(0);
    expect(existsSync(sessionDir(busy.dir))).toBe(true);
  });

  it('giữ lại bản ghi để nhân viên còn tra được', () => {
    const s = createSession({ maxPhotos: 4 });
    age(s.id, 40);
    purgeOlderThan(30);

    const row = getDb()
      .prepare('SELECT status, purged_at FROM sessions WHERE id = ?')
      .get(s.id) as { status: string; purged_at: number };
    expect(row.status).toBe('expired');
    expect(row.purged_at).toBeGreaterThan(0);
  });

  it('bấm lại lần nữa không xoá thêm gì', () => {
    age(createSession({ maxPhotos: 4 }).id, 40);
    expect(purgeOlderThan(30).purged).toBe(1);
    expect(purgeOlderThan(30).purged).toBe(0);
  });

  it('mốc dọn xong thì biến mất khỏi bảng xem trước', () => {
    age(createSession({ maxPhotos: 4 }).id, 40);
    expect(tierFor(30).sessions).toBe(1);
    purgeOlderThan(30);
    expect(tierFor(30).sessions).toBe(0);
  });
});
