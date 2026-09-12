import { describe, it, expect } from 'vitest';
import { framePx, DPI, SERVER_DPI } from './format';

describe('framePx với DPI tuỳ chọn', () => {
  it('mặc định vẫn là 300 DPI — trình duyệt không đổi', () => {
    expect(framePx({ formatId: 'strip' })).toEqual({ w: 600, h: 1800 });
  });

  it('server dựng ở 600 DPI, gấp đôi mỗi chiều', () => {
    expect(framePx({ formatId: 'strip' }, SERVER_DPI)).toEqual({ w: 1200, h: 3600 });
  });

  it('khung tự khai kích thước cũng theo đúng DPI truyền vào', () => {
    const frame = { formatId: 'custom', widthInch: 4, heightInch: 6 };
    expect(framePx(frame)).toEqual({ w: 1200, h: 1800 });
    expect(framePx(frame, SERVER_DPI)).toEqual({ w: 2400, h: 3600 });
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
