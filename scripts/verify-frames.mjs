/**
 * Kiểm chứng trọn luồng khung ảnh trên server + trình duyệt thật.
 *
 * Câu hỏi quan trọng nhất: khung nhân viên TỰ TẢI LÊN có ra đúng ảnh như khung
 * dựng sẵn không? Ảnh phải lọt đúng vào lỗ trong suốt, và preview phải khớp
 * export y như trước — vì toạ độ ô giờ đến từ database chứ không từ mã nguồn.
 *
 *   node --experimental-strip-types scripts/verify-frames.mjs
 */
import { chromium, devices } from 'playwright';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'pb-vf-'));
const captureRoot = mkdtempSync(join(tmpdir(), 'pb-vfc-'));
process.env.PHOTOBOOTH_DATA = dataDir;
process.env.PHOTOBOOTH_CAPTURE = captureRoot;
process.env.PHOTOBOOTH_PASSWORD = 't';
process.env.PHOTOBOOTH_PORT = '8187';
process.env.PHOTOBOOTH_HOST = '127.0.0.1:8187';

const { start } = await import('../server/index.ts');
const server = start(8187);
await new Promise((r) => setTimeout(r, 400));
const BASE = 'http://127.0.0.1:8187';

const fails = [];
const check = (n, ok, x = '') => {
  console.log(ok ? `  ok   ${n}` : `  FAIL ${n} ${x}`);
  if (!ok) fails.push(n);
};

