/**
 * Kiểm chứng TRỌN LUỒNG bằng trình duyệt thật, trên server thật.
 *
 * Đi đúng đường người dùng đi:
 *   NV đăng nhập -> tạo mã -> phòng nhập mã -> upload ảnh -> hiện QR
 *   -> khách quét QR -> chọn khung -> chọn ảnh -> ghép -> lưu -> tải về
 *
 * Chạy trên bản build thật (dist/), không phải dev server.
 *
 *   npm run build && node scripts/verify-flow.mjs
 */
import { chromium } from 'playwright';
import { mkdtempSync, rmSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'pb-flow-'));
const captureRoot = mkdtempSync(join(tmpdir(), 'pb-flowcap-'));
process.env.PHOTOBOOTH_DATA = dataDir;
process.env.PHOTOBOOTH_CAPTURE = captureRoot;
process.env.PHOTOBOOTH_PASSWORD = 'test-secret';
process.env.PHOTOBOOTH_PORT = '8198';
process.env.PHOTOBOOTH_HOST = '127.0.0.1:8198';

const { start } = await import('../server/index.ts');
const server = start(8198);
await new Promise((r) => setTimeout(r, 400));

const BASE = 'http://127.0.0.1:8198';
const fails = [];
const check = (name, cond, extra = '') => {
  console.log(cond ? `  ok   ${name}` : `  FAIL ${name} ${extra}`);
  if (!cond) fails.push(name);
};

const browser = await chromium.launch();
const errors = [];

// ---------------------------------------------------------------------------
console.log('\n--- Nhân viên tạo mã ---');
const staff = await browser.newPage();
staff.on('pageerror', (e) => errors.push(`staff: ${e.message}`));
await staff.goto(`${BASE}/staff`);
await staff.waitForSelector('.login', { timeout: 10000 });

await staff.fill('input[type=password]', 'test-secret');
await staff.click('.login button');
await staff.waitForSelector('.pkg-row', { timeout: 10000 });
check('đăng nhập được', true);

await staff.click('.pkg:has-text("Phòng 1")');
await staff.click('.pkg:has-text("4 kiểu")');
await staff.click('button.primary:has-text("Tạo mã")');
// Mã hiện ở thẻ phòng (khối "Mã cho phòng" đã bỏ)
await staff.waitForSelector('.room-card.busy .room-code', { timeout: 10000 });
const code = (await staff.textContent('.room-card.busy .room-code'))?.trim();
check('hiện mã 4 số cho nhân viên đọc', /^\d{4}$/.test(code ?? ''), `got "${code}"`);

// ---------------------------------------------------------------------------
console.log('\n--- Phòng nhập mã, chụp ảnh ---');
const room = await browser.newPage();
room.on('pageerror', (e) => errors.push(`room: ${e.message}`));
await room.goto(`${BASE}/room?p=1`);
await room.waitForSelector('.keypad', { timeout: 10000 });
check('phòng khoá cho tới khi nhập mã', await room.isVisible('.keypad'));

for (const d of code) await room.click(`.keypad button:text-is("${d}")`);
await room.waitForSelector('.counter', { timeout: 10000 });
check('mã đúng thì mở khoá phòng', await room.isVisible('.counter'));

// Giả lập máy ảnh đổ ảnh vào thư mục của phiên, rồi bấm "Đã chụp xong".
// Đây là luồng thật duy nhất — nút thêm ảnh tay đã bỏ.
const sharp = (await import('sharp')).default;
const colors = [
  { r: 220, g: 40, b: 70 }, { r: 40, g: 140, b: 220 },
  { r: 50, g: 190, b: 100 }, { r: 240, g: 175, b: 45 },
];
const shotDir = join(captureRoot, code);
mkdirSync(shotDir, { recursive: true });
for (let i = 0; i < 4; i++) {
  writeFileSync(
    join(shotDir, `IMG_${i + 1}.jpg`),
    await sharp({
      create: { width: 1600, height: 1200, channels: 3, background: colors[i] },
    }).jpeg().toBuffer(),
  );
}

await room.click('.btn:has-text("Đã chụp xong")');
await room.waitForFunction(
  () => document.querySelectorAll('.slot.filled').length === 4,
  { timeout: 20000 },
);
check('bấm "Đã chụp xong" thì lấy đủ 4 ảnh từ thư mục', true);
check('KHÔNG còn nút thêm ảnh tay',
  !(await room.isVisible('button:has-text("Thêm ảnh tay")')));

await room.click('.btn:has-text("Hiện mã QR")');
await room.waitForSelector('.qr-card', { timeout: 10000 });
check('hiện đủ 2 mã QR', (await room.locator('.qr-card').count()) === 2);
check('có nhắc tải ảnh trước khi về',
  (await room.textContent('.warn'))?.includes('trước khi rời quán'));

// Lấy link ghép khung y như khách quét QR
const composeUrl = await room.evaluate(async () => {
  const r = await fetch('/api/room/session?room=1');
  return (await r.json()).qr.composeUrl;
});
check('link ghép khung KHÔNG chứa mã 4 số', !composeUrl.includes(code), composeUrl);

