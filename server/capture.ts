import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { getDb, now } from './db.ts';
import { CONFIG } from './config.ts';
import { saveFile } from './storage.ts';
import type { Session } from './session.ts';

export type Photo = {
  id: string;
  session_id: string;
  seq: number;
  filename: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  source: string;
  /** Tên file gốc trong thư mục chụp — dùng để không nạp trùng khi quét lại. */
  sourceName: string | null;
  created_at: number;
};

/**
 * Chỉ trả về ảnh đã ghi xong (source != 'pending').
 * Dòng 'pending' là chỗ đã giữ nhưng ảnh còn đang xử lý — chưa có file thật
 * nên không được hiện ra cho khách.
 */
export function listPhotos(sessionId: string): Photo[] {
  // Đổi tên cột source_name -> sourceName ngay trong truy vấn, để mã TypeScript
  // dùng một kiểu duy nhất mà không phải map thủ công ở từng chỗ.
  return getDb()
    .prepare(
      `SELECT *, source_name AS sourceName FROM photos
        WHERE session_id = ? AND source != 'pending'
        ORDER BY seq`,
    )
    .all(sessionId) as Photo[];
}

export function countPhotos(sessionId: string): number {
  const r = getDb()
    .prepare('SELECT COUNT(*) AS n FROM photos WHERE session_id = ?')
    .get(sessionId) as { n: number };
  return r.n;
}

export function getPhoto(sessionId: string, photoId: string): Photo | null {
  return (getDb()
    .prepare('SELECT * FROM photos WHERE id = ? AND session_id = ?')
    .get(photoId, sessionId) as Photo | undefined) ?? null;
}

export class CaptureError extends Error {
  // Không dùng parameter property — Node strip-types không hỗ trợ (sinh code runtime)
  code: 'full' | 'closed' | 'bad_image' | 'duplicate';
  constructor(message: string, code: 'full' | 'closed' | 'bad_image' | 'duplicate') {
    super(message);
    this.code = code;
  }
}

/**
 * Nhận một ảnh vào phiên.
 *
 * Đây là HỢP ĐỒNG dùng chung cho cả upload thủ công (giai đoạn này) và app PC
 * điều khiển Canon (sau này) — hai bên gọi cùng hàm này, chỉ khác `source`.
 * Khi app Canon xong, server không phải sửa gì.
 *
 * Ghi 2 bản: ảnh gốc vào originals/ và bản thu nhỏ 1400px vào previews/.
 * Điện thoại tải bản preview — tiết kiệm ~90% băng thông WiFi mà không giảm
 * chất lượng, vì ô trong dải chỉ rộng ~500px @300DPI.
 */
/**
 * Giữ chỗ một số thứ tự (seq) cho ảnh sắp tới — làm NGAY, trước mọi việc chậm.
 *
 * Máy ảnh chụp liên tiếp có thể gửi nhiều ảnh cùng lúc. Nếu đọc số ảnh hiện có
 * rồi mới xử lý ảnh (sharp mất vài trăm ms) thì hai request song song đều thấy
 * cùng một con số, tính ra cùng một seq, và một ảnh sẽ bị mất khi ghi database.
 *
 * INSERT ở đây là thao tác đồng bộ duy nhất, không có await xen giữa, nên
 * SQLite tuần tự hoá được. Bên nào thua ràng buộc UNIQUE sẽ thử seq kế tiếp.
 */
function reserveSeq(sessionId: string, maxPhotos: number): { id: string; seq: number } {
  const db = getDb();
  for (let attempt = 0; attempt < maxPhotos + 5; attempt++) {
    const used = countPhotos(sessionId);
    if (used >= maxPhotos) {
      throw new CaptureError('Đã chụp hết số ảnh của gói', 'full');
    }
    const id = randomBytes(12).toString('hex');
    const seq = used + 1;
    try {
      db.prepare(
        `INSERT INTO photos (id, session_id, seq, filename, source, created_at)
         VALUES (?, ?, ?, '', 'pending', ?)`,
      ).run(id, sessionId, seq, now());
      return { id, seq };
    } catch (err) {
      // Request khác vừa lấy mất seq này -> đọc lại và thử số kế tiếp
      if (!String(err).includes('UNIQUE')) throw err;
    }
  }
  throw new CaptureError('Không giữ được chỗ cho ảnh', 'full');
}

