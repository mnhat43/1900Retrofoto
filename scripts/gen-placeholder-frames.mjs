/**
 * Sinh khung PNG tạm để chạy thử khi chưa có thiết kế thật.
 * Khung thật do bạn thiết kế sẽ thay thế các file này (cùng tên).
 *
 *   node scripts/gen-placeholder-frames.mjs
 *
 * Bố cục và khổ giấy đọc từ LAYOUTS trong src/frames/index.ts, nên khung tạm
 * LUÔN khớp với toạ độ ô mà app dùng.
 *
 * Viết PNG thủ công (không phụ thuộc thư viện) — chỉ cần zlib có sẵn của Node.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DPI = 300;
const OUT = join(process.cwd(), 'public', 'frames');

// Giữ đồng bộ với src/core/format.ts
const FORMATS = {
  strip: { widthInch: 2, heightInch: 6 },
  sheet46: { widthInch: 4, heightInch: 6 },
  square66: { widthInch: 6, heightInch: 6 },
};

// Giữ đồng bộ với LAYOUTS trong src/frames/index.ts
const LAYOUTS = {
  3: {
    formatId: 'strip',
    grid: { cols: 1, rows: 3, padX: 0.06, padTop: 0.04, padBottom: 0.14, gapY: 0.02 },
  },
  4: {
    formatId: 'strip',
    grid: { cols: 1, rows: 4, padX: 0.06, padTop: 0.035, padBottom: 0.13, gapY: 0.018 },
  },
  6: {
    formatId: 'sheet46',
    grid: {
      cols: 2, rows: 3, padX: 0.04, padTop: 0.035, padBottom: 0.11,
      gapX: 0.035, gapY: 0.02,
    },
  },
  9: {
    formatId: 'square66',
    grid: {
      cols: 3, rows: 3, padX: 0.035, padTop: 0.035, padBottom: 0.1,
      gapX: 0.028, gapY: 0.028,
    },
  },
};

function gridSlots(o) {
  const gapX = o.gapX ?? o.gapY;
  const usableW = 1 - o.padX * 2 - gapX * (o.cols - 1);
  const usableH = 1 - o.padTop - o.padBottom - o.gapY * (o.rows - 1);
  const w = usableW / o.cols;
  const h = usableH / o.rows;
  const slots = [];
  for (let r = 0; r < o.rows; r++) {
    for (let c = 0; c < o.cols; c++) {
      slots.push({
        x: o.padX + c * (w + gapX),
        y: o.padTop + r * (h + o.gapY),
        w,
        h,
      });
    }
  }
  return slots;
}

const crcTable = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function writePng(path, rgba, W, H) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // Mỗi hàng có 1 byte filter đứng đầu.
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    rgba.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }
  writeFileSync(
    path,
    Buffer.concat([
      sig,
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/** Vẽ nền đặc rồi khoét lỗ trong suốt tại các ô. */
function build(slots, bg, W, H) {
  const buf = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    buf[i * 4] = bg[0];
    buf[i * 4 + 1] = bg[1];
    buf[i * 4 + 2] = bg[2];
    buf[i * 4 + 3] = 255;
  }
  for (const s of slots) {
    const x0 = Math.round(s.x * W);
    const y0 = Math.round(s.y * H);
    const x1 = Math.round((s.x + s.w) * W);
    const y1 = Math.round((s.y + s.h) * H);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        buf[(y * W + x) * 4 + 3] = 0; // trong suốt -> lộ ảnh bên dưới
      }
    }
  }
  return buf;
}

const FRAMES = [
  { id: 'basic-3', slots: 3, bg: [255, 255, 255] },
  { id: 'basic-4', slots: 4, bg: [255, 255, 255] },
  { id: 'film-4', slots: 4, bg: [17, 17, 17] },
  { id: 'basic-6', slots: 6, bg: [255, 255, 255] },
  { id: 'film-6', slots: 6, bg: [17, 17, 17] },
  { id: 'basic-9', slots: 9, bg: [255, 255, 255] },
];

mkdirSync(OUT, { recursive: true });
for (const f of FRAMES) {
  const layout = LAYOUTS[f.slots];
  const fmt = FORMATS[layout.formatId];
  const W = Math.round(fmt.widthInch * DPI);
  const H = Math.round(fmt.heightInch * DPI);
  const slots = gridSlots(layout.grid);
  writePng(join(OUT, `${f.id}.png`), build(slots, f.bg, W, H), W, H);
  console.log(`wrote ${f.id}.png  ${W}x${H}  (${f.slots} ô, ${layout.grid.cols}x${layout.grid.rows})`);
}