let cookie = '';
async function api(p, o = {}) {
  const res = await fetch(BASE + p, {
    ...o,
    headers: { ...(o.headers ?? {}), ...(cookie ? { cookie } : {}) },
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : null };
}

const sharp = (await import('sharp')).default;
const PNG = (name) => readFileSync(`public/frames/${name}.png`);

console.log('\n--- Thư viện khung ---');

await api('/api/staff/login', { method: 'POST', body: JSON.stringify({ password: 't' }) });

let r = await api('/api/staff/frames');
check('lần chạy đầu nạp sẵn 6 khung mẫu', r.body.frames.length === 6,
  `${r.body.frames.length} khung`);
check('khung mẫu đánh dấu builtin', r.body.frames.every((f) => f.builtin));

r = await api('/api/frames');
check('khách xem được danh sách mà không cần đăng nhập', r.status === 200);

// --- Bảo mật: chỉ nhân viên mới sửa được thư viện ---
console.log('\n--- Bảo mật ---');
const savedCookie = cookie;
cookie = '';
r = await api('/api/staff/frames', {
  method: 'POST', headers: { 'content-type': 'image/png' }, body: PNG('basic-6'),
});
check('chưa đăng nhập thì KHÔNG tải khung lên được', r.status === 401, `nhận ${r.status}`);
r = await api('/api/staff/frames');
check('chưa đăng nhập thì KHÔNG xem được khung đang tắt', r.status === 401, `nhận ${r.status}`);
cookie = savedCookie;

// --- Tải khung lên ---
console.log('\n--- Tải khung lên ---');

r = await api('/api/staff/frames/analyze', {
  method: 'POST', headers: { 'content-type': 'image/png' }, body: PNG('basic-9'),
});
check('dò thử: đúng 9 ô', r.body?.slots?.length === 9, `${r.body?.slots?.length} ô`);
check('dò thử: đoán đúng khổ 6×6', r.body?.formatId === 'square66', r.body?.formatId);

/*
 * Ảnh đặc (JPG, hay PNG xuất kèm nền) KHÔNG còn bị từ chối: dò ra 0 ô, nhân
 * viên tự đặt ô, rồi khâu lưu khoét lỗ theo. Kiểm cả ba nhịp đó qua HTTP thật.
 */
const solid = await sharp({
  create: { width: 600, height: 1800, channels: 3, background: { r: 9, g: 9, b: 9 } },
}).jpeg().toBuffer();

r = await api('/api/staff/frames/analyze', {
  method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: solid,
});
check('ảnh đặc: nhận file, dò ra 0 ô', r.status === 200 && r.body?.slots?.length === 0,
  `${r.status} / ${r.body?.slots?.length} ô`);
check('ảnh đặc: đánh dấu duc để giao diện nhắc đúng việc', r.body?.duc === true, `${r.body?.duc}`);
check('ảnh đặc: vẫn trả kích thước thật cho màn nắn ô',
  r.body?.width === 600 && r.body?.height === 1800, `${r.body?.width}x${r.body?.height}`);

// Không ô nào thì khung che kín ảnh khách - khâu lưu phải chặn
r = await api(`/api/staff/frames?label=${encodeURIComponent('Quen ve o')}`, {
  method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: solid,
});
check('ảnh đặc: KHÔNG lưu khi chưa vẽ ô nào', r.status === 400, `nhận ${r.status}`);
check('ảnh đặc: lời nhắn bảo đi vẽ ô', /ô nào/.test(r.body?.error ?? ''), r.body?.error);

/*
 * Có ô -> lưu được. Và phải kiểm LỖ CÓ THẬT SỰ ĐƯỢC KHOÉT trên file phục vụ
 * ra: khung đè lên trên ảnh khách lúc render, nên khoét hỏng là khách nhận
 * tấm che kín mà không có lỗi nào báo ra.
 */
const oTuDat = [{ x: 0.1, y: 0.05, w: 0.8, h: 0.4 }, { x: 0.1, y: 0.5, w: 0.8, h: 0.4 }];
r = await api(`/api/staff/frames?label=${encodeURIComponent('Khung JPG tu dat o')}`
  + `&slots=${encodeURIComponent(encodeURIComponent(JSON.stringify(oTuDat)))}`, {
  method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: solid,
});
check('ảnh đặc: lưu được khi đã đặt ô', r.status === 200 && r.body?.frame?.slotCount === 2,
  `${r.status} / ${r.body?.frame?.slotCount} ô`);

if (r.body?.frame) {
  const ducFrame = r.body.frame;
  const kBuf = Buffer.from(await (await fetch(BASE + ducFrame.overlaySrc)).arrayBuffer());
  check('ảnh đặc: file lưu ra có kênh alpha',
    (await sharp(kBuf).metadata()).hasAlpha === true);

  const { data: kPix, info: kInfo } = await sharp(kBuf).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  let trong = 0;
  for (let i = 3; i < kPix.length; i += kInfo.channels) if (kPix[i] < 128) trong++;
  const tiLe = trong / (kInfo.width * kInfo.height);
  // 2 ô x 0.8 x 0.4 = 64% diện tích
  check('ảnh đặc: khoét đúng hai ô đã đặt', Math.abs(tiLe - 0.64) < 0.02,
    `trong suốt ${(tiLe * 100).toFixed(1)}%`);

  // Dọn đi: các phép đếm khung phía dưới tính theo 6 mẫu + 1 khung của quán
  await api(`/api/staff/frames/${ducFrame.id}`, { method: 'DELETE' });
}

r = await api(`/api/staff/frames?label=${encodeURIComponent('Khung Của Quán')}`, {
  method: 'POST', headers: { 'content-type': 'image/png' }, body: PNG('basic-6'),
});
const mine = r.body.frame;
check('tải khung lên được', r.status === 200 && mine?.slotCount === 6);
check('khung tải lên KHÔNG bị đánh dấu builtin', mine?.builtin === false);

const img = await fetch(BASE + mine.overlaySrc);
check('tải được file PNG của khung', img.status === 200 &&
  img.headers.get('content-type') === 'image/png');

// --- Bật/tắt ---
console.log('\n--- Bật/tắt và xoá ---');
for (const f of (await api('/api/staff/frames')).body.frames) {
  if (f.builtin) {
    await api(`/api/staff/frames/${f.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
  }
}
r = await api('/api/frames');
check('tắt khung mẫu -> khách chỉ còn thấy khung của quán',
  r.body.frames.length === 1 && r.body.frames[0].label === 'Khung Của Quán',
  r.body.frames.map((f) => f.label).join(', '));

r = await api('/api/staff/frames');
check('nhân viên vẫn thấy đủ 7 khung', r.body.frames.length === 7, `${r.body.frames.length}`);

// --- Khách dùng khung tự tải lên ---
console.log('\n--- Khách ghép ảnh bằng khung của quán ---');

const s = (await api('/api/staff/sessions', {
  method: 'POST', body: JSON.stringify({ room: '1', maxPhotos: 8 }),
})).body;
await api('/api/room/claim', { method: 'POST', body: JSON.stringify({ room: '1', code: s.code }) });

mkdirSync(join(captureRoot, s.code), { recursive: true });
for (let i = 0; i < 8; i++) {
  writeFileSync(
    join(captureRoot, s.code, `I${i}.jpg`),
    await sharp({
      create: { width: 1200, height: 900, channels: 3, background: { r: 210, g: 40 + i * 20, b: 90 } },
    }).jpeg().toBuffer(),
  );
}
await api('/api/room/intake?room=1', { method: 'POST' });
const fin = await api('/api/room/finish?room=1', { method: 'POST' });

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));

await p.goto(fin.body.qr.composeUrl);
await p.waitForSelector('.frame-grid', { timeout: 20000 });
const shown = await p.locator('.frame-item b').allTextContents();
check('màn chọn khung chỉ hiện khung đang bật',
  shown.length === 1 && shown[0] === 'Khung Của Quán', shown.join(', '));

await p.click('.frame-item');
await p.waitForSelector('.photo-grid');
for (let i = 0; i < 6; i++) await p.click(`.photo >> nth=${i}`);
await p.click('.actions .btn-primary');
await p.waitForSelector('canvas.strip-canvas', { timeout: 25000 });
await p.waitForTimeout(700);
check('vào được trình chỉnh với đúng 6 ô',
  (await p.locator('.presets .chip').count()) === 6);

await p.click('.actions .btn-primary');
await p.waitForSelector('.result', { timeout: 30000 });
check('lưu ảnh ghép thành công', true);

const detail = (await api(`/api/staff/sessions/${s.id}`)).body;
check('ảnh ghép ghi đúng id khung của quán',
  detail.composites[0]?.frameId === mine.id,
  `${detail.composites[0]?.frameId} vs ${mine.id}`);

/*
 * ẢNH CÓ THẬT SỰ LỌT VÀO LỖ KHÔNG.
 *
 * Đây mới là bằng chứng toạ độ dò được là đúng. Chỉ kiểm "lưu thành công"
 * thì một khung dò sai bét vẫn qua — file vẫn ra, chỉ là toàn màu khung.
 * Ảnh kiểm là các sắc đỏ/hồng, khung basic-6 nền trắng: lấy mẫu giữa từng ô,
 * pixel phải là màu ảnh chứ không phải trắng.
 */
const strip = Buffer.from(await (await fetch(
  `${BASE}/media/strips/${detail.composites[0].id}?s=${detail.composites[0].slug}`)).arrayBuffer());
const { data: sPix, info: sInfo } = await sharp(strip).raw()
  .toBuffer({ resolveWithObject: true });

let filled = 0;
for (const slot of mine.slots) {
  const cx = Math.round((slot.rect.x + slot.rect.w / 2) * sInfo.width);
  const cy = Math.round((slot.rect.y + slot.rect.h / 2) * sInfo.height);
  const i = (cy * sInfo.width + cx) * sInfo.channels;
  const [red, green, blue] = [sPix[i], sPix[i + 1], sPix[i + 2]];
  // Ảnh kiểm luôn đỏ trội hẳn; nền khung là trắng (3 kênh gần bằng nhau)
  if (red > 150 && red - blue > 40) filled++;
}
check('mọi ô đều có ảnh lọt qua lỗ khung', filled === mine.slots.length,
  `${filled}/${mine.slots.length} ô có ảnh`);

/*
 * Xoá khung SAU KHI khách đã ghép: ảnh đã lưu phải còn nguyên.
 * Nhân viên dọn khung cũ không được làm hỏng ảnh khách đã tải về.
 */
await api(`/api/staff/frames/${mine.id}`, { method: 'DELETE' });
const still = await fetch(
  `${BASE}/media/strips/${detail.composites[0].id}?s=${detail.composites[0].slug}`);
check('xoá khung KHÔNG làm mất ảnh khách đã ghép', still.status === 200,
  `nhận ${still.status}`);

r = await api('/api/frames');
check('khung đã xoá biến khỏi danh sách của khách',
  !r.body.frames.some((f) => f.id === mine.id));

check('không có lỗi javascript nào', errs.length === 0, errs.slice(0, 2).join(' | '));

/*
 * Server phải dựng lại ảnh từ ẢNH GỐC, không phải giữ bản điện thoại gửi lên.
 *
 * Điện thoại ghép từ preview 1400px; server có ảnh gốc 6000x4000 nên dựng lại
 * được bản nét hơn hẳn. Đo bằng chênh lệch pixel liền kề: bản dựng từ ảnh gốc
 * giữ được chi tiết mảnh mà bản preview đã làm nhoè mất.
 */
const hiBuf = Buffer.from(await (await fetch(
  `${BASE}/media/strips/${detail.composites[0].id}?s=${detail.composites[0].slug}`)).arrayBuffer());
const hiMeta = await sharp(hiBuf).metadata();
check('ảnh ghép đúng khổ 300 DPI',
  hiMeta.width === 1200 && hiMeta.height === 1800,
  `${hiMeta.width}x${hiMeta.height}`);

const sp = await browser.newPage({ viewport: { width: 1366, height: 768 } });
/*
 * Bắt mọi confirm()/prompt()/alert() còn sót.
 * Hộp thoại của trình duyệt CHẶN CỨNG luồng JS và người dùng tắt được vĩnh
 * viễn — bấm nút xong không thấy gì xảy ra. Phải là 0.
 */
let native = 0;
sp.on('dialog', async (d) => { native++; await d.dismiss(); });

await sp.goto(`${BASE}/staff`);
await sp.fill('input[type=password]', 't');
await sp.click('.login button[type=submit]');
await sp.waitForSelector('.tabs', { timeout: 10000 });
await sp.click('.tabs button:has-text("Khung ảnh")');
await sp.waitForSelector('.frame-card');

console.log('\n--- Nắn ô trên khung ---');

/*
 * Hộp nền ca-rô phải bằng ĐÚNG vùng ảnh vẽ ra. Trước đây hộp bị đặt chiều cao
 * cứng rồi để object-fit co ảnh: khung 1:3 nhận hộp 340×400, ảnh thật chỉ
 * 133×400, nên mọi ô đánh số lệch khỏi lỗ khung mà nhìn ảnh chụp vẫn thấy
 * "có ô". Vì thế phải đo tỉ lệ, không chỉ đo có/không.
 */
await sp.setInputFiles('input[type=file]', 'public/frames/basic-4.png');
await sp.waitForSelector('.frame-preview', { timeout: 15000 });
await sp.waitForTimeout(300);

const geo = await sp.evaluate(() => {
  const img = document.querySelector('.preview-img img');
  const b = img.getBoundingClientRect();
  const boxes = [...document.querySelectorAll('.slot-box')].map((e) => e.getBoundingClientRect());
  const arFile = img.naturalWidth / img.naturalHeight;
  return {
    arOff: Math.abs(arFile - b.width / b.height) / arFile,
    inside: boxes.every((r) => r.left >= b.left - 1 && r.right <= b.right + 1
      && r.top >= b.top - 1 && r.bottom <= b.bottom + 1),
    n: boxes.length,
  };
});
check('nắn ô: hộp ảnh đúng tỉ lệ file', geo.arOff < 0.01,
  `lệch ${(geo.arOff * 100).toFixed(1)}%`);
check('nắn ô: mọi ô nằm trọn trong vùng ảnh', geo.n > 0 && geo.inside, `${geo.n} ô`);
check('nắn ô: đã bỏ nút gộp ô',
  (await sp.locator('.slot-editor button:has-text("Gộp")').count()) === 0);

// Bấm chọn ô không được đẩy phần dưới nhảy một nhịp
const cardH = () => sp.locator('.frame-preview')
  .evaluate((e) => Math.round(e.getBoundingClientRect().height));
const h0 = await cardH();
await sp.locator('.slot-box').first().click();
await sp.waitForTimeout(150);
check('nắn ô: chọn ô thì hiện nút xoá',
  await sp.isVisible('.se-sel button:has-text("Xoá ô này")'));
const h1 = await cardH();
check('nắn ô: chọn ô KHÔNG làm bố cục nhảy', h1 === h0, `${h0}px -> ${h1}px`);

await sp.click('.se-sel button:has-text("Xoá ô này")');
await sp.waitForTimeout(200);
check('nắn ô: xoá đúng một ô',
  (await sp.locator('.slot-box').count()) === geo.n - 1);
check('nắn ô: nhãn số ô đếm lại',
  ((await sp.locator('.slot-editor .field-label').textContent()) ?? '')
    .includes(`${geo.n - 1} ô`));

await sp.click('.preview-actions .ghost');
await sp.waitForTimeout(400);
check('nắn ô: bấm Huỷ thì không lưu gì',
  (await sp.locator('.frame-preview').count()) === 0);

/*
 * ẢNH ĐẶC TRÊN GIAO DIỆN.
 *
 * Với ảnh đặc, ô không phải cái khung ngắm mà là VẾT CẮT: lưu xong là hoa văn
 * trong lòng ô mất thật. Nên màn này phải vẽ ô thành lỗ caro, và phải có nút
 * chừa viền — đó là hai thứ cho nhân viên thấy trước hậu quả, thay vì phát
 * hiện sau khi khách đã nhận ảnh.
 */
console.log('\n--- Ảnh đặc trên giao diện ---');

check('có khối hướng dẫn chuẩn bị file khung',
  (await sp.locator('.frame-help summary').count()) === 1);
await sp.click('.frame-help summary');
await sp.waitForTimeout(200);
const hd = (await sp.locator('.frame-help').textContent()) ?? '';
check('hướng dẫn nói rõ trong suốt khác màu trắng',
  /trống rỗng/.test(hd) && /màu trắng/.test(hd));
check('hướng dẫn có cách xuất file và kích thước cần xuất',
  /Canva/.test(hd) && /600 × 1800/.test(hd));
await sp.click('.frame-help summary');

const jpgDir = mkdtempSync(join(tmpdir(), 'pb-vfj-'));
const jpgKhung = join(jpgDir, 'khung-dac.jpg');
writeFileSync(jpgKhung, await sharp({
  create: { width: 600, height: 1800, channels: 3, background: { r: 36, g: 31, b: 43 } },
}).jpeg().toBuffer());

await sp.setInputFiles('input[type=file]', jpgKhung);
await sp.waitForSelector('.frame-preview', { timeout: 15000 });
await sp.waitForTimeout(300);

check('ảnh đặc: vẽ ô thành lỗ caro (class se-duc)',
  (await sp.locator('.se-box.se-duc').count()) === 1);
check('ảnh đặc: vào màn với 0 ô và nút Lưu bị khoá',
  (await sp.locator('.slot-box').count()) === 0
  && await sp.isDisabled('.preview-actions button.primary'));

await sp.click('.se-tools .se-chip:has-text("3")');
await sp.waitForTimeout(200);
check('ảnh đặc: xếp nhanh ra 3 ô và mở lại nút Lưu',
  (await sp.locator('.slot-box').count()) === 3
  && !(await sp.isDisabled('.preview-actions button.primary')));

const dienTich = () => sp.evaluate(() => [...document.querySelectorAll('.slot-box')]
  .reduce((t, e) => {
    const r = e.getBoundingClientRect();
    return t + r.width * r.height;
  }, 0));

const dt0 = await dienTich();
await sp.click('.se-tools .se-chip[title^="Thu nhỏ"]');
await sp.waitForTimeout(150);
const dt1 = await dienTich();
check('chừa viền: bấm co thì mọi ô nhỏ lại',
  dt1 < dt0, `${Math.round(dt0)} -> ${Math.round(dt1)}`);

await sp.click('.se-tools .se-chip[title^="Nới"]');
await sp.waitForTimeout(150);
check('chừa viền: bấm nới thì về đúng cỡ cũ',
  Math.abs((await dienTich()) - dt0) < dt0 * 0.02);

// Nới quá tay: ô phải dừng ở mép ảnh, không tràn ra ngoài
for (let i = 0; i < 12; i++) await sp.click('.se-tools .se-chip[title^="Nới"]');
await sp.waitForTimeout(250);
const tran = await sp.evaluate(() => {
  const b = document.querySelector('.preview-img img').getBoundingClientRect();
  return [...document.querySelectorAll('.slot-box')].some((e) => {
    const r = e.getBoundingClientRect();
    return r.left < b.left - 1 || r.right > b.right + 1
      || r.top < b.top - 1 || r.bottom > b.bottom + 1;
  });
});
check('chừa viền: nới quá tay ô KHÔNG tràn ra ngoài ảnh', tran === false);

await sp.click('.preview-actions .ghost');
await sp.waitForTimeout(300);

// Khung đã có lỗ sẵn thì KHÔNG vẽ caro: ở đó ô là khung ngắm, không phải vết cắt
await sp.setInputFiles('input[type=file]', 'public/frames/basic-4.png');
await sp.waitForSelector('.frame-preview', { timeout: 15000 });
await sp.waitForTimeout(300);
check('khung có lỗ sẵn: KHÔNG vẽ ô thành caro',
  (await sp.locator('.se-box.se-duc').count()) === 0);
await sp.click('.preview-actions .ghost');
await sp.waitForTimeout(300);

console.log('\n--- Hộp thoại xác nhận ---');

const nFrames = await sp.locator('.frame-card').count();

// Đổi tên: điền sẵn tên cũ, tên rỗng thì không lưu được
await sp.locator('.frame-card').first().locator('button:has-text("Đổi tên")').click();
await sp.waitForSelector('dialog.dialog[open]', { timeout: 5000 });
check('đổi tên: mở hộp thoại của app', true);
check('đổi tên: điền sẵn tên cũ',
  (await sp.inputValue('.dialog .text-input')).trim() !== '');
await sp.fill('.dialog .text-input', '   ');
check('đổi tên: tên rỗng thì khoá nút lưu', await sp.locator('.dialog .primary').isDisabled());
await sp.keyboard.press('Escape');
await sp.waitForTimeout(300);
check('phím Esc đóng được hộp thoại',
  (await sp.locator('dialog.dialog[open]').count()) === 0);

// Xoá: bấm Huỷ thì KHÔNG được xoá
await sp.locator('.frame-card').first().locator('button:has-text("Xoá")').click();
await sp.waitForSelector('dialog.dialog[open]');
const danger = await sp.locator('.dialog .primary')
  .evaluate((e) => getComputedStyle(e).backgroundColor);
check('xoá: nút xác nhận màu đỏ cảnh báo', danger === 'rgb(217, 45, 32)', danger);
await sp.click('.dialog .ghost');
await sp.waitForTimeout(500);
check('bấm Huỷ thì KHÔNG xoá gì',
  (await sp.locator('.frame-card').count()) === nFrames);

// Xác nhận thì mới xoá thật
await sp.locator('.frame-card').first().locator('button:has-text("Xoá")').click();
await sp.waitForSelector('dialog.dialog[open]');
await sp.click('.dialog .primary');
await sp.waitForTimeout(700);
check('bấm Xoá thì xoá thật',
  (await sp.locator('.frame-card').count()) === nFrames - 1);

/*
 * Bật lại không cần hỏi — bấm nhầm thì tắt lại, không mất gì.
 * Ở đoạn trên mọi khung mẫu đã bị tắt nên phải bật một cái lên trước rồi mới
 * thử tắt được.
 */
await sp.locator('.frame-card.off').first().locator('button:has-text("Bật")').click();
await sp.waitForTimeout(600);
check('bật lại khung thì KHÔNG hỏi lại',
  (await sp.locator('dialog.dialog[open]').count()) === 0);

await sp.locator('.frame-card:not(.off)').first().locator('button:has-text("Tắt")').click();
await sp.waitForSelector('dialog.dialog[open]', { timeout: 5000 });
check('tắt khung thì CÓ hỏi', true);
await sp.click('.dialog .primary');
await sp.waitForTimeout(600);

// Đóng phiên — hành động nặng nhất, khách mất luôn đường xem ảnh
const s2 = (await api('/api/staff/sessions', {
  method: 'POST', body: JSON.stringify({ room: '2', maxPhotos: 4 }),
})).body;
await sp.click('.tabs button:has-text("Phiên chụp")');
await sp.waitForSelector('.btn-close');

// Nhắm ĐÚNG thẻ phòng 2 — phòng 1 vẫn còn phiên của phần kiểm ở trên
const room2 = sp.locator('.room-card', { has: sp.locator('.room-name', { hasText: 'Phòng 2' }) });
await room2.locator('.btn-close').click();
await sp.waitForSelector('dialog.dialog[open]', { timeout: 5000 });
check('đóng phiên: hộp thoại nhắc đúng mã',
  (await sp.locator('.dialog h2').textContent())?.includes(s2.code),
  `${await sp.locator('.dialog h2').textContent()} (mong đợi ${s2.code})`);

await sp.click('.dialog .ghost');
await sp.waitForTimeout(500);
check('đóng phiên: bấm Huỷ thì phiên vẫn còn',
  (await room2.locator('.btn-close').count()) === 1);

await room2.locator('.btn-close').click();
await sp.waitForSelector('dialog.dialog[open]');
await sp.click('.dialog .primary');
await sp.waitForTimeout(900);
check('đóng phiên: xác nhận thì đóng thật',
  (await room2.locator('.btn-close').count()) === 0);

check('KHÔNG còn hộp thoại nào của trình duyệt', native === 0, `${native} hộp thoại`);

await browser.close();
server.close();
rmSync(captureRoot, { recursive: true, force: true });

if (fails.length) {
  console.log(`\nFAIL: ${fails.length} kiểm tra`);
  process.exit(1);
}
console.log('\nOK — luồng quản lý khung ảnh chạy đúng.');
process.exit(0);
