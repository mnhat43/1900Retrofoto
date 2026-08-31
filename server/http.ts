import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual, randomBytes, createHmac } from 'node:crypto';
import { CONFIG } from './config.ts';

/** Tiện ích HTTP dùng chung. */

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
};

export function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // Token nằm trong URL (đến từ QR) -> chặn rò rỉ qua Referer
    'referrer-policy': 'no-referrer',
  });
  res.end(data);
}

export function text(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

const MAX_BODY = 64 * 1024 * 1024; // 64MB — ảnh Canon lớn nhất cũng lọt

export function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('File quá lớn'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const buf = await readBody(req);
  return JSON.parse(buf.toString('utf8')) as T;
}

// ---------------------------------------------------------------------------
// Đăng nhập nhân viên — mật khẩu chung, cookie có chữ ký
// ---------------------------------------------------------------------------

/**
 * Khoá ký cookie. Sinh ngẫu nhiên mỗi lần khởi động server: nhân viên phải
 * đăng nhập lại sau khi restart, đổi lại không cần lưu secret ở đâu cả.
 */
const COOKIE_SECRET = randomBytes(32);
const COOKIE_NAME = 'pb_staff';
const COOKIE_TTL_MS = 12 * 60 * 60 * 1000;

/** So sánh chuỗi theo thời gian hằng số, tránh lộ thông tin qua thời gian phản hồi. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function checkPassword(password: string): boolean {
  return safeEqual(password, CONFIG.staffPassword);
}

function sign(value: string): string {
  return createHmac('sha256', COOKIE_SECRET).update(value).digest('base64url');
}

export function makeStaffCookie(): string {
  const exp = String(Date.now() + COOKIE_TTL_MS);
  const token = `${exp}.${sign(exp)}`;
  // HttpOnly: JS không đọc được. Không đặt Secure vì chạy HTTP trong LAN.
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_TTL_MS / 1000}`;
}

export const clearStaffCookie = () =>
  `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function isStaff(req: IncomingMessage): boolean {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig) return false;
  if (!safeEqual(sig, sign(exp))) return false;
  return Number(exp) > Date.now();
}

/** Trả về true nếu ĐÃ xử lý xong (tức là bị chặn). */
export function requireStaff(ctx: Ctx): boolean {
  if (isStaff(ctx.req)) return false;
  json(ctx.res, 401, { error: 'Chưa đăng nhập' });
  return true;
}

// ---------------------------------------------------------------------------
// Giới hạn tần suất (chống dò mật khẩu nhân viên)
// ---------------------------------------------------------------------------

const attempts = new Map<string, { n: number; until: number }>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const t = Date.now();
  const cur = attempts.get(key);
  if (!cur || cur.until < t) {
    attempts.set(key, { n: 1, until: t + windowMs });
    return true;
  }
  cur.n++;
  return cur.n <= max;
}

export const clientIp = (req: IncomingMessage) =>
  req.socket.remoteAddress ?? 'unknown';
