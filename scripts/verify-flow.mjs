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

// Chỉ còn chọn phòng — ô "số kiểu ảnh" đã bỏ, trần ảnh lấy từ thiết lập chung
await staff.click('.pkg:has-text("Phòng 1")');
check('KHÔNG còn ô chọn số kiểu ảnh',
  !(await staff.isVisible('.pkg:has-text("kiểu")')));
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
// Màn phòng giờ chỉ hiện SỐ ẢNH ĐÃ CHỤP, không còn lưới ô trống và không
// còn "4/8" — trần ảnh là lưới an toàn của hệ thống, không phải gói khách mua
await room.waitForFunction(
  () => document.querySelector('.counter .big')?.textContent?.trim() === '4',
  { timeout: 20000 },
);
check('bấm "Đã chụp xong" thì lấy đủ 4 ảnh từ thư mục', true);
check('màn phòng KHÔNG hiện trần ảnh cho khách',
  !(await room.textContent('.counter'))?.includes('/'));
check('KHÔNG còn nút thêm ảnh tay',
  !(await room.isVisible('button:has-text("Thêm ảnh tay")')));

await room.click('.btn:has-text("Hiện mã QR")');
await room.waitForSelector('.qr-card', { timeout: 10000 });
check('chỉ còn 1 mã QR (ghép khung)', (await room.locator('.qr-card').count()) === 1);
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

// Hiện CẢ khung nhiều ô hơn số ảnh (4 ảnh vẫn thấy khung 6/9 ô) — khách bù
// bằng ảnh trong album điện thoại.
const frameCount = await phone.locator('.frame-item').count();
check('hiện cả khung nhiều ô hơn số ảnh đang có',
  (await phone.locator('.frame-item:has-text("Basic 6")').count()) === 1,
  `${frameCount} khung`);

await phone.click('.frame-item:has-text("Basic 4")');
await phone.waitForSelector('.photo-grid', { timeout: 10000 });

// Chọn thiếu ảnh -> nút Tiếp tục phải bị khoá
await phone.click('button.photo >> nth=0');
await phone.click('button.photo >> nth=1');
check('chọn thiếu ảnh thì chưa cho đi tiếp',
  await phone.isDisabled('.actions .btn-primary'));

await phone.click('button.photo >> nth=2');
await phone.click('button.photo >> nth=3');
check('chọn đủ ảnh thì mở nút tiếp tục',
  !(await phone.isDisabled('.actions .btn-primary')));

// Chọn thừa -> không nhận thêm
const before = await phone.locator('.photo.on').count();
check('không cho chọn quá số ô của khung', before === 4, `${before}`);

await phone.click('.actions .btn-primary');
await phone.waitForSelector('.strip-canvas', { timeout: 20000 });
check('vào được màn hình chỉnh ảnh', true);

// Đổi chỗ ô 1 và ô 2: ảnh phải đổi cho nhau
await phone.click('.tool-tabs button:has-text("Đổi chỗ")');
const srcOf = (i) => phone.locator('.swap-item img').nth(i).getAttribute('src');
const [s1, s2] = [await srcOf(0), await srcOf(1)];
await phone.click('.swap-item >> nth=0');
check('chạm ô đầu thì ô đó được đánh dấu',
  (await phone.locator('.swap-item.on').count()) === 1);
await phone.click('.swap-item >> nth=1');
check('chạm ô thứ hai thì hai ảnh đổi chỗ',
  (await srcOf(0)) === s2 && (await srcOf(1)) === s1, `${await srcOf(0)} / ${s2}`);
check('đổi xong thì bỏ đánh dấu', (await phone.locator('.swap-item.on').count()) === 0);

// Chỉnh màu đã bỏ theo yêu cầu của quán — ảnh ghép giữ màu gốc
check('KHÔNG còn tab chỉnh màu cho khách',
  (await phone.locator('.tool-tabs button:has-text("Màu")').count()) === 0);

await phone.click('.actions .btn-primary');
await phone.waitForSelector('.result', { timeout: 30000 });
check('lưu xong hiện ảnh kết quả', await phone.isVisible('.result'));
/*
 * Nút tải phải là thẻ <a> trỏ vào /media/strips — tức bản SERVER dựng từ
 * ảnh gốc. Từng có lúc nó tải result.blob mà điện thoại tự ghép ở DPI thấp:
 * khách xem ảnh nét trên màn hình rồi nhận về bản mờ, mà hai ảnh nhìn giống
 * hệt nên không ai nghi là tải sai.
 */
