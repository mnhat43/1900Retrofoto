import { randomInt, randomBytes } from 'node:crypto';
import { getDb, now } from './db.ts';
import { CONFIG } from './config.ts';

export type SessionStatus =
  | 'created'   // NV đã tạo mã, chưa ai nhập ở phòng
  | 'active'    // đã nhập mã ở phòng, phòng mở khoá
  | 'shooting'  // đã chụp ít nhất 1 ảnh
  | 'done'      // chụp xong, hiện QR
  | 'composed'  // đã ghép ít nhất 1 dải
  | 'closed'    // NHÂN VIÊN đã đóng phiên -> phòng mới rảnh để nhận khách sau
  | 'expired'
  | 'cancelled';

/**
 * Các trạng thái coi là phòng ĐANG BẬN — tức là còn người đứng trong buồng.
 *
 * KHÔNG tính 'done' và 'composed': lúc đó khách đã chụp xong, cầm QR ra ngoài
 * ngồi ghép ảnh bằng điện thoại. Buồng trống thì phải cho khách sau vào ngay,
 * không thì mỗi lượt chiếm phòng thêm 5-10 phút chỉ để ngồi chỉnh ảnh.
 *
 * "Phòng bận" và "phiên còn sống" là HAI VIỆC KHÁC NHAU:
 *   - Phòng bận  -> chặn tạo mã mới cho phòng đó (danh sách này)
 *   - Phiên sống -> QR còn quét được (xem LIVE_STATUSES)
 * Phiên vẫn sống sau khi phòng đã rảnh, tới khi nhân viên bấm "Đóng phiên".
 */
export const BUSY_STATUSES = ['active', 'shooting'] as const;

/**
 * Các trạng thái mà QR của khách còn dùng được.
 *
 * Rộng hơn BUSY_STATUSES đúng ở 'done' và 'composed' — khách đã rời buồng
 * nhưng vẫn đang ghép ảnh ngoài quán.
 */
export const LIVE_STATUSES = ['created', 'active', 'shooting', 'done', 'composed'] as const;

export type Session = {
  id: string;
  code: string;
  status: SessionStatus;
  max_photos: number;
  room_id: string | null;
  access_token: string;
  dir: string;
  note: string | null;
  code_expires_at: number;
  expires_at: number;
  created_at: number;
  claimed_at: number | null;
  done_at: number | null;
  purged_at: number | null;
};

/**
 * Các mã dễ đoán — loại bỏ để chặn kiểu tấn công "thử mấy mã hiển nhiên".
 * Chỉ mất ~15 mã trong 9000, đổi lại loại hẳn một lớp tấn công.
 */
function isWeakCode(code: string): boolean {
  if (/^(\d)\1{3}$/.test(code)) return true;        // 0000, 1111, ...
  if (code === '1234' || code === '4321') return true;
  if (code === '1212' || code === '2121') return true;
  if (code === String(new Date().getFullYear())) return true;
  return false;
}

/** Sinh một mã 4 số ngẫu nhiên, không thuộc danh sách dễ đoán. */
export function generateCode(): string {
  for (;;) {
    // randomInt dùng nguồn ngẫu nhiên mật mã, không phải Math.random
    const code = String(randomInt(1000, 10000));
    if (!isWeakCode(code)) return code;
  }
}

/** Token 256-bit cho QR. ĐÂY mới là thứ bảo vệ ảnh, không phải mã 4 số. */
function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function generateSlug(): string {
  return randomBytes(16).toString('base64url');
}

const dayStamp = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export class CodeExhaustedError extends Error {
  constructor() {
    super('Không sinh được mã mới — quá nhiều phiên đang mở');
  }
}

/**
 * Tạo phiên mới với mã 4 số duy nhất.
 *
 * Chỉ số duy nhất là partial index trên các phiên còn sống, nên mã của phiên
 * đã xong sẽ được tái sử dụng tự nhiên. Đụng độ thì thử lại — ở mức vài chục
 * phiên cùng lúc, xác suất đụng chỉ vài phần nghìn.
 */
