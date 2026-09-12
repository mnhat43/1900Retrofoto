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
 * Vì sao cần: nếu chỉ dò thư mục, ta phải ĐOÁN ảnh thuộc khách nào dựa
 * trên thời điểm file xuất hiện — LumaBooth xử lý qua nhiều bước nên ảnh
 * có thể về trễ và chảy nhầm sang khách kế tiếp. Trigger cho biết CHÍNH
 * XÁC lượt chụp bắt đầu và kết thúc lúc nào.
 *
 * Các sự kiện LumaBooth gửi (theo tài liệu chính thức):
 *   session_start    [booth_mode]
 *   countdown_start  [seconds]
 *   countdown        [percent_complete]
 *   capture_start
 *   file_download    [tên file từ máy ảnh]
 *   processing_start [tên các ảnh gốc] [file cuối]
 *   sharing_screen
 *   printing         [file] [số bản] [máy in]
 *   file_upload      [file] [url] [loại] [album]
 *   session_end
 *
 * Ta chỉ quan tâm mốc mở/đóng lượt chụp; ảnh vẫn do agent mang về.
 */

/** Một lượt chụp LumaBooth đang mở ở phòng nào, từ lúc nào. */
export type Shot = {
  /** Thời điểm session_start — ảnh cũ hơn mốc này không thuộc lượt này. */
  startedAt: number;
  /** booth_mode LumaBooth báo (PrintAndGIF, Video...). Chỉ để ghi log. */
  mode: string;
  /** Tên file LumaBooth đã báo trong lượt này, để đối chiếu với agent. */
  files: Set<string>;
};

/** Dấu gạch ngược Windows — viết kiểu này để khỏi vướng escape. */
const BS = String.fromCharCode(92);

const shots = new Map<string, Shot>();

/** Lượt chụp LumaBooth đang mở ở phòng này, nếu có. */
export const shotForRoom = (room: string): Shot | null => shots.get(room) ?? null;

/**
 * Mốc thời gian sớm nhất mà ảnh của phòng này được coi là hợp lệ.
 *
 * Không có lượt nào đang mở -> null, agent cứ gửi như cũ. Có lượt đang mở
 * -> ảnh chụp TRƯỚC lúc lượt bắt đầu là của khách trước, phải bỏ.
 */
export const shotFloor = (room: string): number | null =>
  shots.get(room)?.startedAt ?? null;

export type TriggerResult = { event: string; room: string; note: string };

/** Xử lý một sự kiện. Trả về mô tả ngắn để ghi log. */
export function handleTrigger(
  room: string,
  event: string,
  params: Record<string, string>,
): TriggerResult {
  const p1 = params.param1 ?? '';
  const note = (s: string) => ({ event, room, note: s });

  switch (event) {
    case 'session_start':
      shots.set(room, { startedAt: Date.now(), mode: p1, files: new Set() });
      return note(`mở lượt chụp (${p1 || 'không rõ chế độ'})`);

    case 'file_download': {
      // LumaBooth vừa kéo xong một ảnh từ máy ảnh — ghi tên để đối chiếu.
      const s = shots.get(room);
      if (s && p1) s.files.add(p1);
      return note(p1 ? `máy ảnh trả về ${p1}` : 'máy ảnh trả về ảnh');
    }

    case 'processing_start': {
      /*
       * Tài liệu nói param1 = danh sách ảnh, param2 = file cuối. THỰC TẾ
       * LumaBooth 8 gửi MỖI ảnh một param: param1..paramN là ảnh gốc, param
       * cuối cùng là đường dẫn đầy đủ của file đã ghép. Nhận diện bằng dấu
       * phân cách đường dẫn — tên ảnh gốc không có.
       */
      const s = shots.get(room);
      if (s) {
        for (const v of Object.values(params)) {
          if (!v || v.includes(BS) || v.includes('/')) continue;
          s.files.add(v.trim());
        }
      }
      return note(`chốt ${s?.files.size ?? 0} ảnh của lượt`);
    }

    case 'session_end':
      shots.delete(room);
      return note('đóng lượt chụp');

    // countdown/capture_start/sharing_screen/printing/file_upload: không cần xử lý
    default:
      return note('bỏ qua');
  }
}

/** Xoá trạng thái của một phòng — dùng khi nhân viên đóng phiên. */
export const clearShot = (room: string): void => void shots.delete(room);

/**
 * Mở một cổng HTTP riêng cho mỗi phòng để nhận trigger LumaBooth.
 *
 * Phải làm vậy vì LumaBooth vứt đường dẫn và tham số, chỉ giữ host:cổng —
 * nên cổng là thứ DUY NHẤT nói lên sự kiện đến từ phòng nào.
 *
 * Cổng mặc định 8100 + số phòng (8101, 8102, 8103). Đổi được bằng
 * PHOTOBOOTH_TRIGGER_BASE nếu cổng đó đã có người dùng.
 *
 * Lỗi mở cổng chỉ ghi log rồi bỏ qua: trigger là phần tăng độ chính xác,
 * mất nó thì agent vẫn chạy như cũ — không đáng để server không lên.
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
