/**
 * Kiểm chứng các màn hình KHÔNG bị cuộn dọc.
 *
 * Đo chiều cao cuộn thật của trang thay vì nhìn ảnh — nhìn ảnh không phát hiện
 * được phần bị đẩy ra ngoài màn hình.
 *
 * Thử ở nhiều cỡ màn, gồm cả màn thấp (laptop 768px) và điện thoại nhỏ.
 *
 *   node scripts/verify-noscroll.mjs
 */
import { chromium, devices } from 'playwright';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'pb-ns-'));
const captureRoot = mkdtempSync(join(tmpdir(), 'pb-nscap-'));
process.env.PHOTOBOOTH_DATA = dataDir;
process.env.PHOTOBOOTH_CAPTURE = captureRoot;
process.env.PHOTOBOOTH_PASSWORD = 't';
process.env.PHOTOBOOTH_PORT = '8186';
process.env.PHOTOBOOTH_HOST = '127.0.0.1:8186';

const { start } = await import('../server/index.ts');
const server = start(8186);
await new Promise((r) => setTimeout(r, 400));
const BASE = 'http://127.0.0.1:8186';

const fails = [];
const check = (n, ok, x = '') => { console.log(ok ? `  ok   ${n}` : `  FAIL ${n} ${x}`); if (!ok) fails.push(n); };

let cookie = '';
async function api(p, o = {}) {
  const res = await fetch(BASE + p, { ...o, headers: { ...(o.headers ?? {}), ...(cookie ? { cookie } : {}) } });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return res.json().catch(() => ({}));
}

const sharp = (await import('sharp')).default;
const jpeg = (rgb) => sharp({
  create: { width: 1200, height: 900, channels: 3, background: rgb },
}).jpeg().toBuffer();

await api('/api/staff/login', { method: 'POST', body: JSON.stringify({ password: 't' }) });

/** Chênh lệch cho phép — vài px do bo tròn, không phải cuộn thật. */
const SLOP = 4;

async function scrollY(page) {
  return page.evaluate(() =>
    Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
}

const browser = await chromium.launch();

// Gói 12 ảnh: nhiều ô nhất -> dễ tràn nhất
const s1 = await api('/api/staff/sessions', { method: 'POST', body: JSON.stringify({ room: '1', maxPhotos: 12 }) });
await api('/api/room/claim', { method: 'POST', body: JSON.stringify({ room: '1', code: s1.code }) });

/**
 * Logo phải TO và CĂN GIỮA, không chỉ "có mặt".
 * Chỉ kiểm isVisible thì logo 15px lệch trái vẫn đạt.
 */
async function checkBrand(p, what, minPx) {
  const m = await p.evaluate(() => {
    const el = document.querySelector('.brand');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { size: parseFloat(getComputedStyle(el).fontSize),
             off: Math.abs(r.x + r.width / 2 - innerWidth / 2) };
  });
  check(`${what}: logo đủ to`, !!m && m.size >= minPx, m ? `${m.size.toFixed(1)}px` : 'không thấy');
  check(`${what}: logo căn giữa`, !!m && m.off <= 2, m ? `lệch ${Math.round(m.off)}px` : '');
}

// --- Màn hình phòng, nhiều cỡ gồm màn THẤP ---
console.log('\n--- Màn hình phòng ---');
for (const [label, w, h] of [
  ['1920x1080', 1920, 1080],
  ['1366x768 (laptop thấp)', 1366, 768],
  ['1280x720', 1280, 720],
]) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });

  await p.goto(`${BASE}/room?p=2`);
  await p.waitForSelector('.keypad');
  await p.waitForTimeout(300);
  check(`nhập mã ${label} không cuộn`, (await scrollY(p)) <= SLOP, `${await scrollY(p)}px`);
  check(`nhập mã ${label} có logo`, await p.isVisible('.brand'));
  await checkBrand(p, `nhập mã ${label}`, 21);

  await p.goto(`${BASE}/room?p=1`);
  await p.waitForSelector('.counter');
  await p.waitForTimeout(300);
  check(`đang chụp ${label} không cuộn`, (await scrollY(p)) <= SLOP, `${await scrollY(p)}px`);
  check(`đang chụp ${label} có logo`, await p.isVisible('.brand'));
  await checkBrand(p, `đang chụp ${label}`, 21);
  await p.close();
}

// Chụp đủ 12 ảnh rồi kiểm màn QR
mkdirSync(join(captureRoot, s1.code), { recursive: true });
for (let i = 0; i < 12; i++) {
  writeFileSync(join(captureRoot, s1.code, `I${i}.jpg`),
    await jpeg({ r: 200, g: 60 + i * 10, b: 90 }));
}
await api('/api/room/intake?room=1', { method: 'POST' });
await api('/api/room/finish?room=1', { method: 'POST' });

