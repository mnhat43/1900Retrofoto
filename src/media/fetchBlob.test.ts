import { describe, expect, it, vi } from 'vitest';
import { fetchBlob, LOAD_FAILED } from './assets';

const noSleep = () => Promise.resolve();
const ok = (body = 'jpg') => new Response(new Blob([body]), { status: 200 });

/** Response có body đứt giữa chừng — giống Safari mất WiFi lúc đang tải ảnh. */
function brokenBody(): Response {
  const res = new Response('x', { status: 200 });
  vi.spyOn(res, 'blob').mockRejectedValue(new TypeError('Type error'));
  return res;
}

describe('fetchBlob', () => {
  it('trả về blob ngay lần đầu khi mạng ổn', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok('abc'));
    const blob = await fetchBlob('/a', { fetchImpl, sleep: noSleep });
    expect(await blob.text()).toBe('abc');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('thử lại khi fetch ném lỗi mạng', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValue(ok());
    await expect(fetchBlob('/a', { fetchImpl, sleep: noSleep })).resolves.toBeInstanceOf(Blob);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('thử lại khi đọc body bị đứt giữa chừng', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(brokenBody())
      .mockResolvedValue(ok());
    await expect(fetchBlob('/a', { fetchImpl, sleep: noSleep })).resolves.toBeInstanceOf(Blob);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('thử lại khi server lỗi 5xx', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValue(ok());
    await expect(fetchBlob('/a', { fetchImpl, sleep: noSleep })).resolves.toBeInstanceOf(Blob);
  });

  it('hết lượt thử thì báo lời nhắn dễ hiểu, không lộ "Type error"', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Type error'));
    await expect(
      fetchBlob('/a', { fetchImpl, sleep: noSleep, delays: [1, 1] }),
    ).rejects.toThrow(LOAD_FAILED);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('không thử lại khi 4xx — ảnh không có thì thử mấy lần cũng vậy', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    await expect(fetchBlob('/a', { fetchImpl, sleep: noSleep })).rejects.toThrow('(404)');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
