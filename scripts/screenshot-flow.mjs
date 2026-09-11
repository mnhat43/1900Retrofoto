/** Chụp màn hình từng bước để xem bằng mắt. */
import { chromium } from 'playwright';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

mkdirSync('scratch', { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'pb-shot-'));
const captureRoot = mkdtempSync(join(tmpdir(), 'pb-shotcap-'));
process.env.PHOTOBOOTH_DATA = dataDir;
process.env.PHOTOBOOTH_CAPTURE = captureRoot;
process.env.PHOTOBOOTH_PASSWORD = 'test-secret';
process.env.PHOTOBOOTH_PORT = '8197';
process.env.PHOTOBOOTH_HOST = '127.0.0.1:8197';

const { start } = await import('../server/index.ts');
const server = start(8197);
await new Promise((r) => setTimeout(r, 400));
const BASE = 'http://127.0.0.1:8197';

const browser = await chromium.launch();
const shot = (p, n) => p.screenshot({ path: `scratch/${n}.png` });

// --- Nhân viên ---
const staff = await browser.newPage({ viewport: { width: 1100, height: 800 } });
await staff.goto(`${BASE}/staff`);
await staff.waitForSelector('.login');
await shot(staff, 'flow-1-staff-login');

await staff.fill('input[type=password]', 'test-secret');
await staff.click('.login button');
await staff.waitForSelector('.pkg-row');
await staff.click('.pkg:has-text("Phòng 1")');
await staff.click('button.primary:has-text("Tạo mã")');
// Mã hiện ở thẻ phòng (khối "Mã cho phòng" đã bỏ)
await staff.waitForSelector('.room-card.busy .room-code');
const code = (await staff.textContent('.room-card.busy .room-code')).trim();
await shot(staff, 'flow-2-staff-code');

// --- Phòng ---
const room = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await room.goto(`${BASE}/room?p=1`);
await room.waitForSelector('.keypad');
await room.click('.keypad button:text-is("4")');
await room.click('.keypad button:text-is("2")');
await shot(room, 'flow-3-room-locked');

await room.reload();
await room.waitForSelector('.keypad');
for (const d of code) await room.click(`.keypad button:text-is("${d}")`);
await room.waitForSelector('.counter');

const sharp = (await import('sharp')).default;
const colors = [
  { r: 220, g: 40, b: 70 }, { r: 40, g: 140, b: 220 },
  { r: 50, g: 190, b: 100 }, { r: 240, g: 175, b: 45 },
];
const files = [];
for (let i = 0; i < 4; i++) {
  files.push({
    name: `t${i}.jpg`, mimeType: 'image/jpeg',
    buffer: await sharp({
      create: { width: 1600, height: 1200, channels: 3, background: colors[i] },
    }).jpeg().toBuffer(),
  });
}
const shotDir = join(captureRoot, code);
mkdirSync(shotDir, { recursive: true });
for (let i = 0; i < 2; i++) writeFileSync(join(shotDir, `IMG_${i + 1}.jpg`), files[i].buffer);
await room.click('.btn:has-text("Đã chụp xong")');
// Bo dem chi con so anh da chup (bo luoi o trong va "x/N")
await room.waitForFunction(
  () => document.querySelector('.counter .big')?.textContent?.trim() === '2',
);
await shot(room, 'flow-4-room-shooting');

for (let i = 2; i < 4; i++) writeFileSync(join(shotDir, `IMG_${i + 1}.jpg`), files[i].buffer);
await room.click('.btn:has-text("Quét lại")');
await room.waitForFunction(
  () => document.querySelector('.counter .big')?.textContent?.trim() === '4',
);
await room.click('.btn:has-text("Hiện mã QR")');
await room.waitForSelector('.qr-card');
await shot(room, 'flow-5-room-qr');

const composeUrl = await room.evaluate(async () => {
  const r = await fetch('/api/room/session?room=1');
  return (await r.json()).qr.composeUrl;
});

// --- Điện thoại khách ---
const phone = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true,
});
await phone.goto(composeUrl);
await phone.waitForSelector('.frame-grid');
await shot(phone, 'flow-6-phone-frames');

await phone.click('.frame-item:has-text("Basic 4")');
await phone.waitForSelector('.photo-grid');
await phone.click('.photo >> nth=0');
await phone.click('.photo >> nth=1');
await shot(phone, 'flow-7-phone-pick');

await phone.click('.photo >> nth=2');
await phone.click('.photo >> nth=3');
await phone.click('.actions .btn-primary');
await phone.waitForSelector('.strip-canvas');
await phone.waitForTimeout(800);
await shot(phone, 'flow-8-phone-edit');

await phone.click('.tool-tabs button:has-text("Màu")');
await phone.waitForTimeout(300);
await phone.click('.chip:has-text("Sepia")');
await phone.waitForTimeout(600);
await phone.click('.actions .btn-primary');
await phone.waitForSelector('.result');
await phone.waitForTimeout(500);
await shot(phone, 'flow-9-phone-saved');

console.log('da chup 9 man hinh vao scratch/');

await browser.close();
server.close();
const { closeDb } = await import('../server/db.ts');
closeDb();
rmSync(dataDir, { recursive: true, force: true });
rmSync(captureRoot, { recursive: true, force: true });