export function createSession(opts: {
  maxPhotos: number;
  note?: string;
  /** Phòng mà mã này dành cho. Chỉ phòng đó nhập được mã. */
  roomId?: string;
}): Session {
  const db = getDb();
  const t = now();

  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateCode();
    const id = randomBytes(12).toString('hex');
    const session: Session = {
      id,
      code,
      status: 'created',
      max_photos: opts.maxPhotos,
      room_id: opts.roomId ?? null,
      access_token: generateToken(),
      dir: `${dayStamp(t)}/${code}`,
      note: opts.note ?? null,
      code_expires_at: t + CONFIG.codeTtlMinutes * 60_000,
      expires_at: t + CONFIG.retentionDays * 86_400_000,
      created_at: t,
      claimed_at: null,
      done_at: null,
      purged_at: null,
    };

    try {
      db.prepare(
        `INSERT INTO sessions
           (id, code, status, max_photos, room_id, access_token, dir, note,
            code_expires_at, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        session.id, session.code, session.status, session.max_photos,
        session.room_id, session.access_token, session.dir, session.note,
        session.code_expires_at, session.expires_at, session.created_at,
      );
      return session;
    } catch (err) {
      // Đụng mã -> thử mã khác. Lỗi khác thì ném lên.
      if (!String(err).includes('UNIQUE')) throw err;
    }
  }
  throw new CodeExhaustedError();
}

// ---------------------------------------------------------------------------
// Chống dò mã
// ---------------------------------------------------------------------------

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 60_000;

/** Số lần thử sai gần đây của một phòng. */
export function recentFailures(roomId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM code_attempts
        WHERE room_id = ? AND ok = 0 AND at > ?`,
    )
    .get(roomId, now() - LOCKOUT_WINDOW_MS) as { n: number };
  return row.n;
}

export function isLockedOut(roomId: string): boolean {
  return recentFailures(roomId) >= LOCKOUT_THRESHOLD;
}

function recordAttempt(roomId: string, ok: boolean): void {
  getDb()
    .prepare('INSERT INTO code_attempts (room_id, ok, at) VALUES (?, ?, ?)')
    .run(roomId, ok ? 1 : 0, now());
}

export type ClaimResult =
  | { ok: true; session: Session }
  | { ok: false; reason: 'locked' | 'invalid' };

/**
 * Phòng nhận mã — biến mã 4 số thành phiên đang hoạt động.
 *
 * Mã là VÉ VÀO CỬA, không phải mật khẩu: nhận xong thì status chuyển sang
 * 'active' và partial index không còn khớp nữa, nên mã lập tức hết tác dụng.
 * Từ đó trở đi ảnh được bảo vệ bằng access_token 256-bit trong QR.
 *
 * Trả về 'invalid' cho cả mã sai lẫn mã hết hạn — không để lộ mã nào có thật.
 */
export function claimSession(roomId: string, code: string): ClaimResult {
  if (isLockedOut(roomId)) return { ok: false, reason: 'locked' };

  const db = getDb();
  const t = now();

  // UPDATE có điều kiện -> hai phòng cùng nhập một mã thì chỉ một bên thắng,
  // không cần khoá tường minh.
  // Mã đã gán sẵn phòng thì CHỈ phòng đó nhập được (room_id IS NULL là mã
  // chưa gán, cho phòng nào cũng dùng được — giữ để tương thích ngược).
  const res = db
    .prepare(
      `UPDATE sessions
          SET status = 'active', room_id = ?, claimed_at = ?
        WHERE code = ? AND status = 'created' AND code_expires_at > ?
          AND (room_id IS NULL OR room_id = ?)`,
    )
    .run(roomId, t, code, t, roomId);

  if (res.changes === 0) {
    recordAttempt(roomId, false);
    return { ok: false, reason: 'invalid' };
  }

  recordAttempt(roomId, true);
  const session = db
    .prepare('SELECT * FROM sessions WHERE code = ? AND room_id = ?')
    .get(code, roomId) as Session;
  return { ok: true, session };
}

// ---------------------------------------------------------------------------
// Truy vấn
// ---------------------------------------------------------------------------

/**
 * Tra phiên theo token trong QR.
 *
 * Phiên đã đóng/huỷ/hết hạn thì KHÔNG truy cập được nữa — nhân viên bấm
 * "Đóng phiên" là chấm dứt lượt của khách đó. Nhân viên vẫn lấy hộ được ảnh
 * qua trang quản lý (đường khác, có đăng nhập).
 */
export function getByToken(token: string): Session | null {
  const s = getDb()
    .prepare('SELECT * FROM sessions WHERE access_token = ?')
    .get(token) as Session | undefined;
  if (!s) return null;
  if (s.purged_at || s.expires_at < now()) return null;
  if (s.status === 'closed' || s.status === 'cancelled' || s.status === 'expired') {
    return null;
  }
  return s;
}

/**
 * Tra phiên theo token, KHÔNG lọc theo trạng thái.
 * Chỉ dùng cho nhân viên đã đăng nhập — để xem lại cả phiên đã đóng.
 */
export function sessionByAnyToken(token: string): Session | null {
  if (!token) return null;
  const s = getDb()
    .prepare('SELECT * FROM sessions WHERE access_token = ?')
    .get(token) as Session | undefined;
  if (!s || s.purged_at) return null;
  return s;
}

export function getById(id: string): Session | null {
  return (getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
    | Session
    | undefined) ?? null;
}

/** Phiên đang mở của một phòng — màn hình phòng poll cái này. */
/**
 * Phiên ĐANG CHỤP trong buồng.
 *
 * KHÔNG tính 'done'/'composed'. Từ khi phòng rảnh ngay lúc bấm "Đã chụp xong",
 * một phòng có thể vừa có khách mới đang chụp vừa có khách cũ đang ghép ảnh
 * ngoài quán. Nếu hàm này còn trả về phiên cũ thì ảnh của khách MỚI sẽ chảy
 * nhầm vào phiên của khách CŨ.
 */
export function activeForRoom(roomId: string): Session | null {
  return (getDb()
    .prepare(
      `SELECT * FROM sessions
        WHERE room_id = ? AND status IN ('active','shooting')
        ORDER BY claimed_at DESC LIMIT 1`,
    )
    .get(roomId) as Session | undefined) ?? null;
}

/**
 * Phiên vừa chụp xong của phòng — màn hình phòng còn phải hiện QR cho khách
 * quét, kể cả khi buồng đã sẵn sàng nhận người tiếp theo.
 */
export function lastDoneForRoom(roomId: string): Session | null {
  return (getDb()
    .prepare(
      `SELECT * FROM sessions
        WHERE room_id = ? AND status IN ('done','composed')
        ORDER BY claimed_at DESC LIMIT 1`,
    )
    .get(roomId) as Session | undefined) ?? null;
}

export function listSessions(limit = 100): Session[] {
  return getDb()
    .prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Session[];
}

export function setStatus(id: string, status: SessionStatus): void {
  const extra = status === 'done' ? ', done_at = ' + now() : '';
  getDb()
    .prepare(`UPDATE sessions SET status = ?${extra} WHERE id = ?`)
    .run(status, id);
}

/**
 * Nhân viên đóng phiên — phòng mới rảnh để nhận khách tiếp theo.
 *
 * Đây là điểm DUY NHẤT giải phóng phòng. Khách ghép ảnh xong không tự
 * giải phóng, để tránh phòng nhận khách mới khi lượt trước chưa dứt điểm.
 */
export function closeSession(id: string): boolean {
  const res = getDb()
    .prepare(
      `UPDATE sessions SET status = 'closed', done_at = COALESCE(done_at, ?)
        WHERE id = ? AND status IN ('created','active','shooting','done','composed')`,
    )
    .run(now(), id);
  return res.changes > 0;
}

/**
 * Phiên đang CHIẾM BUỒNG (nếu có) — dùng để chặn tạo mã mới cho phòng đó.
 *
 * 'created' vẫn tính là chiếm: mã đã phát cho khách, họ sắp vào phòng.
 * 'done'/'composed' thì KHÔNG — khách đã ra ngoài, buồng trống.
 */
export function busySession(roomId: string): Session | null {
  return (getDb()
    .prepare(
      `SELECT * FROM sessions
        WHERE room_id = ? AND status IN ('created','active','shooting')
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(roomId) as Session | undefined) ?? null;
}

/**
 * Phiên chưa đóng của một phòng, KỂ CẢ khách đã ra ngoài đang ghép ảnh.
 * Trang nhân viên dùng cái này để hiện "còn X khách đang ghép".
 */
export function openSessionsForRoom(roomId: string): Session[] {
  return getDb()
    .prepare(
      `SELECT * FROM sessions
        WHERE room_id = ? AND status IN ('done','composed')
        ORDER BY created_at DESC`,
    )
    .all(roomId) as Session[];
}

export function cancelSession(id: string): void {
  getDb()
    .prepare(`UPDATE sessions SET status = 'cancelled' WHERE id = ?`)
    .run(id);
}
