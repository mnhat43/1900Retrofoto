import { createServer } from 'node:http';

/**
 * Nhận sự kiện từ LumaBooth (dslrBooth).
 *
 * LumaBooth gọi một URL mỗi khi có việc xảy ra trong lượt chụp, kèm
 * event_type và param1..paramN dưới dạng tham số GET.
 *
 * CHÚ Ý — quan sát từ LumaBooth 8 thật: nó chỉ lấy HOST và CỔNG từ URL ta
 * khai, vứt hết đường dẫn lẫn tham số rồi tự ghép `/?event_type=...`.
 * Khai `http://máy-chủ:8090/api/trigger?room=1` thì nó gọi
 * `http://máy-chủ:8090/?event_type=...` — không mang theo room, và rơi
 * vào trang chủ chứ không tới route nào.
 *
 * Nên mỗi phòng phải có một CỔNG riêng, đó là thứ duy nhất phân biệt được:
 *
 *   phòng 1 -> http://<máy chủ>:8101
 *   phòng 2 -> http://<máy chủ>:8102
 *   phòng 3 -> http://<máy chủ>:8103
 *
 * Vì sao còn cần: phòng chỉ có MỘT màn hình và LumaBooth chiếm trọn, khách
 * không có chỗ gõ mã 4 số. Khi LumaBooth báo bắt đầu lượt chụp
 * (session_start), server tự nhận hộ mã đang chờ của phòng đó.
 *
 * Hệ thống KHÔNG lấy ảnh từ máy chụp nữa (quán tự đưa file cho khách), nên
 * các sự kiện khác chỉ được ghi log.
 */

export type TriggerResult = { event: string; room: string; note: string };

/** Mô tả ngắn một sự kiện để ghi log. Việc nhận mã do nơi gọi làm. */
export function handleTrigger(
  room: string,
  event: string,
  params: Record<string, string>,
): TriggerResult {
  const p1 = params.param1 ?? '';
  const note = (s: string) => ({ event, room, note: s });
  switch (event) {
    case 'session_start':
      return note(`mở lượt chụp (${p1 || 'không rõ chế độ'})`);
    case 'session_end':
      return note('đóng lượt chụp');
    default:
      return note('bỏ qua');
  }
}

/**
 * Mở một cổng HTTP riêng cho mỗi phòng để nhận trigger LumaBooth.
 *
 * Phải làm vậy vì LumaBooth vứt đường dẫn và tham số, chỉ giữ host:cổng —
 * nên cổng là thứ DUY NHẤT nói lên sự kiện đến từ phòng nào.
 *
 * Cổng mặc định 8100 + số phòng (8101, 8102, 8103). Đổi được bằng
 * PHOTOBOOTH_TRIGGER_BASE nếu cổng đó đã có người dùng.
 *
 * Lỗi mở cổng chỉ ghi log rồi bỏ qua: mất trigger thì khách vẫn nhập mã
 * trên màn hình phòng được — không đáng để server không lên.
 */
export function listenTriggerPorts(
  rooms: string[],
  onEvent: (room: string, event: string, params: Record<string, string>) => void,
  log: (msg: string) => void,
): Array<{ close: () => void }> {
  const base = Number(process.env.PHOTOBOOTH_TRIGGER_BASE ?? 8100);
  const out: Array<{ close: () => void }> = [];

  for (const room of rooms) {
    const port = base + Number(room);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      log(`trigger phòng ${room}: số phòng không ra cổng hợp lệ, bỏ qua`);
      continue;
    }

    const srv = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const event = url.searchParams.get('event_type') ?? '';
      const params: Record<string, string> = {};
      for (const [k, v] of url.searchParams) {
        if (k.startsWith('param') && v) params[k] = v;
      }
      if (event) onEvent(room, event, params);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });

    // BẮT BUỘC có listener 'error', nếu không cổng bận sẽ giết cả tiến trình
    srv.on('error', (err) => {
      log(`trigger phòng ${room}: không mở được cổng ${port} — ${(err as Error).message}`);
    });
    srv.listen(port, () => log(`trigger phòng ${room}: nghe cổng ${port}`));
    out.push({ close: () => srv.close() });
  }

  return out;
}