// ---------------------------------------------------------------------------
console.log('\n--- Khách ghép khung trên điện thoại ---');
const phone = await browser.newPage({
  viewport: { width: 390, height: 844 },      // cỡ iPhone
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
phone.on('pageerror', (e) => errors.push(`phone: ${e.message}`));

await phone.goto(composeUrl);
await phone.waitForSelector('.frame-grid', { timeout: 15000 });

// Chỉ hiện khung dùng được với số ảnh đang có (4 ảnh -> không có khung 6/9 ô)
const frameCount = await phone.locator('.frame-item').count();
check('chỉ hiện khung vừa với số ảnh có', frameCount > 0 && frameCount <= 3,
  `${frameCount} khung`);

await phone.click('.frame-item:has-text("Basic 4")');
await phone.waitForSelector('.photo-grid', { timeout: 10000 });

// Chọn thiếu ảnh -> nút Tiếp tục phải bị khoá
await phone.click('.photo >> nth=0');
await phone.click('.photo >> nth=1');
check('chọn thiếu ảnh thì chưa cho đi tiếp',
  await phone.isDisabled('.actions .btn-primary'));

await phone.click('.photo >> nth=2');
await phone.click('.photo >> nth=3');
check('chọn đủ ảnh thì mở nút tiếp tục',
  !(await phone.isDisabled('.actions .btn-primary')));

// Chọn thừa -> không nhận thêm
const before = await phone.locator('.photo.on').count();
check('không cho chọn quá số ô của khung', before === 4, `${before}`);

await phone.click('.actions .btn-primary');
await phone.waitForSelector('.strip-canvas', { timeout: 20000 });
check('vào được màn hình chỉnh ảnh', true);

// Đổi màu để chắc chắn phần chỉnh màu vẫn hoạt động
await phone.click('.tool-tabs button:has-text("Màu")');
await phone.waitForTimeout(300);
await phone.click('.chip:has-text("Đen trắng")');
await phone.waitForTimeout(600);

await phone.click('.actions .btn-primary');
await phone.waitForSelector('.result', { timeout: 30000 });
check('lưu xong hiện ảnh kết quả', await phone.isVisible('.result'));
check('có nút tải xuống', await phone.isVisible('button:has-text("Tải xuống")'));
/*
 * Màn này chỉ còn ĐÚNG MỘT việc: tải ảnh về.
 * Bỏ "Chép link" vì nhân viên xem ảnh thẳng trên trang quản lý, và bỏ "Ghép
 * thêm dải khác" vì khách quay lại từ đầu được rồi.
 */
check('KHÔNG còn nút chép link',
  (await phone.locator('button:has-text("Chép link")').count()) === 0);
check('KHÔNG còn nút ghép thêm dải',
  (await phone.locator('button:has-text("Ghép thêm")').count()) === 0);
check('thanh dưới chỉ còn một nút',
  (await phone.locator('.actions .btn').count()) === 1);
check('có hướng dẫn lưu ảnh cho iPhone',
  (await phone.textContent('.tip'))?.includes('bấm giữ'));

// ---------------------------------------------------------------------------
console.log('\n--- File trên ổ cứng ---');
const dirs = readdirSync(dataDir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
check('tạo thư mục theo ngày', dirs.length === 1, dirs.join(','));
const sessionDir = join(dataDir, dirs[0], code);
check('thư mục đặt theo mã phiên', existsSync(sessionDir), sessionDir);
check('có ảnh gốc', readdirSync(join(sessionDir, 'originals')).length === 4);
check('có ảnh proxy', readdirSync(join(sessionDir, 'previews')).length === 4);
const strips = readdirSync(join(sessionDir, 'strips'));
check('có ảnh đã ghép khung', strips.length === 1, strips.join(','));

// Ảnh ghép phải đúng khổ 300 DPI của khung 4 ô
const meta = await sharp(join(sessionDir, 'strips', strips[0])).metadata();
check('ảnh ghép đúng 600x1800 (2x6 inch @300DPI)',
  meta.width === 600 && meta.height === 1800, `${meta.width}x${meta.height}`);

// ---------------------------------------------------------------------------
console.log('\n--- Nhân viên lấy hộ ảnh ---');
await staff.reload();
await staff.waitForSelector('table tbody tr', { timeout: 10000 });
await staff.click('button.link:has-text("Xem ảnh")');
await staff.waitForSelector('.modal-inner', { timeout: 10000 });
check('nhân viên xem lại được ảnh của phiên',
  (await staff.locator('.modal-inner .thumb').count()) >= 5);   // 4 gốc + 1 ghép

if (errors.length) fails.push(`lỗi trang: ${errors.join('; ')}`);

await browser.close();
server.close();
const { closeDb } = await import('../server/db.ts');
closeDb();
rmSync(dataDir, { recursive: true, force: true });
rmSync(captureRoot, { recursive: true, force: true });

console.log(fails.length
  ? `\nFAIL: ${fails.length} kiểm tra\n${fails.map((f) => ' - ' + f).join('\n')}\n`
  : '\nOK — trọn luồng chạy thông.\n');
process.exit(fails.length ? 1 : 0);
