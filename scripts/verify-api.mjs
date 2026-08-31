/**
 * Kiểm chứng API server bằng cách chạy server thật và gọi qua HTTP.
 *
 * Khẳng định trọn luồng: NV đăng nhập -> tạo mã -> phòng nhận mã ->
 * upload ảnh -> hết lượt thì chặn -> hoàn tất -> khách dùng token xem ảnh.
 * Kèm các kiểm tra bảo mật (không token thì không xem được, mã dùng 1 lần...).
 *
 *   node scripts/verify-api.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pb-api-'));
process.env.PHOTOBOOTH_DATA = dir;
process.env.PHOTOBOOTH_PASSWORD = 'test-secret';
process.env.PHOTOBOOTH_PORT = '8199';
process.env.PHOTOBOOTH_HOST = '127.0.0.1:8199';

const { start } = await import('../server/index.ts');
const server = start(8199);
await new Promise((r) => setTimeout(r, 300));

const BASE = 'http://127.0.0.1:8199';
let cookie = '';
const fails = [];
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name} ${extra}`); fails.push(name); }
};

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { ...(opts.headers ?? {}), ...(cookie ? { cookie } : {}) },
  });
  const setC = res.headers.get('set-cookie');
  if (setC) cookie = setC.split(';')[0];
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, body };
}

/** Ảnh JPEG thật để sharp xử lý được. */
async function makeJpeg(w, h, rgb) {
  const sharp = (await import('sharp')).default;
  return sharp({
    create: { width: w, height: h, channels: 3, background: rgb },
  }).jpeg().toBuffer();
}

console.log('\n--- Đăng nhập nhân viên ---');
check('sai mật khẩu bị từ chối',
  (await api('/api/staff/login', {
    method: 'POST', body: JSON.stringify({ password: 'sai' }),
  })).status === 401);

check('chưa đăng nhập thì không xem được danh sách',
  (await api('/api/staff/sessions')).status === 401);

check('đúng mật khẩu thì vào được',
  (await api('/api/staff/login', {
    method: 'POST', body: JSON.stringify({ password: 'test-secret' }),
  })).status === 200);

console.log('\n--- Tạo gói chụp ---');
const created = await api('/api/staff/sessions', {
  method: 'POST', body: JSON.stringify({ room: '1', maxPhotos: 4 }),
});
const code = created.body.code;
check('tạo được mã 4 số', /^\d{4}$/.test(code ?? ''), `got ${code}`);
check('danh sách KHÔNG lộ access_token',
  !JSON.stringify((await api('/api/staff/sessions')).body).includes('access_token'));

console.log('\n--- Phòng nhận mã ---');
check('mã sai bị từ chối',
  (await api('/api/room/claim', {
    method: 'POST', body: JSON.stringify({ room: '1', code: '0001' }),
  })).status === 401);

check('mã đúng thì mở khoá phòng',
  (await api('/api/room/claim', {
    method: 'POST', body: JSON.stringify({ room: '1', code }),
  })).status === 200);

check('mã DÙNG MỘT LẦN — phòng khác không dùng lại được',
  (await api('/api/room/claim', {
    method: 'POST', body: JSON.stringify({ room: '2', code }),
  })).status !== 200);

console.log('\n--- Chụp ảnh ---');
const colors = [
  { r: 220, g: 30, b: 60 }, { r: 30, g: 140, b: 220 },
  { r: 40, g: 190, b: 90 }, { r: 240, g: 170, b: 40 },
];
let last;
for (let i = 0; i < 4; i++) {
  last = await api('/api/capture?room=1', {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: await makeJpeg(1600, 1200, colors[i]),
  });
}
check('nhận đủ 4 ảnh', last.status === 200 && last.body.count === 4,
  JSON.stringify(last.body));
check('báo đúng số lượt còn lại', last.body.remaining === 0);

const over = await api('/api/capture?room=1', {
  method: 'POST',
  headers: { 'content-type': 'image/jpeg' },
  body: await makeJpeg(800, 600, { r: 0, g: 0, b: 0 }),
});
check('vượt số ảnh của gói thì bị chặn',
  over.status === 409 && over.body.reason === 'full', JSON.stringify(over.body));

