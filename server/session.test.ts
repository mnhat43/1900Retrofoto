import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Trỏ dữ liệu vào thư mục tạm TRƯỚC khi import module dùng CONFIG.
const dir = mkdtempSync(join(tmpdir(), 'pb-test-'));
process.env.PHOTOBOOTH_DATA = dir;

const { getDb, closeDb } = await import('./db.ts');
const {
  generateCode,
  createSession,
  claimSession,
  getByToken,
  activeForRoom,
  isLockedOut,
} = await import('./session.ts');

beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM code_attempts; DELETE FROM photos; DELETE FROM sessions;');
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('generateCode', () => {
  it('luôn sinh đúng 4 chữ số', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCode()).toMatch(/^\d{4}$/);
    }
  });

  it('không bao giờ sinh mã dễ đoán', () => {
    const weak = new Set([
      '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777',
      '8888', '9999', '1234', '4321', '1212', '2121',
      String(new Date().getFullYear()),
    ]);
    for (let i = 0; i < 3000; i++) {
      expect(weak.has(generateCode())).toBe(false);
    }
  });

  it('phân bố đủ rộng (không kẹt ở một giá trị)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateCode());
    expect(seen.size).toBeGreaterThan(400);
  });
});

describe('createSession', () => {
  it('mã của các phiên còn sống là duy nhất', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const s = createSession({ maxPhotos: 8 });
      expect(codes.has(s.code)).toBe(false);
      codes.add(s.code);
    }
  });

  it('token dài và khác nhau hoàn toàn', () => {
    const a = createSession({ maxPhotos: 8 });
    const b = createSession({ maxPhotos: 8 });
    expect(a.access_token).not.toBe(b.access_token);
    // 32 byte base64url >= 43 ký tự
    expect(a.access_token.length).toBeGreaterThanOrEqual(43);
  });

  it('thư mục đặt theo ngày và mã', () => {
    const s = createSession({ maxPhotos: 8 });
    expect(s.dir).toMatch(/^\d{4}-\d{2}-\d{2}\/\d{4}$/);
    expect(s.dir.endsWith(s.code)).toBe(true);
  });

  it('mã KHÔNG được tái sử dụng khi khách mới chụp xong', () => {
    // 'done' nghĩa là khách vẫn đang dùng QR -> mã phải còn giữ chỗ,
    // nếu không hai phiên sẽ ghi đè thư mục ảnh của nhau.
    const s = createSession({ maxPhotos: 8 });
    getDb().prepare(`UPDATE sessions SET status='done' WHERE id=?`).run(s.id);
    expect(() =>
      getDb()
        .prepare(
          `INSERT INTO sessions (id,code,status,max_photos,access_token,dir,
             code_expires_at,expires_at,created_at)
           VALUES ('x2',?,'created',8,'tok2','d',9e12,9e12,1)`,
        )
        .run(s.code),
    ).toThrow();
  });

  it('mã được tái sử dụng SAU KHI nhân viên đóng phiên', () => {
    const s = createSession({ maxPhotos: 8 });
    getDb().prepare(`UPDATE sessions SET status='closed' WHERE id=?`).run(s.id);
    expect(() =>
      getDb()
        .prepare(
          `INSERT INTO sessions (id,code,status,max_photos,access_token,dir,
             code_expires_at,expires_at,created_at)
           VALUES ('x3',?,'created',8,'tok3','d',9e12,9e12,1)`,
        )
        .run(s.code),
    ).not.toThrow();
  });
});

