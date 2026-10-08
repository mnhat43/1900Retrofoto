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
  method: 'POST', body: JSON.stringify({ room: '1', maxPhotos: 5 }),
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

console.log('\n--- Không còn nạp ảnh từ máy chụp ---');
check('đường nạp ảnh máy chụp đã bỏ (/api/capture)',
  (await api('/api/capture?room=1', {
    method: 'POST', headers: { 'content-type': 'image/jpeg' },
    body: await makeJpeg(800, 600, { r: 0, g: 0, b: 0 }),
  })).status === 404);
check('đường quét thư mục chụp đã bỏ (/api/room/intake)',
  (await api('/api/room/intake?room=1', { method: 'POST' })).status === 404);
check('đường agent đã bỏ (/api/agent/ping)',
  (await api('/api/agent/ping?rooms=1', { method: 'POST' })).status === 404);
const roomView = await api('/api/room/session?room=1');
check('màn hình phòng không còn nhận danh sách ảnh',
  roomView.status === 200 && roomView.body.photos === undefined, JSON.stringify(roomView.body).slice(0, 120));

console.log('\n--- Chụp xong, sinh QR (không cần có ảnh) ---');
const fin = await api('/api/room/finish?room=1', { method: 'POST' });
check('phiên chưa có ảnh nào vẫn hiện được QR', fin.status === 200, JSON.stringify(fin.body));
check('sinh được mã QR ghép khung',
  fin.body.qr?.compose?.startsWith('data:image/png'));
check('KHÔNG còn mã QR xem ảnh gốc',
  fin.body.qr?.view === undefined && fin.body.qr?.viewUrl === undefined);
check('QR trỏ tới IP máy chủ, không phải localhost',
  fin.body.qr?.composeUrl?.includes('127.0.0.1:8199'), fin.body.qr?.composeUrl);
check('QR KHÔNG chứa mã 4 số',
  !fin.body.qr?.composeUrl?.includes(code), fin.body.qr?.composeUrl);

const token = fin.body.qr.composeUrl.split('/c/')[1];
check('token dài (không đoán được)', token.length >= 43, `len ${token.length}`);

console.log('\n--- Khách tải ảnh quán gửi lên ---');
const fresh = await api(`/api/s?t=${token}`);
check('token đúng thì xem được phiên', fresh.status === 200);
check('mới mở thì chưa có ảnh nào', fresh.body.photos?.length === 0, JSON.stringify(fresh.body.photos));

