/**
 * Kiểm chứng đường xuất file bằng trình duyệt thật.
 *
 * Chạy chính code render của app (drawStrip + exportStrip) cho TỪNG khung
 * trong thư viện rồi khẳng định:
 *  1. File xuất đúng khổ của khung (3-4 ô -> 600x1800, 6 ô -> 1200x1800,
 *     9 ô -> 1800x1800)
 *  2. Mọi ô đều thật sự lọt ảnh qua lỗ trong suốt của khung
 *  3. Khung che đúng phần ngoài ô
 *  4. Preview và export cho khung hình TRÙNG KHỚP
 *
 *   node scripts/verify-export.mjs
 */
import { chromium } from 'playwright';
import { blankHost } from './blank-host.mjs';
import { mkdirSync } from 'node:fs';

mkdirSync('scratch', { recursive: true });

const server = await blankHost(5199);

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

// Trang trắng — script tự import module render qua dev server.
await page.goto('http://localhost:5199/');

const results = await page.evaluate(async () => {
  const { drawStrip } = await import('/src/render/draw.ts');
  const { exportStrip } = await import('/src/render/export.ts');
  const { FRAMES } = await import('/src/frames/index.ts');
  const { FORMATS, formatPx } = await import('/src/core/format.ts');
  const { DEFAULT_CONTENT, DEFAULT_COLOR } = await import('/src/core/types.ts');

  /** Ảnh giả một màu đặc — mỗi ô một màu khác nhau để kiểm từng ô riêng. */
  function makePhoto(hex) {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = hex;
    x.fillRect(0, 0, 1200, 900);
    return c;
  }

  const out = [];

  for (const frame of FRAMES) {
    // Mỗi ô một ảnh màu riêng -> kiểm được ảnh có vào ĐÚNG ô của nó không.
    const photos = new Map();
    const contents = new Map();
    const expected = [];
    for (let i = 0; i < frame.slots.length; i++) {
      // Màu phân biệt rõ: xoay quanh vòng hue, tránh trắng/đen của khung.
      const hue = Math.round((360 / frame.slots.length) * i);
      const hex = `hsl(${hue} 90% 45%)`;
      const id = `p${i}`;
      const bmp = await createImageBitmap(makePhoto(hex));
      photos.set(id, { id, file: null, bitmap: bmp, natural: { w: 1200, h: 900 } });
      contents.set(frame.slots[i].id, DEFAULT_CONTENT(id));
      // Lấy màu thật sau khi canvas rasterise
      const probe = document.createElement('canvas');
      probe.width = probe.height = 1;
      const pctx = probe.getContext('2d');
      pctx.drawImage(bmp, 0, 0, 1, 1);
      const d = pctx.getImageData(0, 0, 1, 1).data;
      expected.push([d[0], d[1], d[2]]);
    }

    const state = { frame, contents, photos, color: DEFAULT_COLOR };

    const overlay = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('overlay ' + frame.overlaySrc));
      i.src = frame.overlaySrc;
    });

    const blob = await exportStrip(state, overlay, 'png');
    const bmp = await createImageBitmap(blob);

    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const px = (x, y) => {
      const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return [d[0], d[1], d[2]];
    };

    // Giữa mỗi ô phải là đúng màu ảnh của ô đó.
    const slotColors = frame.slots.map((s) => {
      const cx = (s.rect.x + s.rect.w / 2) * bmp.width;
      const cy = (s.rect.y + s.rect.h / 2) * bmp.height;
      return px(cx, cy);
    });

    // Đáy trang (vùng chú thích của khung) phải là màu khung, không phải ảnh.
    const bottom = px(bmp.width / 2, bmp.height * 0.97);

    // --- So khớp preview vs export ---
    const expPx = formatPx(FORMATS[frame.formatId]);
    const scale = 0.35;
    const PW = Math.round(expPx.w * scale);
    const PH = Math.round(expPx.h * scale);
    const pc = document.createElement('canvas');
    pc.width = PW;
    pc.height = PH;
    drawStrip(pc.getContext('2d'), state, PW, PH, overlay);
    const pctx = pc.getContext('2d');

    let maxDiff = 0;
    for (const s of frame.slots) {
      const u = s.rect.x + s.rect.w / 2;
      const v = s.rect.y + s.rect.h / 2;
      const a = pctx.getImageData(Math.round(u * PW), Math.round(v * PH), 1, 1).data;
      const b = ctx.getImageData(
        Math.round(u * bmp.width),
        Math.round(v * bmp.height),
        1,
        1,
      ).data;
      for (let i = 0; i < 3; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
    }

    out.push({
      id: frame.id,
      slotCount: frame.slotCount,
      formatId: frame.formatId,
      size: [bmp.width, bmp.height],
      expectedSize: [expPx.w, expPx.h],
      slotColors,
      expected,
      bottom,
      maxDiff,
    });
  }

  return out;
});

await browser.close();
await server.close();

// --- Khẳng định ---
const fail = [];
const near = (a, b, tol = 12) =>
  Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

for (const r of results) {
  const tag = `[${r.id}]`;
  if (r.size[0] !== r.expectedSize[0] || r.size[1] !== r.expectedSize[1]) {
    fail.push(`${tag} sai khổ: ${r.size} (mong đợi ${r.expectedSize})`);
  }
  r.slotColors.forEach((got, i) => {
    if (!near(got, r.expected[i])) {
      fail.push(`${tag} ô ${i + 1} sai màu: ${got} (mong đợi ${r.expected[i]})`);
    }
  });
  const isFrameColor =
    (r.bottom[0] > 240 && r.bottom[1] > 240 && r.bottom[2] > 240) ||
    (r.bottom[0] < 40 && r.bottom[1] < 40 && r.bottom[2] < 40);
  if (!isFrameColor) fail.push(`${tag} đáy trang không phải khung: ${r.bottom}`);
  if (r.maxDiff > 8) fail.push(`${tag} preview lệch export: maxDiff=${r.maxDiff}`);
}
if (errors.length) fail.push(`lỗi console: ${errors.join('; ')}`);

console.log('khung          ô  khổ         kích thước    lệch preview/export');
console.log('─'.repeat(66));
for (const r of results) {
  console.log(
    `${r.id.padEnd(14)} ${String(r.slotCount).padEnd(2)} ${r.formatId.padEnd(10)} ` +
      `${(r.size[0] + 'x' + r.size[1]).padEnd(12)} ${r.maxDiff}`,
  );
}

if (fail.length) {
  console.error('\nFAIL:\n' + fail.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log('\nOK — tất cả kiểm chứng đạt.');