for (const [label, w, h] of [['1920x1080', 1920, 1080], ['1366x768 (laptop thấp)', 1366, 768]]) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.goto(`${BASE}/room?p=1`);
  await p.waitForSelector('.qr-card');
  await p.waitForTimeout(400);
  check(`màn QR ${label} không cuộn`, (await scrollY(p)) <= SLOP, `${await scrollY(p)}px`);
  check(`màn QR ${label} có logo`, await p.isVisible('.brand'));
  await checkBrand(p, `màn QR ${label}`, 21);
  // Dòng cảnh báo không được chồng lên thẻ QR
  const overlap = await p.evaluate(() => {
    const card = document.querySelector('.qr-card');
    const warn = document.querySelector('.warn');
    if (!card || !warn) return 0;
    const a = card.getBoundingClientRect(), b = warn.getBoundingClientRect();
    return Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  });
  check(`màn QR ${label}: cảnh báo KHÔNG đè lên thẻ QR`, overlap === 0, `${overlap}px`);
  await p.screenshot({ path: `scratch/ns-room-qr-${h}.png` });
  await p.close();
}

// --- Giao diện khách trên điện thoại ---
console.log('\n--- Giao diện khách (điện thoại) ---');
const r = await api(`/api/room/session?room=1`);
const composeUrl = r.qr.composeUrl;

