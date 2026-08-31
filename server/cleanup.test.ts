import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { rmSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pb-clean-'));
process.env.PHOTOBOOTH_DATA = dir;

const { getDb, closeDb } = await import('./db.ts');
const { createSession } = await import('./session.ts');
const { runCleanup } = await import('./cleanup.ts');
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