check('file không phải ảnh bị từ chối',
  (await api('/api/capture?room=2', {
    method: 'POST', body: Buffer.from('khong phai anh'),
  })).status !== 200);

console.log('\n--- Hoàn tất, sinh QR ---');
const fin = await api('/api/room/finish?room=1', { method: 'POST' });
check('sinh được 2 mã QR',
  fin.body.qr?.view?.startsWith('data:image/png') &&
  fin.body.qr?.compose?.startsWith('data:image/png'));
check('QR trỏ tới IP máy chủ, không phải localhost',
  fin.body.qr?.composeUrl?.includes('127.0.0.1:8199'), fin.body.qr?.composeUrl);
check('QR KHÔNG chứa mã 4 số',
  !fin.body.qr?.composeUrl?.includes(code), fin.body.qr?.composeUrl);

const token = fin.body.qr.composeUrl.split('/c/')[1];
check('token dài (không đoán được)', token.length >= 43, `len ${token.length}`);

console.log('\n--- Khách dùng token ---');
const guest = await api(`/api/s?t=${token}`);
check('token đúng thì xem được phiên', guest.status === 200);
check('thấy đủ 4 ảnh', guest.body.photos?.length === 4);
check('ảnh có kích thước đã xoay đúng',
  guest.body.photos?.[0]?.width === 1600 && guest.body.photos?.[0]?.height === 1200,
  JSON.stringify(guest.body.photos?.[0]));

check('token sai bị từ chối', (await api('/api/s?t=khong-hop-le')).status === 404);
check('KHÔNG dùng mã 4 số thay token được',
  (await api(`/api/s?t=${code}`)).status === 404);

console.log('\n--- Phục vụ ảnh ---');
const pid = guest.body.photos[0].id;
const proxy = await api(`/media/previews/${pid}?t=${token}`);
check('tải được ảnh proxy', proxy.status === 200 && proxy.body.byteLength > 1000);
check('ảnh proxy nhỏ hơn ảnh gốc',
  proxy.body.byteLength < (await api(`/media/originals/${pid}?t=${token}`)).body.byteLength);

const savedCookie = cookie; cookie = '';
check('không token thì KHÔNG tải được ảnh',
  (await api(`/media/previews/${pid}`)).status === 401);
cookie = savedCookie;

console.log('\n--- Lưu ảnh ghép ---');
const recipe = encodeURIComponent(JSON.stringify({ frameId: 'basic-4', slots: [] }));
const comp = await api(
  `/api/composites?t=${token}&frame=basic-4&w=600&h=1800&recipe=${recipe}`,
  { method: 'POST', headers: { 'content-type': 'image/png' },
    body: await makeJpeg(600, 1800, { r: 200, g: 200, b: 200 }) },
);
check('lưu được ảnh ghép', comp.status === 200 && comp.body.composite?.slug);
check('có link chia sẻ', (comp.body.composite?.slug ?? '').length >= 20);

const slug = comp.body.composite.slug;
const cid = comp.body.composite.id;
cookie = '';
check('link chia sẻ mở được mà KHÔNG cần token',
  (await api(`/media/strips/${cid}?s=${slug}`)).status === 200);
check('slug sai thì không mở được',
  (await api(`/media/strips/${cid}?s=khong-ton-tai`)).status === 404);

console.log('\n--- Chống dò mã ---');
for (let i = 0; i < 6; i++) {
  await api('/api/room/claim', {
    method: 'POST', body: JSON.stringify({ room: '3', code: '9998' }),
  });
}
check('phòng bị khoá sau nhiều lần sai',
  (await api('/api/room/claim', {
    method: 'POST', body: JSON.stringify({ room: '3', code: '9998' }),
  })).status === 429);

server.close();
const { closeDb } = await import('../server/db.ts');
closeDb();
rmSync(dir, { recursive: true, force: true });

console.log(fails.length ? `\nFAIL: ${fails.length} kiểm tra\n` : '\nOK — tất cả kiểm chứng API đạt.\n');
process.exit(fails.length ? 1 : 0);