for (const [label, dev, scheme] of [
  ['iPhone 13', devices['iPhone 13'], 'light'],
  ['iPhone SE (màn nhỏ)', devices['iPhone SE'], 'light'],
  // Máy đặt chế độ TỐI: giao diện khách vẫn phải sáng
  ['iPhone 13 (máy chế độ tối)', devices['iPhone 13'], 'dark'],
]) {
  const ctx = await browser.newContext({ ...dev, colorScheme: scheme });
  const p = await ctx.newPage();

  await p.goto(composeUrl);
  await p.waitForSelector('.frame-grid');
  await p.waitForTimeout(400);
  check(`chọn khung ${label} không cuộn cả trang`, (await scrollY(p)) <= SLOP, `${await scrollY(p)}px`);
  check(`chọn khung ${label} có logo`, await p.isVisible('.brand'));

  await p.click('.frame-item:has-text("Basic 6")');
  await p.waitForSelector('.photo-grid');
  await p.waitForTimeout(400);
  check(`chọn ảnh ${label} không cuộn cả trang`, (await scrollY(p)) <= SLOP, `${await scrollY(p)}px`);
  check(`chọn ảnh ${label}: nút Tiếp tục luôn nhìn thấy`,
    await p.isVisible('.actions .btn-primary'));

  for (let i = 0; i < 6; i++) await p.click(`.photo >> nth=${i}`);
  await p.click('.actions .btn-primary');
  await p.waitForSelector('.strip-canvas', { timeout: 20000 });
  await p.waitForTimeout(600);
  check(`chỉnh ảnh ${label} không cuộn`, (await scrollY(p)) <= SLOP, `${await scrollY(p)}px`);

  /*
   * Kiểm CẢ CÁC BỀ MẶT, không chỉ body.
   * Chỉ kiểm body từng bỏ sót lỗi: nền sáng nhưng thanh trên và bảng công cụ
   * vẫn tối, vì chúng đọc token khác mà media query dark còn ghi đè.
   */
  const surfaces = await p.evaluate(() => {
    const lum = (el) => {
      const m = /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(el).backgroundColor);
      return m ? (+m[1] + +m[2] + +m[3]) / 3 : null;
    };
    const out = {};
    for (const [name, sel] of [
      ['body', 'body'], ['thanh trên', '.bar'],
      ['bảng công cụ', '.tools'], ['thanh nút', '.actions'],
    ]) {
      const el = document.querySelector(sel);
      if (el) out[name] = lum(el);
    }
    return out;
  });
  const dark = Object.entries(surfaces).filter(([, v]) => v !== null && v < 170);
  check(`${label}: mọi bề mặt đều sáng`, dark.length === 0,
    dark.map(([k, v]) => `${k}=${Math.round(v)}`).join(', '));

  /*
   * Bộ căn chỉnh bằng nút.
   * Khung đã chọn xong ở bước trước nên bước này KHÔNG được có bảng chọn khung
   * nữa; thay vào đó là chọn ô + nút mũi tên + thanh trượt.
   */
  check(`${label}: bước chỉnh KHÔNG còn tab chọn khung`,
    !(await p.isVisible('.tool-tabs button:has-text("Khung")')));
  check(`${label}: có 6 nút chọn ô`,
    (await p.locator('.presets .chip').count()) === 6);

  /*
   * Khung ảnh phải chiếm phần đáng kể màn hình.
   * Trước đây bảng công cụ là `flex: 0 0 auto` nên lấy trước đủ 377px nó cần,
   * canvas nhận phần thừa — trên iPhone SE còn đúng 1px. Không màn nào cuộn
   * nên phép kiểm cũ vẫn xanh, mà khung ảnh thì biến mất.
   */
  const stageH = await p.locator('.stage')
    .evaluate((el) => Math.round(el.getBoundingClientRect().height));
  const vh = await p.evaluate(() => innerHeight);
  check(`${label}: khung ảnh chiếm >=25% màn hình`, stageH >= vh * 0.25,
    `${stageH}px / ${vh}px`);
  check(`${label}: có bàn phím mũi tên`, await p.isVisible('.pad'));

  /*
   * Đọc trị số trên 3 thanh trượt.
   * KHÔNG so pixel canvas được: ảnh kiểm là một màu đặc, dịch đi đâu thì
   * canvas vẫn y hệt. Trị số thanh trượt mới là thứ phản ánh trạng thái thật.
   */
  const vals = () => p.locator('.align-sliders input[type=range]')
    .evaluateAll((els) => els.map((e) => e.value).join('/'));

  const before = await vals();

  /*
   * Ở zoom = 1 luôn có ĐÚNG MỘT trục còn dịch được (coverScale dùng max), nên
   * đúng một cặp mũi tên phải mờ đi. Nếu cả hai cùng bấm được thì phép tính
   * phần thừa đã sai ở đâu đó.
   */
  const liveRight = await p.isEnabled('.pad-btn.right');
  const liveDown = await p.isEnabled('.pad-btn.down');
  check(`${label}: ở zoom 1 chỉ một trục dịch được`, liveRight !== liveDown,
    `ngang=${liveRight} dọc=${liveDown}`);

  // Thang zoom phải là 1..8, không phải -1..1 như hai thanh dịch
  const zoomRange = await p.locator('.align-sliders input[type=range]').first()
    .evaluate((el) => [el.min, el.max, el.value].join('/'));
  check(`${label}: thanh Phóng to đúng thang zoom`, zoomRange === '1/8/1', zoomRange);

  const arrow = liveRight ? '.pad-btn.right' : '.pad-btn.down';
  await p.click(arrow);
  await p.waitForTimeout(200);
  check(`${label}: bấm mũi tên làm ảnh dịch thật`, (await vals()) !== before,
    `${before} -> ${await vals()}`);

  await p.click('.pad-btn.mid');
  await p.waitForTimeout(200);
  check(`${label}: nút căn giữa đưa ô về mặc định`, (await vals()) === before,
    `${await vals()} (mong đợi ${before})`);

  /*
   * Phóng to thì trục vừa khít phải mở khoá.
   * Kéo thật bằng chuột chứ không gán el.value — React không nhận sự kiện
   * input tự chế, nên gán tay sẽ kiểm nhầm là "hỏng" trong khi app vẫn chạy.
   */
  const zoomBox = await p.locator('.align-sliders input[type=range]').first().boundingBox();
  // Từng bị bóp còn 8px trên máy 320px — "hiện" nhưng không kéo nổi
  check(`${label}: thanh trượt đủ rộng để kéo`, zoomBox.width >= 90,
    `${Math.round(zoomBox.width)}px`);
  await p.mouse.move(zoomBox.x + 4, zoomBox.y + zoomBox.height / 2);
  await p.mouse.down();
  await p.mouse.move(zoomBox.x + zoomBox.width / 2, zoomBox.y + zoomBox.height / 2, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(250);

  const zoomNow = await p.locator('.align-sliders input[type=range]').first()
    .evaluate((el) => Number(el.value));
  check(`${label}: kéo thanh Phóng to có tác dụng`, zoomNow > 1.2, `zoom=${zoomNow}`);
  check(`${label}: phóng to thì mở khoá cả hai trục`,
    (await p.isEnabled('.pad-btn.right')) && (await p.isEnabled('.pad-btn.down')));

  // Chỉnh ô khác thì ô này không được đổi theo
  await p.click('.presets .chip >> nth=2');
  await p.waitForTimeout(150);
  check(`${label}: chọn ô khác vẫn giữ bàn phím`, await p.isVisible('.pad'));

  check(`${label}: chỉnh xong vẫn không cuộn`, (await scrollY(p)) <= SLOP, `${await scrollY(p)}px`);

  await p.screenshot({ path: `scratch/ns-phone-${scheme}-${(label.match(/SE|13/) ?? ['x'])[0]}.png` });

  // --- Lưu xong: màn khách nhìn thấy cuối cùng ---
  await p.click('.actions .btn-primary');
  await p.waitForSelector('.result', { timeout: 30000 });
  await p.waitForTimeout(500);
  check(`${label}: màn chụp xong không cuộn`, (await scrollY(p)) <= SLOP, `${await scrollY(p)}px`);
  await checkBrand(p, `màn chụp xong ${label}`, 18);

  await ctx.close();
}