const colors = [
  { r: 220, g: 30, b: 60 }, { r: 30, g: 140, b: 220 },
  { r: 40, g: 190, b: 90 }, { r: 240, g: 170, b: 40 },
];
let last;
for (let i = 0; i < 4; i++) {
  last = await api(`/api/s/photos?t=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: await makeJpeg(1600, 1200, colors[i]),
  });
}
check('khách tải lên đủ 4 ảnh', last.status === 200 && !!last.body.photo?.id, JSON.stringify(last.body));
check('báo đúng số chỗ còn lại (trần 5)', last.body.remaining === 1, JSON.stringify(last.body));
check('file không phải ảnh bị từ chối',
  (await api(`/api/s/photos?t=${token}`, {
    method: 'POST', body: Buffer.from('khong phai anh'),
  })).status === 400);
check('token sai thì không tải ảnh lên được',
  (await api('/api/s/photos?t=khong-hop-le', {
    method: 'POST', body: await makeJpeg(100, 100, colors[0]),
  })).status === 404);

const guest = await api(`/api/s?t=${token}`);
check('thấy đủ 4 ảnh vừa tải', guest.body.photos?.length === 4);
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
check('ảnh khách có ảnh gốc để server dựng bản nét',
  (await api(`/media/originals/${pid}?t=${token}`)).status === 200);

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

console.log('\n--- Xoay / lật ảnh khi dựng bản nét ---');
{
  /*
   * Ảnh nửa trái ĐỎ, nửa phải XANH. Biết trước kết quả từng phép:
   *   xoay 90° (chiều kim đồng hồ): mép trái lên trên   -> trên đỏ, dưới xanh
   *   lật ngang:                    trái <-> phải         -> trái xanh, phải đỏ
   *   xoay 180°:                    cũng đảo trái/phải    -> trái xanh, phải đỏ
   * Sai chiều xoay (ngược kim đồng hồ) sẽ ra trên xanh — chính lỗi cần bắt,
   * vì canvas ở điện thoại và sharp ở server phải xoay cùng một chiều.
   */
  const sharp = (await import('sharp')).default;
  const half = await sharp({ create: { width: 500, height: 1000, channels: 3, background: { r: 230, g: 20, b: 20 } } }).png().toBuffer();
  const twoTone = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: { r: 20, g: 40, b: 230 } } })
    .composite([{ input: half, left: 0, top: 0 }]).jpeg({ quality: 95 }).toBuffer();
  const up2 = await api(`/api/s/photos?t=${token}`, {
    method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: twoTone,
  });
  check('tải ảnh hai màu để thử xoay', up2.status === 200, JSON.stringify(up2.body));
  const over = await api(`/api/s/photos?t=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: await makeJpeg(800, 600, { r: 0, g: 0, b: 0 }),
  });
  check('vượt trần ảnh của phiên thì bị chặn',
    over.status === 409 && over.body.reason === 'full', JSON.stringify(over.body));
  const pid2 = up2.body.photo.id;

  const frames = (await api('/api/frames')).body.frames;
  const f4 = frames.find((f) => f.id === 'basic-4');
  const [s0, s1, s2] = f4.slots;
  const recipeRot = encodeURIComponent(JSON.stringify({
    frameId: 'basic-4',
    slots: [
      { slotId: s0.id, photoId: pid2, zoom: 1, offset: { x: 0, y: 0 }, rotate: 90 },
      { slotId: s1.id, photoId: pid2, zoom: 1, offset: { x: 0, y: 0 }, flipX: true },
      { slotId: s2.id, photoId: pid2, zoom: 1, offset: { x: 0, y: 0 }, rotate: 180 },
    ],
  }));
  const rc = await api(
    `/api/composites?t=${token}&frame=basic-4&w=600&h=1800&recipe=${recipeRot}`,
    { method: 'POST', headers: { 'content-type': 'image/png' },
      body: await makeJpeg(600, 1800, { r: 200, g: 200, b: 200 }) },
  );
  check('lưu được ảnh ghép có xoay/lật', rc.status === 200, JSON.stringify(rc.body));

  const png = Buffer.from((await api(
    `/media/strips/${rc.body.composite.id}?s=${rc.body.composite.slug}`)).body);
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  // Màu tại một điểm (toạ độ chuẩn hoá trong ô) -> 'do' / 'xanh' / '?'
  const at = (slot, fx, fy) => {
    const x = Math.round((slot.rect.x + slot.rect.w * fx) * info.width);
    const y = Math.round((slot.rect.y + slot.rect.h * fy) * info.height);
    const i = (y * info.width + x) * info.channels;
    const [r, , b] = [data[i], data[i + 1], data[i + 2]];
    return r > 150 && b < 100 ? 'do' : b > 150 && r < 100 ? 'xanh' : `?(${r},${b})`;
  };
  check('xoay 90°: nửa trên đỏ, nửa dưới xanh (đúng chiều kim đồng hồ)',
    at(s0, 0.5, 0.2) === 'do' && at(s0, 0.5, 0.8) === 'xanh',
    `${at(s0, 0.5, 0.2)} / ${at(s0, 0.5, 0.8)}`);
  check('lật ngang: trái xanh, phải đỏ',
    at(s1, 0.2, 0.5) === 'xanh' && at(s1, 0.8, 0.5) === 'do',
    `${at(s1, 0.2, 0.5)} / ${at(s1, 0.8, 0.5)}`);
  check('xoay 180°: trái xanh, phải đỏ',
    at(s2, 0.2, 0.5) === 'xanh' && at(s2, 0.8, 0.5) === 'do',
    `${at(s2, 0.2, 0.5)} / ${at(s2, 0.8, 0.5)}`);
}

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
