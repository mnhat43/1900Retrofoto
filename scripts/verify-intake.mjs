/**
 * Kiểm chứng luồng "Đã chụp xong" — lấy ảnh theo thư mục của mã.
 *
 * Điểm quan trọng nhất: ảnh của phiên này KHÔNG được lẫn sang phiên khác,
 * kể cả khi hai phòng chụp cùng lúc.
 *
 *   node scripts/verify-intake.mjs
 */
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const dataDir = mkdtempSync(join(tmpdir(), 'pb-in-'));
const captureRoot = mkdtempSync(join(tmpdir(), 'pb-cap-'));

process.env.PHOTOBOOTH_DATA = dataDir;
process.env.PHOTOBOOTH_CAPTURE = captureRoot;
process.env.PHOTOBOOTH_PASSWORD = 't';
process.env.PHOTOBOOTH_PORT = '8192';
process.env.PHOTOBOOTH_HOST = '127.0.0.1:8192';

const { start } = await import('../server/index.ts');
const server = start(8192);
await new Promise((r) => setTimeout(r, 400));
const BASE = 'http://127.0.0.1:8192';

const fails = [];
const check = (n, ok, x = '') => { console.log(ok ? `  ok   ${n}` : `  FAIL ${n} ${x}`); if (!ok) fails.push(n); };

