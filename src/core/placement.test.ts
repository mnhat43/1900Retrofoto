import { describe, it, expect } from 'vitest';
import {
  coverScale,
  resolveImagePlacement,
  clampContent,
  slotRectPx,
  MIN_ZOOM,
} from './placement';
import type { SlotContent } from './types';

const content = (over: Partial<SlotContent> = {}): SlotContent => ({
  photoId: 'p1',
  zoom: 1,
  offset: { x: 0, y: 0 },
  ...over,
});

describe('coverScale', () => {
  it('phủ kín ô theo chiều hẹp hơn', () => {
    // ảnh ngang 200x100 vào ô vuông 100x100 -> phải scale theo chiều cao
    expect(coverScale({ w: 200, h: 100 }, { w: 100, h: 100 })).toBe(1);
    // ảnh dọc 100x200 vào ô vuông -> cũng scale 1, tràn chiều cao
    expect(coverScale({ w: 100, h: 200 }, { w: 100, h: 100 })).toBe(1);
  });

  it('luôn phủ kín cả hai chiều', () => {
    const img = { w: 4000, h: 3000 };
    const slot = { w: 500, h: 700 };
    const s = coverScale(img, slot);
    expect(img.w * s).toBeGreaterThanOrEqual(slot.w - 1e-9);
    expect(img.h * s).toBeGreaterThanOrEqual(slot.h - 1e-9);
  });
});

describe('resolveImagePlacement — bất biến theo scale', () => {
  // Đây là test quan trọng nhất của toàn bộ app.
  // Nếu test này hỏng, preview sẽ không còn khớp file xuất ra.
  const cases: Array<[string, SlotContent, { w: number; h: number }]> = [
    ['cover-fit căn giữa', content(), { w: 4000, h: 3000 }],
    ['phóng to lệch tâm', content({ zoom: 2.5, offset: { x: 0.7, y: -0.3 } }), { w: 4000, h: 3000 }],
    ['ảnh dọc, đẩy sát mép', content({ zoom: 1.8, offset: { x: -1, y: 1 } }), { w: 3000, h: 4000 }],
    ['ảnh vuông', content({ zoom: 3 }), { w: 2000, h: 2000 }],
  ];

  // preview ~300px -> export 1800px là hệ số 6
  const K = 6;

  it.each(cases)('%s: nhân slot với k thì kết quả nhân đúng k', (_label, c, img) => {
    const small = { x: 10, y: 20, w: 80, h: 100 };
    const large = { x: small.x * K, y: small.y * K, w: small.w * K, h: small.h * K };

    const a = resolveImagePlacement(c, img, small);
    const b = resolveImagePlacement(c, img, large);

    expect(b.x).toBeCloseTo(a.x * K, 9);
    expect(b.y).toBeCloseTo(a.y * K, 9);
    expect(b.w).toBeCloseTo(a.w * K, 9);
    expect(b.h).toBeCloseTo(a.h * K, 9);
  });

  it('khớp ở đúng tỉ lệ preview->300DPI thực tế', () => {
    // dải preview 300px rộng vs dải export 600px rộng (2x6 inch @300DPI)
    const img = { w: 4032, h: 3024 };
    const norm = { x: 0.08, y: 0.06, w: 0.84, h: 0.2 };
    const c = content({ zoom: 1.4, offset: { x: 0.25, y: -0.6 } });

    const prev = resolveImagePlacement(c, img, slotRectPx(norm, 300, 900));
    const exp = resolveImagePlacement(c, img, slotRectPx(norm, 600, 1800));

    const k = 2;
    expect(exp.x).toBeCloseTo(prev.x * k, 9);
    expect(exp.y).toBeCloseTo(prev.y * k, 9);
    expect(exp.w).toBeCloseTo(prev.w * k, 9);
    expect(exp.h).toBeCloseTo(prev.h * k, 9);
  });
});

describe('resolveImagePlacement — không bao giờ hở nền', () => {
  const slot = { x: 50, y: 60, w: 200, h: 300 };
  const imgs = [
    { w: 4000, h: 3000 }, // ngang
    { w: 3000, h: 4000 }, // dọc
    { w: 2000, h: 2000 }, // vuông
    { w: 6000, h: 1000 }, // panorama
  ];
  const offsets = [-1, -0.5, 0, 0.5, 1];
  const zooms = [1, 1.001, 2, 5, 8];

  it('ảnh luôn phủ kín ô ở mọi tổ hợp zoom/offset hợp lệ', () => {
    for (const img of imgs) {
      for (const z of zooms) {
        for (const ox of offsets) {
          for (const oy of offsets) {
            const c = clampContent(content({ zoom: z, offset: { x: ox, y: oy } }));
            const r = resolveImagePlacement(c, img, slot);
            const eps = 1e-9;
            expect(r.x).toBeLessThanOrEqual(slot.x + eps);
            expect(r.y).toBeLessThanOrEqual(slot.y + eps);
            expect(r.x + r.w).toBeGreaterThanOrEqual(slot.x + slot.w - eps);
            expect(r.y + r.h).toBeGreaterThanOrEqual(slot.y + slot.h - eps);
          }
        }
      }
    }
  });
});

describe('clampContent', () => {
  it('chặn zoom dưới 1 để không hở nền', () => {
    expect(clampContent(content({ zoom: 0.2 })).zoom).toBe(MIN_ZOOM);
  });

  it('giới hạn offset trong [-1, 1]', () => {
    const c = clampContent(content({ offset: { x: 5, y: -9 } }));
    expect(c.offset).toEqual({ x: 1, y: -1 });
  });
});

describe('slotRectPx', () => {
  it('đổi chuẩn hoá sang pixel theo kích thước dải', () => {
    expect(slotRectPx({ x: 0.5, y: 0.25, w: 0.25, h: 0.5 }, 600, 1800)).toEqual({
      x: 300,
      y: 450,
      w: 150,
      h: 900,
    });
  });
});
