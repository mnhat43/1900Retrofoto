/**
 * Kiểm chứng giá và doanh thu trên TRÌNH DUYỆT THẬT.
 *
 * Câu hỏi quan trọng nhất: tổng tiền hiện ra có đúng bằng tiền thật không, và
 * phiên chưa gắn giá có bị âm thầm tính thành 0 đồng không. Sai sổ tiền là
 * kiểu lỗi không ai phát hiện ra cho tới lúc đối chiếu cuối tháng.
 *
 *   node --experimental-strip-types scripts/verify-revenue.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const dataDir = mkdtempSync(join(tmpdir(), 'pb-rev-'));
process.env.PHOTOBOOTH_DATA = dataDir;
process.env.PHOTOBOOTH_PASSWORD = 't';
process.env.PHOTOBOOTH_PORT = '8194';
process.env.PHOTOBOOTH_HOST = '127.0.0.1:8194';

const { start } = await import('../server/index.ts');
const server = start(8194);
await new Promise((r) => setTimeout(r, 400));
const BASE = 'http://127.0.0.1:8194';

const fails = [];
const check = (n, ok, x = '') => {
  console.log(ok ? `  ok   ${n}` : `  FAIL ${n} ${x}`);
  if (!ok) fails.push(n);
};

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));

await page.goto(`${BASE}/staff`);
await page.fill('input[type=password]', 't');
await page.click('button[type=submit]');
await page.waitForSelector('.tabs', { timeout: 15000 });

console.log('\n--- Bảng giá ---');

await page.click('.tabs button:has-text("Doanh thu")');
await page.waitForSelector('.rev-total', { timeout: 10000 });
check('mở được tab Doanh thu', await page.isVisible('.rev-total'));
check('chưa có phiên nào thì tổng là 0đ',
  (await page.textContent('.rev-total b'))?.includes('0đ'));

await page.click('.setting-row button:has-text("Mở")');
await page.waitForSelector('.price-add', { timeout: 5000 });

// Thêm hai gói
for (const [ten, gia] of [['Gói cơ bản', '100000'], ['Gói VIP', '250000']]) {
  await page.fill('.price-add input[placeholder="Tên gói"]', ten);
  await page.fill('.price-add input[placeholder="Giá (đồng)"]', gia);
  await page.click('.price-add button:has-text("Thêm")');
  await page.waitForTimeout(400);
}
check('thêm được 2 gói giá', (await page.locator('.price-row').count()) === 2,
  String(await page.locator('.price-row').count()));
check('giá hiện đúng định dạng Việt Nam',
  (await page.textContent('.price-row .price-amount'))?.includes('100.000'),
  await page.textContent('.price-row .price-amount'));

/*
 * Ô nhập giá chỉ nhận số. Gõ nhầm chữ vào ô tiền là chuyện hay xảy ra lúc
 * vội, và nếu lọt qua thì giá thành NaN rồi tổng cả ngày hỏng theo.
 */
await page.fill('.price-add input[placeholder="Giá (đồng)"]', 'abc123xyz');
check('ô giá lọc bỏ chữ, chỉ giữ số',
  (await page.inputValue('.price-add input[placeholder="Giá (đồng)"]')) === '123');
await page.fill('.price-add input[placeholder="Giá (đồng)"]', '');

console.log('\n--- Tạo phiên kèm giá ---');

await page.click('.tabs button:has-text("Phiên chụp")');
await page.waitForSelector('.pkg-row', { timeout: 10000 });
check('ô chọn gói hiện ở màn tạo mã',
  await page.isVisible('.pkg:has-text("Gói cơ bản")'));

await page.click('.pkg:has-text("Phòng 2")');
await page.click('.pkg:has-text("Gói cơ bản")');
await page.click('button.primary:has-text("Tạo mã")');
await page.waitForTimeout(800);

await page.click('.tabs button:has-text("Doanh thu")');
await page.waitForSelector('.rev-total', { timeout: 10000 });
check('tổng tiền cập nhật sau khi tạo phiên',
  (await page.textContent('.rev-total b'))?.includes('100.000'),
  await page.textContent('.rev-total b'));