let cookie = '';
async function api(p, o = {}) {
  const res = await fetch(BASE + p, { ...o, headers: { ...(o.headers ?? {}), ...(cookie ? { cookie } : {}) } });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const sharp = (await import('sharp')).default;
const jpeg = (rgb) => sharp({
  create: { width: 1200, height: 900, channels: 3, background: rgb },
}).jpeg().toBuffer();

const C = [
  { r: 220, g: 40, b: 70 }, { r: 40, g: 140, b: 220 },
  { r: 50, g: 190, b: 100 }, { r: 240, g: 175, b: 45 },
];

await api('/api/staff/login', { method: 'POST', body: JSON.stringify({ password: 't' }) });

console.log('\n--- Tạo mã thì tạo luôn thư mục ---');
const s1 = await api('/api/staff/sessions', { method: 'POST', body: JSON.stringify({ room: '1', maxPhotos: 4 }) });
const code1 = s1.body.code;
check('trả về đường dẫn thư mục', !!s1.body.captureDir, JSON.stringify(s1.body));
check('thư mục được tạo thật trên đĩa', existsSync(join(captureRoot, code1)));
check('tên thư mục đúng bằng mã', s1.body.captureDir?.endsWith(code1), s1.body.captureDir);

console.log('\n--- Chưa chụp thì báo rõ, không im lặng ---');
await api('/api/room/claim', { method: 'POST', body: JSON.stringify({ room: '1', code: code1 }) });
const empty = await api('/api/room/intake?room=1', { method: 'POST' });
check('thư mục trống: không lấy được ảnh nào', empty.body.added === 0 && empty.body.found === 0);
check('thư mục trống: có trả về đường dẫn để kiểm tra', !!empty.body.dir);

console.log('\n--- Chụp xong, bấm nút thì lấy đúng ảnh ---');
for (let i = 0; i < 3; i++) {
  writeFileSync(join(captureRoot, code1, `IMG_${i + 1}.jpg`), await jpeg(C[i]));
}
const got = await api('/api/room/intake?room=1', { method: 'POST' });
check('lấy đủ 3 ảnh vừa chụp', got.body.added === 3 && got.body.total === 3, JSON.stringify(got.body));

console.log('\n--- Bấm lại không nhân đôi ảnh ---');
const again = await api('/api/room/intake?room=1', { method: 'POST' });
check('quét lại: không thêm ảnh trùng', again.body.added === 0 && again.body.total === 3,
  JSON.stringify(again.body));

console.log('\n--- Chụp thêm rồi quét lại thì lấy ảnh mới ---');
writeFileSync(join(captureRoot, code1, 'IMG_4.jpg'), await jpeg(C[3]));
const more = await api('/api/room/intake?room=1', { method: 'POST' });
check('quét lại lấy được ảnh mới', more.body.added === 1 && more.body.total === 4);

console.log('\n--- Vượt số ảnh của gói thì dừng ---');
writeFileSync(join(captureRoot, code1, 'IMG_5.jpg'), await jpeg(C[0]));
const over = await api('/api/room/intake?room=1', { method: 'POST' });
check('không vượt quá số ảnh của gói', over.body.total === 4, JSON.stringify(over.body));

console.log('\n--- KHÔNG lẫn ảnh giữa hai phiên (quan trọng nhất) ---');
const s2 = await api('/api/staff/sessions', { method: 'POST', body: JSON.stringify({ room: '2', maxPhotos: 4 }) });
const code2 = s2.body.code;
check('hai phiên có thư mục khác nhau', code1 !== code2 && existsSync(join(captureRoot, code2)));

// Phòng 2 chụp 2 ảnh riêng
for (let i = 0; i < 2; i++) {
  writeFileSync(join(captureRoot, code2, `P2_${i + 1}.jpg`), await jpeg(C[i]));
}
await api('/api/room/claim', { method: 'POST', body: JSON.stringify({ room: '2', code: code2 }) });
const r2 = await api('/api/room/intake?room=2', { method: 'POST' });
check('phòng 2 chỉ lấy ảnh của mình', r2.body.added === 2 && r2.body.total === 2,
  JSON.stringify(r2.body));

// Phòng 1 quét lại vẫn giữ đúng 4 ảnh của mình
const r1 = await api('/api/room/intake?room=1', { method: 'POST' });
check('phòng 1 KHÔNG bị lẫn ảnh phòng 2', r1.body.total === 4, JSON.stringify(r1.body));

console.log('\n--- File không phải ảnh thì bỏ qua ---');
writeFileSync(join(captureRoot, code2, 'ghichu.txt'), 'khong phai anh');
const txt = await api('/api/room/intake?room=2', { method: 'POST' });
check('bỏ qua file .txt', txt.body.found === 2 && txt.body.total === 2);

console.log('\n--- KHÔNG đụng vào thư mục chụp ---');
const left = readdirSync(join(captureRoot, code1));
check('ảnh gốc vẫn nguyên trong thư mục', left.length === 5, left.join(','));

console.log('\n--- Giao diện phòng ---');
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const s3 = await api('/api/staff/sessions', { method: 'POST', body: JSON.stringify({ room: '3', maxPhotos: 4 }) });
await api('/api/room/claim', { method: 'POST', body: JSON.stringify({ room: '3', code: s3.body.code }) });

await p.goto(`${BASE}/room?p=3`);
await p.waitForSelector('.counter');
await p.waitForTimeout(600);
check('hiện nút "Đã chụp xong"', await p.isVisible('button:has-text("Đã chụp xong")'));
// Màn này khách nhìn -> KHÔNG được lộ đường dẫn thư mục hay tên biến cấu hình
const bodyText = await p.textContent('body');
check('KHÔNG lộ đường dẫn thư mục cho khách',
  !bodyText.includes(captureRoot) && !bodyText.includes('PHOTOBOOTH_'));
await p.screenshot({ path: 'scratch/intake-1-ready.png' });

// Bam khi chua co anh -> phai bao ro
await p.click('button:has-text("Đã chụp xong")');
await p.waitForSelector('.notice', { timeout: 10000 }).catch(() => {});
const notice = (await p.textContent('.notice').catch(() => '')) ?? '';
check('chưa có ảnh: báo lỗi chung, hướng khách gặp nhân viên',
  notice.includes('Hệ thống') && notice.includes('nhân viên'), notice);
check('thông báo lỗi KHÔNG lộ chi tiết kỹ thuật',
  !notice.includes(captureRoot) && !notice.includes('thư mục'), notice);
await p.screenshot({ path: 'scratch/intake-2-empty.png' });

// Chup roi quet lai
for (let i = 0; i < 4; i++) {
  writeFileSync(join(captureRoot, s3.body.code, `C_${i + 1}.jpg`), await jpeg(C[i]));
}
await p.click('button:has-text("Lấy thêm ảnh")');
await p.waitForFunction(() => document.querySelectorAll('.slot.filled').length === 4, { timeout: 15000 })
  .then(() => check('bấm quét lại: ảnh hiện lên màn hình', true))
  .catch(() => check('bấm quét lại: ảnh hiện lên màn hình', false));
await p.screenshot({ path: 'scratch/intake-3-loaded.png' });

await browser.close();
server.close();
(await import('../server/db.ts')).closeDb();
rmSync(dataDir, { recursive: true, force: true });
rmSync(captureRoot, { recursive: true, force: true });

console.log(fails.length ? `\nFAIL: ${fails.length} kiểm tra\n` : '\nOK — luồng lấy ảnh theo thư mục chạy đúng.\n');
process.exit(fails.length ? 1 : 0);
