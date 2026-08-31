import { describe, it, expect } from 'vitest';
import { applyColor, isIdentity } from './color';
import { DEFAULT_COLOR } from '../core/types';
import type { ColorState } from '../core/types';

/** ImageData giả — applyColor chỉ đọc .data, .width, .height. */
function makeImage(w = 24, h = 24): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    // Dải màu có cả vùng sáng, vùng tối và tông da
    data[i * 4] = (i * 7) % 256;
    data[i * 4 + 1] = (i * 13) % 256;
    data[i * 4 + 2] = (i * 3) % 256;
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h } as ImageData;
}

const run = (c: Partial<ColorState>) => {
  const img = makeImage();
  applyColor(img, { ...DEFAULT_COLOR, ...c });
  return img.data;
};

const SLIDERS: Array<keyof ColorState> = [
  'brightness', 'contrast', 'saturation',
  'exposure', 'highlights', 'shadows', 'white', 'black',
  'temperature', 'tint', 'vibrance', 'clarity', 'smoothSkin',
];

describe('applyColor', () => {
  it('MỌI thanh đều làm ảnh đổi thật', () => {
    const base = run({});
    for (const key of SLIDERS) {
      const out = run({ [key]: 0.5 } as Partial<ColorState>);
      let diff = 0;
      for (let i = 0; i < out.length; i++) {
        diff = Math.max(diff, Math.abs(out[i] - base[i]));
      }
      // Thiếu một thanh trong applyColor thì nó sẽ im lặng không có tác dụng
      expect(diff, `thanh "${key}" không đổi gì`).toBeGreaterThan(0);
    }
  });

  it('cho cùng kết quả ở mọi lần chạy', () => {
    const cfg = {
      exposure: 0.3, highlights: -0.4, shadows: 0.35, temperature: 0.25,
      vibrance: 0.4, clarity: 0.5, smoothSkin: 0.6,
    };
    expect(run(cfg)).toEqual(run(cfg));
  });

  it('không có thanh nào bật thì KHÔNG đổi pixel', () => {
    const base = makeImage();
    const copy = new Uint8ClampedArray(base.data);
    applyColor(base, DEFAULT_COLOR);
    expect(base.data).toEqual(copy);
  });

  it('kết quả luôn nằm trong 0..255', () => {
    const out = run({
      exposure: 1, brightness: 1, contrast: 1, white: 1,
      saturation: 1, vibrance: 1, clarity: 1,
    });
    for (let i = 0; i < out.length; i += 4) {
      for (let ch = 0; ch < 3; ch++) {
        expect(out[i + ch]).toBeGreaterThanOrEqual(0);
        expect(out[i + ch]).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('isIdentity', () => {
  it('đúng khi mọi thanh bằng 0', () => {
    expect(isIdentity(DEFAULT_COLOR)).toBe(true);
  });

  it('sai khi BẤT KỲ thanh nào khác 0', () => {
    for (const key of SLIDERS) {
      expect(
        isIdentity({ ...DEFAULT_COLOR, [key]: 0.3 }),
        `isIdentity bỏ sót thanh "${key}" -> thanh đó sẽ bị bỏ qua im lặng`,
      ).toBe(false);
    }
  });
});