describe('claimSession — mã là vé vào cửa, không phải mật khẩu', () => {
  it('nhận mã hợp lệ thì mở khoá phòng', () => {
    const s = createSession({ maxPhotos: 12 });
    const r = claimSession('1', s.code);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.session.status).toBe('active');
      expect(r.session.room_id).toBe('1');
    }
  });

  it('mã DÙNG MỘT LẦN — nhận rồi thì hết tác dụng', () => {
    const s = createSession({ maxPhotos: 12 });
    expect(claimSession('1', s.code).ok).toBe(true);
    // Phòng khác thử lại đúng mã đó
    const again = claimSession('2', s.code);
    expect(again.ok).toBe(false);
  });

  it('hai phòng cùng nhập một mã thì chỉ một bên thắng', () => {
    const s = createSession({ maxPhotos: 12 });
    const r1 = claimSession('1', s.code);
    const r2 = claimSession('2', s.code);
    expect([r1.ok, r2.ok].filter(Boolean).length).toBe(1);
  });

  it('mã hết hạn bị từ chối', () => {
    const s = createSession({ maxPhotos: 12 });
    getDb()
      .prepare('UPDATE sessions SET code_expires_at = 1 WHERE id = ?')
      .run(s.id);
    expect(claimSession('1', s.code).ok).toBe(false);
  });

  it('mã sai và mã hết hạn trả về GIỐNG HỆT nhau (không lộ mã nào có thật)', () => {
    const s = createSession({ maxPhotos: 12 });
    getDb()
      .prepare('UPDATE sessions SET code_expires_at = 1 WHERE id = ?')
      .run(s.id);

    const expired = claimSession('1', s.code);
    const wrong = claimSession('1', '9998');
    expect(expired).toEqual(wrong);
  });
});

describe('chống dò mã', () => {
  it('khoá phòng sau 5 lần sai', () => {
    expect(isLockedOut('1')).toBe(false);
    for (let i = 0; i < 5; i++) claimSession('1', '9999');
    expect(isLockedOut('1')).toBe(true);

    // Bị khoá thì mã ĐÚNG cũng không vào được
    const s = createSession({ maxPhotos: 8 });
    const r = claimSession('1', s.code);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('locked');
  });

  it('khoá theo từng phòng, không ảnh hưởng phòng khác', () => {
    for (let i = 0; i < 5; i++) claimSession('1', '9999');
    expect(isLockedOut('1')).toBe(true);
    expect(isLockedOut('2')).toBe(false);

    const s = createSession({ maxPhotos: 8 });
    expect(claimSession('2', s.code).ok).toBe(true);
  });

  it('lần thử đúng không làm tăng bộ đếm khoá', () => {
    for (let i = 0; i < 4; i++) claimSession('1', '9999');
    const s = createSession({ maxPhotos: 8 });
    expect(claimSession('1', s.code).ok).toBe(true);
    expect(isLockedOut('1')).toBe(false);
  });
});

