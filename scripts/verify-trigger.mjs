/**
 * Kiểm chứng tích hợp trigger LumaBooth.
 *
 * Hệ thống không lấy ảnh từ máy chụp nữa (quán tự đưa file cho khách), nên
 * trigger chỉ còn MỘT việc: LumaBooth báo bắt đầu lượt chụp (session_start)
 * thì server tự nhận hộ mã đang chờ của phòng đó — phòng chỉ có một màn hình
 * và LumaBooth chiếm trọn, khách không có chỗ gõ 4 số.
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
// Dải cổng trigger riêng: mặc định 8100 là của server thật đang chạy trên
// máy dev, trùng vào đó thì test bắn nhầm sang nó và luôn trượt.
process.env.PHOTOBOOTH_TRIGGER_BASE = '8600';
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

/** Phòng đang có phiên nào, trạng thái gì (null = chưa ai nhận mã). */
const roomStatus = async (room) =>
  (await api(`/api/room/session?room=${room}`)).body.session?.status ?? null;

const newCode = async (room) => (await api('/api/staff/sessions', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ room }),
})).body.code;

await api('/api/staff/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'test-secret' }),
});

console.log('\n--- Tự nhận mã khi LumaBooth bắt đầu chụp ---');
const code2 = await newCode('2');
check('tạo được mã chờ cho phòng 2', /^\d{4}$/.test(code2 ?? ''));
check('trước khi máy ảnh báo: phòng chưa ai nhận mã', (await roomStatus('2')) === null);

await api('/api/trigger?room=2&event_type=session_start&param1=PrintAndGIF');
check('máy ảnh bắt đầu chụp -> TỰ nhận mã', (await roomStatus('2')) === 'active');

const fin = await api('/api/room/finish?room=2', { method: 'POST' });
check('phiên tự nhận vẫn hiện được QR như thường', fin.status === 200 && !!fin.body.qr?.composeUrl);

// Không có mã chờ thì không làm gì, không đổ server
const t3 = await api('/api/trigger?room=3&event_type=session_start&param1=Print');
check('phòng không có mã chờ: bỏ qua êm', t3.status === 200 && (await roomStatus('3')) === null);

console.log('\n--- Cổng riêng mỗi phòng ---');
// LumaBooth vứt đường dẫn và tham số, chỉ giữ host:cổng — nên cổng là thứ
// duy nhất nói lên phòng nào gọi. Quan sát từ LumaBooth 8 thật: nó gọi
// GET /?event_type=...&param1=...
const base = Number(process.env.PHOTOBOOTH_TRIGGER_BASE ?? 8100);
const code3 = await newCode('3');
check('tạo được mã chờ cho phòng 3', /^\d{4}$/.test(code3 ?? ''));

const viaPort = await fetch(
  'http://127.0.0.1:' + (base + 3) + '/?event_type=session_start&param1=OnlyGIF',
).then((r) => r.status).catch(() => 0);
check('cổng riêng của phòng 3 nhận được trigger', viaPort === 200, String(viaPort));

await new Promise((r) => setTimeout(r, 300));
check('gọi qua cổng riêng cũng TỰ nhận mã', (await roomStatus('3')) === 'active');

// Các sự kiện khác chỉ ghi log — không được đụng vào phiên
await fetch('http://127.0.0.1:' + (base + 3) + '/?event_type=file_download&param1=IMG_1.JPG')
  .catch(() => {});
await fetch('http://127.0.0.1:' + (base + 3) + '/?event_type=session_end').catch(() => {});
await new Promise((r) => setTimeout(r, 300));
check('sự kiện khác không đổi trạng thái phiên', (await roomStatus('3')) === 'active');

// Phòng lạ / sự kiện lạ không được làm server đổ
const bad = await api('/api/trigger?room=99&event_type=linh_tinh');
check('phòng lạ vẫn trả 200, không đổ server', bad.status === 200);

server.close();
// SQLite trên Windows còn giữ file một nhịp sau khi đóng server
await new Promise((r) => setTimeout(r, 300));
try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* thư mục tạm, kệ */ }
console.log(fails.length ? `\n${fails.length} lỗi\n` : '\nTất cả đều đạt\n');
process.exit(fails.length ? 1 : 0);
