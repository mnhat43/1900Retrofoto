/**
 * Kiểm chứng quan trọng nhất của đợt refactor Photo.
 *
 * Nạp CÙNG MỘT ảnh theo hai đường:
 *   1. loadPhoto(File)        — như khi người dùng chọn từ máy
 *   2. loadPhotoFromUrl(url)  — như khi khách ghép khung trên điện thoại
 *
 * rồi khẳng định ảnh xuất ra TRÙNG KHÍT từng byte.
 *
 * Nếu test này đạt thì việc ảnh đến từ server không hề làm đổi đường render —
 * tức là draw.ts / placement.ts / export.ts vẫn nguyên vẹn như đã kiểm chứng.
 *
 *   node scripts/verify-remote-photos.mjs
 */
import { chromium } from 'playwright';
import { blankHost } from './blank-host.mjs';
import { mkdirSync } from 'node:fs';

mkdirSync('scratch', { recursive: true });

const server = await blankHost(5197);

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

// Trang trắng — script tự import module render qua dev server.
await page.goto('http://localhost:5197/');

const results = await page.evaluate(async () => {
  const { loadPhoto, loadPhotoFromUrl } = await import('/src/media/assets.ts');
  const { exportStrip } = await import('/src/render/export.ts');
  const { FRAMES } = await import('/src/frames/index.ts');
  const { DEFAULT_CONTENT, DEFAULT_COLOR } = await import('/src/core/types.ts');

  /** Ảnh thử nghiệm có chi tiết, để phát hiện lệch dù nhỏ. */
  function makeTestImage(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#e11d48');
    g.addColorStop(0.5, '#0ea5e9');
    g.addColorStop(1, '#22c55e');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    // Thêm hoạ tiết sắc nét để lệch một pixel cũng lộ ra
    x.fillStyle = 'rgba(0,0,0,.6)';
    for (let i = 0; i < 12; i++) x.fillRect(i * (w / 12), 0, w / 40, h);
    for (let i = 0; i < 9; i++) x.fillRect(0, i * (h / 9), w, h / 60);
    return c;
  }

  const canvas = makeTestImage(1600, 1200);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));

  // Đường 1: từ File (như chọn từ máy)
  const file = new File([blob], 'test.png', { type: 'image/png' });
  const viaFile = await loadPhoto(file);

  // Đường 2: từ URL (như tải từ server)
  const url = URL.createObjectURL(blob);
  const viaUrl = await loadPhotoFromUrl(url, 'remote-1');

  const out = [];

  for (const frame of FRAMES) {
    const overlay = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('overlay'));
      i.src = frame.overlaySrc;
    });

    const build = (photo) => {
      const contents = new Map();
      for (const s of frame.slots) contents.set(s.id, DEFAULT_CONTENT(photo.id));
      return {
        frame,
        contents,
        photos: new Map([[photo.id, photo]]),
        color: DEFAULT_COLOR,
      };
    };

    const blobA = await exportStrip(build(viaFile), overlay, 'png');
    const blobB = await exportStrip(build(viaUrl), overlay, 'png');

    const read = async (b) => {
      const bmp = await createImageBitmap(b);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      return c.getContext('2d').getImageData(0, 0, bmp.width, bmp.height);
    };

    const a = await read(blobA);
    const bb = await read(blobB);

    let maxDiff = 0;
    let diffPixels = 0;
    if (a.data.length !== bb.data.length) {
      maxDiff = 255;
    } else {
      for (let i = 0; i < a.data.length; i += 4) {
        let d = 0;
        for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(a.data[i + k] - bb.data[i + k]));
        if (d > 0) diffPixels++;
        if (d > maxDiff) maxDiff = d;
      }
    }

    out.push({
      id: frame.id,
      size: [a.width, a.height],
      maxDiff,
      diffPixels,
      bytesEqual: blobA.size === blobB.size,
    });
  }

  URL.revokeObjectURL(url);

  return {
    frames: out,
    // Hai đường phải cho cùng kích thước ảnh sau khi thu nhỏ
    naturalFile: viaFile.natural,
    naturalUrl: viaUrl.natural,
    thumbFile: viaFile.thumbUrl.slice(0, 5),
    thumbUrl: viaUrl.thumbUrl.slice(0, 5),
    hasFileField: !!viaFile.file,
    remoteHasNoFile: viaUrl.file === undefined,
  };
});

await browser.close();
await server.close();

const fails = [];
console.log('\nNạp từ File so với nạp từ URL:\n');
console.log('khung          kích thước    pixel lệch   lệch tối đa');
console.log('─'.repeat(58));
for (const f of results.frames) {
  console.log(
    `${f.id.padEnd(14)} ${(f.size[0] + 'x' + f.size[1]).padEnd(13)} ` +
      `${String(f.diffPixels).padEnd(12)} ${f.maxDiff}`,
  );
  if (f.maxDiff !== 0) fails.push(`${f.id}: lệch ${f.maxDiff}`);
  if (f.diffPixels !== 0) fails.push(`${f.id}: ${f.diffPixels} pixel khác nhau`);
}

console.log('');
if (results.naturalFile.w !== results.naturalUrl.w ||
    results.naturalFile.h !== results.naturalUrl.h) {
  fails.push(`kích thước khác nhau: ${JSON.stringify(results.naturalFile)} vs ${JSON.stringify(results.naturalUrl)}`);
}
if (results.thumbFile !== 'blob:') fails.push('ảnh từ máy phải dùng blob URL');
if (results.thumbUrl !== 'blob:' && !results.thumbUrl.startsWith('http')) {
  fails.push('ảnh từ URL phải giữ nguyên URL làm thumb');
}
if (!results.hasFileField) fails.push('ảnh từ máy phải giữ trường file');
if (!results.remoteHasNoFile) fails.push('ảnh từ server không nên có trường file');
if (errors.length) fails.push(`lỗi console: ${errors.join('; ')}`);

if (fails.length) {
  console.error('FAIL:\n' + fails.map((f) => ' - ' + f).join('\n') + '\n');
  process.exit(1);
}
console.log('OK — ảnh nạp từ server cho kết quả TRÙNG KHÍT ảnh nạp từ máy.\n');
