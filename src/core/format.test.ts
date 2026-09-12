import { describe, it, expect } from 'vitest';
import { framePx, DPI, SERVER_DPI } from './format';

describe('framePx với DPI tuỳ chọn', () => {
  it('mặc định vẫn là 300 DPI — trình duyệt không đổi', () => {
    expect(framePx({ formatId: 'strip' })).toEqual({ w: 600, h: 1800 });
  });

  it('server dựng ở 600 DPI, gấp đôi mỗi chiều', () => {
    expect(framePx({ formatId: 'strip' }, SERVER_DPI)).toEqual({ w: 2400, h: 7200 });
  });

  it('khung tự khai kích thước cũng theo đúng DPI truyền vào', () => {
    const frame = { formatId: 'custom', widthInch: 4, heightInch: 6 };
    expect(framePx(frame)).toEqual({ w: 1200, h: 1800 });
    expect(framePx(frame, SERVER_DPI)).toEqual({ w: 4800, h: 7200 });
  });

  /*
   * Trần canvas iOS Safari ~16.7M điểm ảnh. Đây là lý do KHÔNG nâng DPI dùng
   * chung: khách iPhone ghép ảnh ngay trên máy mình, vượt trần là trắng tay.
   */
  it('mọi khổ dựng sẵn ở DPI trình duyệt đều dưới trần canvas iOS', () => {
    const IOS_LIMIT = 16_777_216;
    for (const id of ['strip', 'card', 'square']) {
      const p = framePx({ formatId: id });
      expect(p.w * p.h).toBeLessThanOrEqual(IOS_LIMIT);
    }
  });

  it('DPI trình duyệt giữ nguyên 300, không bị nâng nhầm', () => {
    expect(DPI).toBe(300);
  });
});

/*
 * Khổ lớn ở 1200 DPI vượt xa ngưỡng RAM: 12x12in là 207M điểm ảnh, tốn ~791MB
 * chỉ riêng canvas. render.ts hạ DPI cho vừa — test này chốt con số để nếu ai
 * nâng SERVER_DPI lên nữa thì thấy ngay hậu quả.
 */
describe('ngưỡng RAM khi dựng ở SERVER_DPI', () => {
  const MAX_PIXELS = 18_000_000;

  it('khổ dải 2x6 vừa khít ngưỡng, không bị hạ', () => {
    const p = framePx({ formatId: 'strip' }, SERVER_DPI);
    expect(p.w * p.h).toBeLessThanOrEqual(MAX_PIXELS);
  });

  it('khổ 12x12 vượt ngưỡng — phải được hạ, không dựng thẳng', () => {
    const p = framePx({ formatId: 'x', widthInch: 12, heightInch: 12 }, SERVER_DPI);
    expect(p.w * p.h).toBeGreaterThan(MAX_PIXELS);
  });
});
