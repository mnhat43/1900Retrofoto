import { describe, it, expect } from 'vitest';
import { coNoi, xepLuoi, LE, MIN_SIZE, BUOC_VIEN, type Rect } from './slots';

/** Ô có nằm trọn trong ảnh không. */
const trongAnh = (s: Rect) =>
  s.x >= -1e-9 && s.y >= -1e-9
  && s.x + s.w <= 1 + 1e-9 && s.y + s.h <= 1 + 1e-9;

/** Hai ô có đè lên nhau không. */
const deNhau = (a: Rect, b: Rect) =>
  a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9
  && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;

describe('xepLuoi', () => {
  /*
   * Dải dọc 2x6 phải ra MỘT cột dù bấm mấy ô. Xếp 3 ô thành 2 cột trên một
   * dải dọc là ra thứ không giống bất kỳ khung photobooth nào, nhân viên lại
   * phải kéo lại từ đầu.
   */
  it('dải dọc luôn xếp một cột', () => {
    for (const n of [2, 3, 4, 6, 9]) {
      const o = xepLuoi(n, 2 / 6);
      expect(o.length).toBe(n);
      const cotX = new Set(o.map((s) => s.x.toFixed(4)));
      expect(cotX.size).toBe(1);
    }
  });

  it('khung 4×6 xếp 6 ô thành 2 cột', () => {
    const o = xepLuoi(6, 4 / 6);
    expect(new Set(o.map((s) => s.x.toFixed(4))).size).toBe(2);
    expect(new Set(o.map((s) => s.y.toFixed(4))).size).toBe(3);
  });

  it('khung vuông xếp 9 ô thành 3 cột', () => {
    const o = xepLuoi(9, 1);
    expect(new Set(o.map((s) => s.x.toFixed(4))).size).toBe(3);
    expect(new Set(o.map((s) => s.y.toFixed(4))).size).toBe(3);
  });

  it('mọi ô nằm trong ảnh và chừa đúng lề', () => {
    for (const [n, tl] of [[3, 2 / 6], [6, 4 / 6], [9, 1]] as const) {
      const o = xepLuoi(n, tl);
      expect(o.every(trongAnh)).toBe(true);
      expect(Math.min(...o.map((s) => s.x))).toBeCloseTo(LE, 6);
      expect(Math.min(...o.map((s) => s.y))).toBeCloseTo(LE, 6);
    }
  });

  it('các ô không đè lên nhau', () => {
    const o = xepLuoi(9, 1);
    for (let i = 0; i < o.length; i++) {
      for (let j = i + 1; j < o.length; j++) {
        expect(deNhau(o[i], o[j])).toBe(false);
      }
    }
  });
});

describe('coNoi', () => {
  const giua: Rect = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };

  it('co lại thì mỗi mép lùi vào đúng một nhịp', () => {
    const [s] = coNoi([giua], -BUOC_VIEN);
    expect(s.x).toBeCloseTo(0.11, 6);
    expect(s.y).toBeCloseTo(0.11, 6);
    expect(s.w).toBeCloseTo(0.48, 6);
    expect(s.h).toBeCloseTo(0.48, 6);
  });

  it('nới ra thì mỗi mép giãn đúng một nhịp', () => {
    const [s] = coNoi([giua], BUOC_VIEN);
    expect(s.x).toBeCloseTo(0.09, 6);
    expect(s.w).toBeCloseTo(0.52, 6);
  });

  /*
   * Phép thử quan trọng nhất: nới một ô đang sát mép KHÔNG được đẩy nó tràn
   * ra ngoài ảnh. Toạ độ tràn ra ngoài thì khâu khoét lỗ ở server cắt cụt
   * theo mép ảnh, và ô nhân viên thấy trên màn không còn khớp lỗ thật.
   */
  it('nới ô sát mép vẫn nằm trong ảnh', () => {
    const sat: Rect[] = [
      { x: 0, y: 0, w: 0.3, h: 0.3 },
      { x: 0.7, y: 0.7, w: 0.3, h: 0.3 },
      { x: 0, y: 0, w: 1, h: 1 },
    ];
    const ra = coNoi(sat, BUOC_VIEN * 5);
    expect(ra.every(trongAnh)).toBe(true);
  });

  it('co quá tay thì giữ nguyên ô, không để ô teo mất', () => {
    const nho: Rect = { x: 0.4, y: 0.4, w: MIN_SIZE, h: MIN_SIZE };
    const [s] = coNoi([nho], -BUOC_VIEN);
    expect(s).toEqual(nho);
  });

  it('giữ đúng số ô và không đụng tới ô nào khác', () => {
    const nhieu = xepLuoi(6, 4 / 6);
    const ra = coNoi(nhieu, -BUOC_VIEN);
    expect(ra.length).toBe(nhieu.length);
    // Co đều thì các ô vẫn không đè nhau
    for (let i = 0; i < ra.length; i++) {
      for (let j = i + 1; j < ra.length; j++) {
        expect(deNhau(ra[i], ra[j])).toBe(false);
      }
    }
  });

  it('co rồi nới lại một nhịp thì về đúng chỗ cũ', () => {
    const [s] = coNoi(coNoi([giua], -BUOC_VIEN), BUOC_VIEN);
    expect(s.x).toBeCloseTo(giua.x, 6);
    expect(s.w).toBeCloseTo(giua.w, 6);
  });
});