const taiVe = phone.locator('a:has-text("Tải xuống")');
check('có nút tải xuống', await taiVe.isVisible());
const href = await taiVe.getAttribute('href');
check('nút tải trỏ vào ảnh SERVER dựng, không phải bản điện thoại tự ghép',
  (href ?? '').includes('/media/strips/'), href ?? '(khong co href)');
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

/*
 * Ảnh ghép phải ở SERVER_DPI (600), không phải 300 của trình duyệt.
 *
 * Điện thoại ghép ở 300 DPI vì vướng trần canvas iOS, rồi server dựng lại
 * từ ảnh gốc ở gấp đôi — đó là điểm khác biệt duy nhất giữa ảnh khách xem
 * trước và ảnh khách tải về. Số này tụt về 600x1800 nghĩa là bước dựng lại
 * đã thất bại và khách đang nhận bản mờ.
 */
const meta = await sharp(join(sessionDir, 'strips', strips[0])).metadata();
check('ảnh ghép đúng 2400x7200 (2x6 inch @1200DPI server)',
  meta.width === 2400 && meta.height === 7200, `${meta.width}x${meta.height}`);
check('ảnh ghép ghi đúng DPI vào metadata',
  meta.density === 1200, String(meta.density));

// ---------------------------------------------------------------------------
console.log('\n--- Nhân viên lấy hộ ảnh ---');
await staff.reload();
await staff.waitForSelector('table tbody tr', { timeout: 10000 });
check('trang nhân viên KHÔNG còn tab Chỉnh màu',
  (await staff.locator('nav button:has-text("Chỉnh màu")').count()) === 0);
await staff.click('button.link:has-text("Xem ảnh")');
await staff.waitForSelector('.modal-inner', { timeout: 10000 });
check('nhân viên xem lại được ảnh của phiên',
  (await staff.locator('.modal-inner .thumb').count()) >= 5);   // 4 gốc + 1 ghép

// ---------------------------------------------------------------------------
console.log('\n--- Khách lấy thêm ảnh từ album điện thoại ---');
await phone.goto(composeUrl);
await phone.waitForSelector('.frame-grid', { timeout: 15000 });
await phone.click('.frame-item:has-text("Basic 6")');
await phone.waitForSelector('.photo-grid', { timeout: 10000 });
check('có ô "Ảnh trong máy" ở đầu lưới',
  await phone.isVisible('.photo-grid > .photo.add:first-child'));
check('nhắc khách còn thiếu ảnh',
  (await phone.textContent('.lead'))?.includes('Cần thêm 2 ảnh'));

const albumFile = async (name, r) => ({
  name, mimeType: 'image/jpeg',
  buffer: await sharp({
    create: { width: 1200, height: 1600, channels: 3, background: { r, g: 90, b: 160 } },
  }).jpeg().toBuffer(),
});
await phone.setInputFiles('.photo.add input[type=file]',
  [await albumFile('album-1.jpg', 40), await albumFile('album-2.jpg', 220)]);
await phone.waitForFunction(
  () => document.querySelectorAll('button.photo').length === 6,
  { timeout: 20000 },
);
check('ảnh album hiện trong lưới', true);
check('ảnh vừa tải lên được chọn sẵn',
  (await phone.locator('button.photo.on').count()) === 2);
check('không báo lỗi khi tải ảnh hợp lệ', !(await phone.isVisible('.notice-inline')));

for (let i = 0; i < 4; i++) await phone.click(`button.photo >> nth=${i}`);
await phone.click('.actions .btn-primary');
await phone.waitForSelector('.strip-canvas', { timeout: 20000 });
await phone.click('.actions .btn-primary');
await phone.waitForSelector('.result', { timeout: 30000 });
check('ghép được dải có ảnh từ album', await phone.isVisible('.result'));

const albumDir = join(dataDir, readdirSync(dataDir).find((d) => /^\d{4}-/.test(d)), code);
check('ảnh album lưu thành ảnh gốc của phiên',
  readdirSync(join(albumDir, 'originals')).length === 6);
const strip2 = readdirSync(join(albumDir, 'strips')).sort().at(-1);
// Khung khổ lớn thì server tự hạ DPI theo trần RAM (render.ts, fitDpi) —
// nhưng vẫn phải nét hơn bản 300 DPI điện thoại tự ghép.
const albumDpi = (await sharp(join(albumDir, 'strips', strip2)).metadata()).density;
check('dải có ảnh album vẫn được server dựng bản nét', albumDpi > 300, String(albumDpi));

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