export async function addPhoto(
  session: Session,
  data: Buffer,
  source: 'manual' | 'agent' = 'manual',
  sourceName?: string,
): Promise<{ photo: Photo; count: number; remaining: number }> {
  if (session.status !== 'active' && session.status !== 'shooting') {
    throw new CaptureError('Phiên không ở trạng thái chụp', 'closed');
  }

  /*
   * Cùng một file gửi lại thì bỏ qua, không thêm bản sao.
   *
   * fs.watch bắn NHIỀU sự kiện cho một file (tạo, ghi, đóng) và agent còn
   * có vòng quét định kỳ, nên cùng một ảnh dễ tới đây mấy lần. Trước đây
   * chỉ intakeFromFolder lọc trùng, còn đường /api/capture thì không —
   * khách thấy mỗi kiểu lặp ba lần.
   */
  if (sourceName) {
    const dup = listPhotos(session.id).some((p) => p.sourceName === sourceName);
    if (dup) throw new CaptureError('Ảnh này đã nạp rồi', 'duplicate');
  }

  // Giữ chỗ TRƯỚC khi xử lý ảnh — xem chú thích ở reserveSeq.
  const { id, seq } = reserveSeq(session.id, session.max_photos);
  const db = getDb();

  let meta: sharp.Metadata;
  let previewBuf: Buffer;
  try {
    const img = sharp(data, { failOn: 'none' }).rotate(); // rotate() theo EXIF
    meta = await img.metadata();
    if (!meta.width || !meta.height) throw new Error('thiếu kích thước');

    previewBuf = await img
      .resize({
        width: CONFIG.previewMaxEdge,
        height: CONFIG.previewMaxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 88 })
      .toBuffer();
  } catch {
    // Trả lại chỗ đã giữ, nếu không sẽ chiếm mất một lượt của gói
    db.prepare('DELETE FROM photos WHERE id = ?').run(id);
    throw new CaptureError('File không phải ảnh hợp lệ', 'bad_image');
  }

  const base = String(seq).padStart(2, '0');
  // Ảnh gốc giữ nguyên định dạng; bản preview luôn là jpg.
  const ext = meta.format === 'png' ? 'png' : 'jpg';
  const filename = `${base}.${ext}`;

  try {
    await saveFile(session.dir, 'originals', filename, data);
    await saveFile(session.dir, 'previews', `${base}.jpg`, previewBuf);
  } catch (err) {
    db.prepare('DELETE FROM photos WHERE id = ?').run(id);
    throw err;
  }

  const photo: Photo = {
    id,
    session_id: session.id,
    seq,
    filename,
    // Kích thước SAU khi xoay theo EXIF — phải khớp thứ trình duyệt thấy,
    // nếu không khung hình trong ô sẽ lệch.
    width: meta.autoOrient?.width ?? meta.width,
    height: meta.autoOrient?.height ?? meta.height,
    bytes: data.length,
    source,
    sourceName: sourceName ?? null,
    created_at: now(),
  };

  db.prepare(
    `UPDATE photos
        SET filename = ?, width = ?, height = ?, bytes = ?, source = ?, source_name = ?
      WHERE id = ?`,
  ).run(
    photo.filename, photo.width, photo.height, photo.bytes,
    photo.source, photo.sourceName, id,
  );

  // Ảnh đầu tiên -> chuyển sang 'shooting'
  if (session.status === 'active') {
    db.prepare(`UPDATE sessions SET status = 'shooting' WHERE id = ?`).run(session.id);
  }

  const count = countPhotos(session.id);
  return { photo, count, remaining: session.max_photos - count };
}

/** Tên file preview tương ứng của một ảnh. */
export const previewName = (photo: Photo) =>
  `${String(photo.seq).padStart(2, '0')}.jpg`;
