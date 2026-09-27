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

  /*
   * Xoay / lật: cùng bài kiểm với verify-api (phía server). Ảnh nửa trái đỏ,
   * nửa phải xanh; hai phía PHẢI ra cùng kết quả, nếu không khách thấy một
   * kiểu trên điện thoại mà tải về lại ra kiểu khác.
   */
  const f4 = FRAMES.find((f) => f.id === 'basic-4');
  const tc = document.createElement('canvas');
  tc.width = tc.height = 1000;
  const tx = tc.getContext('2d');
  tx.fillStyle = 'rgb(20,40,230)'; tx.fillRect(0, 0, 1000, 1000);
  tx.fillStyle = 'rgb(230,20,20)'; tx.fillRect(0, 0, 500, 1000);
  const tb = await createImageBitmap(tc);
  const [s0, s1, s2] = f4.slots;
  const rotState = {
    frame: f4,
    photos: new Map([['t', { id: 't', bitmap: tb, natural: { w: 1000, h: 1000 } }]]),
    contents: new Map([
      [s0.id, { ...DEFAULT_CONTENT('t'), rotate: 90 }],
      [s1.id, { ...DEFAULT_CONTENT('t'), flipX: true }],
      [s2.id, { ...DEFAULT_CONTENT('t'), rotate: 180 }],
    ]),
    color: DEFAULT_COLOR,
  };
  const rb = await createImageBitmap(await exportStrip(rotState, null, 'png'));
  const rc = document.createElement('canvas');
  rc.width = rb.width; rc.height = rb.height;
  const rctx = rc.getContext('2d');
  rctx.drawImage(rb, 0, 0);
  const tone = (s, fx, fy) => {
    const d = rctx.getImageData(
      Math.round((s.rect.x + s.rect.w * fx) * rb.width),
      Math.round((s.rect.y + s.rect.h * fy) * rb.height), 1, 1).data;
    return d[0] > 150 && d[2] < 100 ? 'do' : d[2] > 150 && d[0] < 100 ? 'xanh' : `?(${d[0]},${d[2]})`;
  };
  const orient = {
    rot90: [tone(s0, 0.5, 0.2), tone(s0, 0.5, 0.8)],
    flip: [tone(s1, 0.2, 0.5), tone(s1, 0.8, 0.5)],
    rot180: [tone(s2, 0.2, 0.5), tone(s2, 0.8, 0.5)],
  };

  return { out, orient };
});
const { out: frameResults, orient } = results;

await browser.close();
await server.close();

// --- Khẳng định ---
const fail = [];
const near = (a, b, tol = 12) =>
  Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

if (orient.rot90.join() !== 'do,xanh') fail.push(`xoay 90°: mong đợi trên đỏ/dưới xanh, được ${orient.rot90}`);
if (orient.flip.join() !== 'xanh,do') fail.push(`lật ngang: mong đợi trái xanh/phải đỏ, được ${orient.flip}`);
if (orient.rot180.join() !== 'xanh,do') fail.push(`xoay 180°: mong đợi trái xanh/phải đỏ, được ${orient.rot180}`);

for (const r of frameResults) {
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
for (const r of frameResults) {
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