check('bảng hiện tên gói kèm số tiền',
  (await page.textContent('.rev-amount'))?.includes('Gói cơ bản'),
  await page.textContent('.rev-amount'));

console.log('\n--- Phiên không gắn giá ---');

await page.click('.tabs button:has-text("Phiên chụp")');
await page.waitForSelector('.pkg-row', { timeout: 10000 });
await page.click('.pkg:has-text("Phòng 3")');
await page.click('button.primary:has-text("Tạo mã")');
await page.waitForTimeout(800);

await page.click('.tabs button:has-text("Doanh thu")');
await page.waitForSelector('.rev-total', { timeout: 10000 });

/*
 * Đây là ca dễ sai nhất: phiên chưa có giá KHÔNG được coi là bán 0 đồng.
 * Cộng nhầm thì tổng vẫn "đúng" về mặt số học nhưng sai về ý nghĩa, và
 * không ai nhận ra thiếu tiền.
 */
check('phiên chưa có giá KHÔNG bị tính thành 0đ — tổng giữ nguyên',
  (await page.textContent('.rev-total b'))?.includes('100.000'),
  await page.textContent('.rev-total b'));
check('có cảnh báo phiên chưa gắn giá', await page.isVisible('.rev-warn'));
check('cảnh báo nói đúng số phiên',
  (await page.textContent('.rev-warn'))?.includes('1 phiên'),
  await page.textContent('.rev-warn'));
check('cột giá hiện dấu gạch, không hiện 0đ',
  (await page.locator('td[data-label="Giá"] .dash').count()) === 1);

console.log('\n--- Đặt giá sau ---');

await page.click('button.link:has-text("Đặt giá")');
await page.waitForSelector('.rev-pick', { timeout: 5000 });
await page.click('.rev-pick button:has-text("250.000")');
await page.waitForTimeout(700);
check('đặt giá sau cho phiên đã tạo',
  (await page.textContent('.rev-total b'))?.includes('350.000'),
  await page.textContent('.rev-total b'));
check('hết cảnh báo khi mọi phiên đã có giá',
  !(await page.isVisible('.rev-warn')));

await page.click('button.link:has-text("Đổi giá") >> nth=0');
await page.waitForSelector('.rev-pick', { timeout: 5000 });
await page.click('.rev-pick button:has-text("Gỡ")');
await page.waitForTimeout(700);
check('gỡ giá ra được, tổng giảm lại',
  (await page.textContent('.rev-total b'))?.includes('100.000'),
  await page.textContent('.rev-total b'));

console.log('\n--- Doanh thu đã ghi không đổi theo bảng giá ---');

/*
 * Quán sửa bảng giá là chuyện thường. Doanh thu những ngày trước PHẢI giữ
 * nguyên — nếu nó chạy theo giá mới thì sổ sách cũ tự viết lại, và không ai
 * đối chiếu được với tiền mặt đã thu.
 */
await page.click('.setting-row button:has-text("Mở")');
await page.waitForSelector('.price-row', { timeout: 5000 });
await page.click('.price-row:has-text("Gói cơ bản") button:has-text("Xoá")');
await page.waitForSelector('dialog[open]', { timeout: 5000 });
await page.click('dialog[open] button:has-text("Xoá")');
await page.waitForTimeout(800);
check('xoá gói KHÔNG làm đổi doanh thu đã ghi',
  (await page.textContent('.rev-total b'))?.includes('100.000'),
  await page.textContent('.rev-total b'));

console.log('\n--- Ngày khác ---');
const nutNgay = await page.locator('.rev-days .pkg').count();
check('có nút chọn ngày', nutNgay >= 1, String(nutNgay));
check('mặc định đang xem hôm nay',
  (await page.textContent('.rev-days .pkg.on'))?.includes('Hôm nay'),
  await page.textContent('.rev-days .pkg.on'));

check('không có lỗi javascript nào', errs.length === 0, errs.join(' | '));

await browser.close();
server.close();
await new Promise((r) => setTimeout(r, 300));
try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* thư mục tạm */ }

console.log(fails.length
  ? `\nFAIL: ${fails.length} kiểm tra\n`
  : '\nOK — luồng giá và doanh thu chạy đúng.\n');
process.exit(fails.length ? 1 : 0);
