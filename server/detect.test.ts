import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

import { detectSlots } from './detect.ts';
import { FRAMES } from '../src/frames/index.ts';

/**
 * Dựng một khung giả: nền đặc, khoét các lỗ trong suốt theo toạ độ cho trước.
 * Toạ độ vào/ra đều chuẩn hoá nên so sánh được trực tiếp.
 */
async function frameWithHoles(
  w: number,
  h: number,
  holes: Array<{ x: number; y: number; w: number; h: number }>,
): Promise<Buffer> {
  const px = Buffer.alloc(w * h * 4, 0);
  // Nền đặc màu trắng
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = 255; px[i * 4 + 1] = 255; px[i * 4 + 2] = 255; px[i * 4 + 3] = 255;
  }
  for (const r of holes) {
    const x0 = Math.round(r.x * w), y0 = Math.round(r.y * h);
    const x1 = Math.round((r.x + r.w) * w), y1 = Math.round((r.y + r.h) * h);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) px[(y * w + x) * 4 + 3] = 0;
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

describe('detectSlots', () => {
  it('dò đúng số ô và toạ độ của mọi khung dựng sẵn', async () => {
    for (const f of FRAMES) {
      const png = readFileSync(`public/frames/${f.id}.png`);
      const r = await detectSlots(png);

      expect(r.slots.length, `${f.id}: số ô`).toBe(f.slots.length);

      r.slots.forEach((s, i) => {
        const e = f.slots[i].rect;
        // 0.5% là sai số làm tròn pixel, không phải lệch thật
        expect(Math.abs(s.x - e.x), `${f.id} ô ${i + 1}: x`).toBeLessThan(0.005);
        expect(Math.abs(s.y - e.y), `${f.id} ô ${i + 1}: y`).toBeLessThan(0.005);
        expect(Math.abs(s.w - e.w), `${f.id} ô ${i + 1}: w`).toBeLessThan(0.005);
        expect(Math.abs(s.h - e.h), `${f.id} ô ${i + 1}: h`).toBeLessThan(0.005);
      });
    }
  });

  it('trả ô theo thứ tự đọc: trên xuống dưới, trái sang phải', async () => {
    // Cố tình khoét theo thứ tự lộn xộn
    const png = await frameWithHoles(400, 400, [
      { x: 0.55, y: 0.55, w: 0.35, h: 0.35 },   // dưới-phải
      { x: 0.1, y: 0.55, w: 0.35, h: 0.35 },    // dưới-trái
      { x: 0.55, y: 0.1, w: 0.35, h: 0.35 },    // trên-phải
      { x: 0.1, y: 0.1, w: 0.35, h: 0.35 },     // trên-trái
    ]);
    const r = await detectSlots(png);
    expect(r.slots.length).toBe(4);

    const pos = r.slots.map((s) => `${s.x < 0.5 ? 'T' : 'P'}${s.y < 0.5 ? 'tr' : 'd'}`);
    expect(pos).toEqual(['Ttr', 'Ptr', 'Td', 'Pd']);
  });

  it('bỏ qua lỗ li ti do khử răng cưa', async () => {
    const png = await frameWithHoles(400, 400, [
      { x: 0.1, y: 0.1, w: 0.8, h: 0.6 },        // ô thật
      { x: 0.02, y: 0.95, w: 0.01, h: 0.01 },    // hạt bụi
      { x: 0.5, y: 0.96, w: 0.008, h: 0.008 },   // hạt bụi
    ]);
    const r = await detectSlots(png);
    expect(r.slots.length).toBe(1);
    expect(r.slots[0].w).toBeGreaterThan(0.7);
  });

  it('BỎ vùng trong suốt bao quanh mép ảnh', async () => {
    /*
     * Khung thật hay có nền ngoài trong suốt (thẻ bo góc tròn, hoặc ảnh xuất
     * rộng hơn khung). Vùng đó nối liền quanh cả tấm nên từng bị gom thành
     * MỘT "ô" phủ kín 100% — khung 3 lỗ báo thành 4 ô.
     */
    const w = 400, h = 600;
    const px = Buffer.alloc(w * h * 4, 0);
    const m = 10;                              // viền ngoài trong suốt
    for (let y = m; y < h - m; y++) {
      for (let x = m; x < w - m; x++) {
        const i = (y * w + x) * 4;
        px[i] = 250; px[i + 1] = 160; px[i + 2] = 190; px[i + 3] = 255;
      }
    }
    for (const [hx, hy, hw, hh] of [[40, 50, 320, 140], [40, 230, 320, 140], [40, 410, 320, 140]]) {
      for (let y = hy; y < hy + hh; y++) {
        for (let x = hx; x < hx + hw; x++) px[(y * w + x) * 4 + 3] = 0;
      }
    }
    const png = await sharp(px, { raw: { width: w, height: h, channels: 4 } })
      .png().toBuffer();

    const r = await detectSlots(png);
    expect(r.slots.length).toBe(3);
    // Không ô nào được phủ gần kín cả tấm
    expect(r.slots.every((s) => s.w < 0.95 && s.h < 0.95)).toBe(true);
  });

  it('BỎ nền ngoài của thẻ BO GÓC TRÒN, không chạm đúng pixel mép', async () => {
    /*
     * Thẻ bo góc tròn: vùng nền ngoài trong suốt dừng lại cách mép vài pixel
     * ở giữa các cạnh. Bản vá đầu tiên đòi chạm ĐÚNG pixel mép nên vẫn để lọt,
     * hiện thành một ô thừa bao trọn khung.
     */
    const w = 400, h = 533, m = 6, R = 18;
    const px = Buffer.alloc(w * h * 4, 0);
    const inCard = (x: number, y: number) => {
      if (x < m || x >= w - m || y < m || y >= h - m) return false;
      const l = m + R, r = w - m - R, t = m + R, b = h - m - R;
      if (x < l && y < t) return (x - l) ** 2 + (y - t) ** 2 <= R * R;
      if (x > r && y < t) return (x - r) ** 2 + (y - t) ** 2 <= R * R;
      if (x < l && y > b) return (x - l) ** 2 + (y - b) ** 2 <= R * R;
      if (x > r && y > b) return (x - r) ** 2 + (y - b) ** 2 <= R * R;
      return true;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (inCard(x, y)) {
          const i = (y * w + x) * 4;
          px[i] = 250; px[i + 1] = 160; px[i + 2] = 190; px[i + 3] = 255;
        }
      }
    }
    for (const [hx, hy, hw, hh] of [[30, 40, 340, 130], [30, 190, 340, 130], [30, 340, 340, 130]]) {
      for (let y = hy; y < hy + hh; y++) {
        for (let x = hx; x < hx + hw; x++) px[(y * w + x) * 4 + 3] = 0;
      }
    }
    const png = await sharp(px, { raw: { width: w, height: h, channels: 4 } })
      .png().toBuffer();

    const r = await detectSlots(png);
    expect(r.slots.length).toBe(3);
    expect(r.slots.every((s) => s.w < 0.95 && s.h < 0.95)).toBe(true);
  });

  it('báo lỗi rõ ràng khi PNG không có nền trong suốt', async () => {
    const solid = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).png().toBuffer();

    await expect(detectSlots(solid)).rejects.toThrow(/trong suốt/);
  });

  it('không tràn ngăn xếp với vùng trong suốt rất lớn', async () => {
    /*
     * Một lỗ rất lớn -> vùng hàng triệu pixel; cài đặt đệ quy sẽ chết ở đây.
     * Chừa lề 8% để lỗ không chạm mép — chạm mép thì bị coi là nền ngoài,
     * và phép kiểm này nói về tràn ngăn xếp chứ không phải về mép.
     */
    const png = await frameWithHoles(1200, 1800, [
      { x: 0.08, y: 0.08, w: 0.84, h: 0.84 },
    ]);
    const r = await detectSlots(png);
    expect(r.slots.length).toBe(1);
    expect(r.slots[0].w).toBeGreaterThan(0.8);
  });
});