// --- Trang nhân viên: phân trang ---
console.log('\n--- Trang nhân viên ---');
// 25 phiên trải nhiều ngày -> trang đầu đầy 10 dòng và có nhiều nhóm ngày,
// ép bảng phải cuộn để kiểm đúng tình huống thật.
const { getDb } = await import('../server/db.ts');
const sdb = getDb();
for (let i = 0; i < 25; i++) {
  for (const rm of (await api('/api/staff/rooms')).rooms) {
    if (rm.busy) await api(`/api/staff/sessions/${rm.session.id}/close`, { method: 'POST' });
  }
  const made = await api('/api/staff/sessions', { method: 'POST', body: JSON.stringify({ room: '1', maxPhotos: 4 }) });
  sdb.prepare('UPDATE sessions SET created_at = ? WHERE id = ?')
    .run(Date.now() - Math.floor(i / 4) * 86_400_000 - i * 60_000, made.id);
}

// Kiểm ở nhiều cỡ, gồm màn thấp nhất còn dùng thật
for (const [label, w, h] of [
  ['1920x1080', 1920, 1080],
  ['1366x768', 1366, 768],
  ['1280x720', 1280, 720],
  ['1024x700 (thấp nhất)', 1024, 700],
]) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.goto(`${BASE}/staff`);
  await p.waitForSelector('.login');
  await p.fill('input[type=password]', 't');
  await p.click('.login button');
  await p.waitForSelector('.rooms');
  await p.waitForTimeout(800);

  check(`nhân viên ${label}: cả trang KHÔNG cuộn`,
    (await scrollY(p)) <= SLOP, `${await scrollY(p)}px`);

  const vis = async (sel) => p.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const b = el.getBoundingClientRect();
    return b.bottom <= window.innerHeight + 2 && b.top >= -2;
  }, sel);

  check(`nhân viên ${label}: nút "Tạo mã" luôn thấy`, await vis('button.primary'));
  check(`nhân viên ${label}: thanh phân trang luôn thấy`, await vis('.pager'));
  if (w === 1280) await p.screenshot({ path: 'scratch/ns-staff-1280.png' });
  await p.close();
}

const sp = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await sp.goto(`${BASE}/staff`);
await sp.waitForSelector('.login');
await sp.fill('input[type=password]', 't');
await sp.click('.login button');
await sp.waitForSelector('.rooms');
await sp.waitForTimeout(700);

check('có phân trang khi nhiều phiên', await sp.isVisible('.pager'));
/*
 * Bảng phải cuộn ĐƯỢC khi nội dung dài hơn chỗ trống — nhưng không bắt buộc
 * lúc nào cũng đang tràn. Bỏ tiêu đề nhóm ngày làm bảng thấp đi, ở màn rộng
 * 10 dòng vừa khít nên không cần cuộn; đó là kết quả tốt hơn, không phải lỗi.
 * Điều thật sự cần: vùng bảng có cơ chế cuộn riêng, và cuộn nó KHÔNG làm
 * cả trang cuộn theo.
 */
check('vùng bảng có cơ chế cuộn riêng',
  await sp.evaluate(() => {
    const e = document.querySelector('.table-scroll');
    return !!e && getComputedStyle(e).overflowY === 'auto';
  }));

check('cuộn bảng KHÔNG làm cả trang cuộn',
  await sp.evaluate(() => {
    const e = document.querySelector('.table-scroll');
    if (!e) return false;
    e.scrollTop = 9999;
    return document.documentElement.scrollTop === 0;
  }));
const perPage = await sp.locator('tbody tr').count();
check('mỗi trang tối đa 10 phiên', perPage <= 10, `${perPage} dòng`);
check('KHÔNG còn khối "Mã cho phòng"', !(await sp.isVisible('.fresh')));

const info = await sp.textContent('.pg-info');
check('hiện số trang', /Trang 1\/\d+/.test(info ?? ''), info ?? '');

await sp.click('.pg:has-text("Cũ hơn")');
await sp.waitForTimeout(400);
check('bấm sang trang sau được',
  /Trang 2\/\d+/.test((await sp.textContent('.pg-info')) ?? ''));
await sp.screenshot({ path: 'scratch/ns-staff.png' });

await browser.close();
server.close();
(await import('../server/db.ts')).closeDb();
rmSync(dataDir, { recursive: true, force: true });
rmSync(captureRoot, { recursive: true, force: true });

console.log(fails.length ? `\nFAIL: ${fails.length} kiểm tra\n` : '\nOK — không màn nào bị cuộn ngoài ý muốn.\n');
process.exit(fails.length ? 1 : 0);