describe('mỗi phòng một phiên', () => {
  it('mã gán phòng thì CHỈ phòng đó nhập được', () => {
    const s = createSession({ maxPhotos: 8, roomId: '1' });
    expect(claimSession('2', s.code).ok).toBe(false);
    expect(claimSession('1', s.code).ok).toBe(true);
  });

  it('phòng đang có phiên thì busySession báo bận', async () => {
    const { busySession } = await import('./session.ts');
    const s = createSession({ maxPhotos: 8, roomId: '1' });
    expect(busySession('1')?.id).toBe(s.id);
    expect(busySession('2')).toBeNull();
  });

  it('đóng phiên thì phòng mới rảnh', async () => {
    const { busySession, closeSession } = await import('./session.ts');
    const s = createSession({ maxPhotos: 8, roomId: '1' });
    claimSession('1', s.code);
    expect(busySession('1')).not.toBeNull();

    expect(closeSession(s.id)).toBe(true);
    expect(busySession('1')).toBeNull();
  });

  /*
   * Chụp xong là buồng RẢNH NGAY, không đợi nhân viên đóng phiên.
   *
   * Mục đích: khách cũ cầm QR ra ngoài ngồi ghép ảnh, khách mới vào chụp
   * luôn. Trước đây buồng bị giữ tới khi đóng phiên, mỗi lượt lãng phí
   * 5-10 phút chỉ để khách ngồi chỉnh ảnh trong buồng.
   */
  it('chụp xong thì buồng RẢNH ngay để nhận khách mới', async () => {
    const { busySession } = await import('./session.ts');
    const s = createSession({ maxPhotos: 8, roomId: '1' });
    claimSession('1', s.code);

    getDb().prepare(`UPDATE sessions SET status='done' WHERE id=?`).run(s.id);
    expect(busySession('1')).toBeNull();

    getDb().prepare(`UPDATE sessions SET status='composed' WHERE id=?`).run(s.id);
    expect(busySession('1')).toBeNull();
  });

  it('phiên vừa xong VẪN còn sống để khách ghép ảnh ngoài quán', async () => {
    const { openSessionsForRoom, getByToken } = await import('./session.ts');
    const s = createSession({ maxPhotos: 8, roomId: '1' });
    claimSession('1', s.code);
    getDb().prepare(`UPDATE sessions SET status='done' WHERE id=?`).run(s.id);

    // Buồng rảnh nhưng QR vẫn quét được
    expect(getByToken(s.access_token)).not.toBeNull();
    expect(openSessionsForRoom('1').map((x) => x.id)).toContain(s.id);
  });

  it('đang chụp thì VẪN chặn tạo mã mới', async () => {
    const { busySession } = await import('./session.ts');
    const s = createSession({ maxPhotos: 8, roomId: '1' });
    claimSession('1', s.code);
    expect(busySession('1')?.id).toBe(s.id);
  });

  /*
   * Mã không được cấp lại khi khách cũ còn đang ghép — thư mục ảnh đặt tên
   * theo mã, trùng mã là ghi đè ảnh của nhau.
   */
  it('mã của phiên đang ghép KHÔNG bị cấp lại cho khách mới', async () => {
    const a = createSession({ maxPhotos: 8, roomId: '1' });
    claimSession('1', a.code);
    getDb().prepare(`UPDATE sessions SET status='done' WHERE id=?`).run(a.id);

    const codes = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const b = createSession({ maxPhotos: 8, roomId: '1' });
      codes.add(b.code);
      getDb().prepare(`UPDATE sessions SET status='closed' WHERE id=?`).run(b.id);
    }
    expect(codes.has(a.code)).toBe(false);
  });

  it('phiên đã đóng thì khách không xem được nữa', async () => {
    const { closeSession } = await import('./session.ts');
    const s = createSession({ maxPhotos: 8, roomId: '1' });
    claimSession('1', s.code);
    closeSession(s.id);
    expect(getByToken(s.access_token)).toBeNull();
  });

  it('nhân viên VẪN xem lại được phiên đã đóng', async () => {
    const { closeSession, sessionByAnyToken } = await import('./session.ts');
    const s = createSession({ maxPhotos: 8, roomId: '1' });
    claimSession('1', s.code);
    closeSession(s.id);
    expect(sessionByAnyToken(s.access_token)?.id).toBe(s.id);
  });
});

describe('truy cập bằng token', () => {
  it('token đúng thì lấy được phiên', () => {
    const s = createSession({ maxPhotos: 8 });
    expect(getByToken(s.access_token)?.id).toBe(s.id);
  });

  it('token sai trả về null', () => {
    createSession({ maxPhotos: 8 });
    expect(getByToken('khong-ton-tai')).toBeNull();
  });

  it('phiên hết hạn không truy cập được nữa', () => {
    const s = createSession({ maxPhotos: 8 });
    getDb().prepare('UPDATE sessions SET expires_at = 1 WHERE id = ?').run(s.id);
    expect(getByToken(s.access_token)).toBeNull();
  });

  it('KHÔNG thể lấy phiên bằng mã 4 số qua đường token', () => {
    const s = createSession({ maxPhotos: 8 });
    expect(getByToken(s.code)).toBeNull();
  });
});

describe('activeForRoom', () => {
  it('trả về phiên đang mở của đúng phòng', () => {
    const a = createSession({ maxPhotos: 8 });
    const b = createSession({ maxPhotos: 8 });
    claimSession('1', a.code);
    claimSession('2', b.code);

    expect(activeForRoom('1')?.id).toBe(a.id);
    expect(activeForRoom('2')?.id).toBe(b.id);
    expect(activeForRoom('3')).toBeNull();
  });

  it('phiên chưa nhận mã thì phòng vẫn trống', () => {
    createSession({ maxPhotos: 8 });
    expect(activeForRoom('1')).toBeNull();
  });
});
