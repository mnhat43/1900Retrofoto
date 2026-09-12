/**
 * Kiểm chứng tích hợp trigger LumaBooth.
 *
 * Điều phải đúng: ảnh chụp TRƯỚC khi LumaBooth mở lượt (session_start)
 * không được chảy vào phiên đang mở — đó là ảnh của khách trước về trễ.
 *
 *   node --experimental-strip-types scripts/verify-trigger.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'pb-trig-'));
process.env.PHOTOBOOTH_DATA = dataDir;
process.env.PHOTOBOOTH_PASSWORD = 'test-secret';
process.env.PHOTOBOOTH_PORT = '8198';
process.env.PHOTOBOOTH_HOST = '127.0.0.1:8198';

const { start } = await import('../server/index.ts');
const server = start(8198);
await new Promise((r) => setTimeout(r, 400));

const BASE = 'http://127.0.0.1:8198';
const fails = [];
const check = (n, ok, extra = '') => {
  console.log(ok ? `  ok   ${n}` : `  FAIL ${n} ${extra}`);
  if (!ok) fails.push(n);
};

let cookie = '';
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts, headers: { ...(opts.headers ?? {}), ...(cookie ? { cookie } : {}) },
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const BS = String.fromCharCode(92);
const sharp = (await import('sharp')).default;
const jpeg = () => sharp({ create: { width: 800, height: 600, channels: 3,
  background: { r: 200, g: 60, b: 80 } } }).jpeg().toBuffer();

async function send(room, mtime) {
  const res = await fetch(`${BASE}/api/capture?room=${room}&source=agent&mtime=${mtime}`, {
    method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: await jpeg(),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

console.log('\nTrigger LumaBooth\n');

await api('/api/staff/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'test-secret' }),
});

// Mở phiên cho phòng 1
const made = await api('/api/staff/sessions', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ maxPhotos: 6, room: '1' }),
});
const code = made.body.code;
await api('/api/room/claim', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ room: '1', code }),
});
check('mở được phiên phòng 1', made.status === 200 && !!code);

// Chưa có trigger -> hành vi cũ, ảnh cũ vẫn nhận (agent chạy một mình)
const noTrig = await send('1', Date.now() - 600_000);
check('chưa có trigger thì vẫn nhận ảnh (tương thích ngược)', noTrig.status === 200,
  JSON.stringify(noTrig.body));

// LumaBooth mở lượt chụp
const t = await api('/api/trigger?room=1&event_type=session_start&param1=PrintAndGIF');
check('nhận được trigger session_start', t.status === 200);

// Ảnh cũ hơn mốc lượt -> phải bị từ chối
const stale = await send('1', Date.now() - 600_000);
check('BỎ ảnh của lượt trước về trễ',
  stale.status === 409 && stale.body.reason === 'stale', JSON.stringify(stale.body));

// Ảnh mới -> nhận
const fresh = await send('1', Date.now());
check('NHẬN ảnh chụp trong lượt hiện tại', fresh.status === 200, JSON.stringify(fresh.body));

// Đóng lượt -> trở lại hành vi cũ
await api('/api/trigger?room=1&event_type=session_end');
const after = await send('1', Date.now() - 600_000);
check('đóng lượt thì hết lọc', after.status === 200, JSON.stringify(after.body));

// Luồng THẬT quan sát được từ LumaBooth 8: processing_start gửi mỗi ảnh
// một param, param cuối là đường dẫn đầy đủ của file đã ghép.
await api('/api/trigger?room=1&event_type=session_start&param1=PrintAndGIF');
const proc = await api(
  '/api/trigger?room=1&event_type=processing_start' +
  '&param1=20260912_112854_324.jpg&param2=20260912_112902_922.jpg' +
  '&param3=20260912_112910_404.jpg&param4=20260912_112917_855.jpg' +
  '&param5=' + encodeURIComponent(['C:','dslrBooth','test','Prints','20260912_112921_379.jpg'].join(BS)),
);
check('nhận processing_start nhiều param', proc.status === 200);
const { shotForRoom } = await import('../server/trigger.ts');
const shot = shotForRoom('1');
check('gom đúng 4 ảnh gốc, bỏ đường dẫn file ghép',
  shot?.files.size === 4 && shot.files.has('20260912_112854_324.jpg') &&
  ![...shot.files].some((f) => f.includes('Prints')),
  JSON.stringify([...(shot?.files ?? [])]));
await api('/api/trigger?room=1&event_type=session_end');

// TỰ NHẬN MÃ: phòng một màn hình, khách không gõ được 4 số.
// Nhân viên tạo mã -> LumaBooth báo bắt đầu chụp -> server tự nhận hộ.
const made2 = await api('/api/staff/sessions', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ maxPhotos: 4, room: '2' }),
});
check('tạo được mã chờ cho phòng 2', made2.status === 200 && !!made2.body.code);

// Chưa ai nhập mã -> chưa gửi ảnh được
const before = await send('2', Date.now());
check('trước khi máy ảnh báo: phòng chưa mở khoá', before.status === 409);

// LumaBooth bắt đầu chụp -> server tự nhận mã
await api('/api/trigger?room=2&event_type=session_start&param1=PrintAndGIF');
const after2 = await send('2', Date.now());
check('máy ảnh bắt đầu chụp -> TỰ nhận mã, ảnh vào được',
  after2.status === 200, JSON.stringify(after2.body));

// Không có mã chờ thì không làm gì, không đổ server
const t3 = await api('/api/trigger?room=3&event_type=session_start&param1=Print');
check('phòng không có mã chờ: bỏ qua êm', t3.status === 200);

// Phòng lạ / sự kiện lạ không được làm server đổ
const bad = await api('/api/trigger?room=99&event_type=linh_tinh');
check('phòng lạ vẫn trả 200, không đổ server', bad.status === 200);

server.close();
// SQLite trên Windows còn giữ file một nhịp sau khi đóng server
await new Promise((r) => setTimeout(r, 300));
try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* thư mục tạm, kệ */ }
console.log(fails.length ? `\n${fails.length} lỗi\n` : '\nTất cả đều đạt\n');
process.exit(fails.length ? 1 : 0);
