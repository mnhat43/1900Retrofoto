import { statfsSync, mkdirSync } from 'node:fs';
import { resolve, parse, sep } from 'node:path';
import { CONFIG } from './config.ts';
import { getDb } from './db.ts';

/**
 * Dung lượng ổ đĩa chứa ảnh khách.
 *
 * Vì sao cần: ảnh gốc máy DSLR cỡ 10-25MB một tấm, quán đông thì vài chục GB
 * một tuần. Ổ đầy thì SQLite không ghi được và ảnh khách mất luôn — mà không
 * có gì báo trước. Trang nhân viên hiện số này để thấy TRƯỚC khi vỡ.
 */

export type DiskInfo = {
  /** Ổ chứa thư mục ảnh, ví dụ "D:" */
  drive: string;
  dataDir: string;
  totalBytes: number;
  freeBytes: number;
  /** Phần ảnh khách đang chiếm, tính từ database (không phải quét ổ đĩa). */
  usedByPhotosBytes: number;
  /** 'ok' | 'warn' | 'critical' — trang nhân viên đổi màu theo cái này. */
  level: 'ok' | 'warn' | 'critical';
  /** Đọc được ổ đĩa hay không. Sai thì các số trên là 0. */
  ok: boolean;
};

/**
 * Ngưỡng cảnh báo, tính theo GB còn trống.
 *
 * Chọn theo dung lượng thật: một buổi đông ~5-10GB, nên dưới 20GB là phải dọn
 * trong tuần, dưới 5GB là có thể vỡ ngay trong ngày.
 */
const WARN_GB = Number(process.env.PHOTOBOOTH_DISK_WARN_GB ?? 20);
const CRIT_GB = Number(process.env.PHOTOBOOTH_DISK_CRIT_GB ?? 5);

const GB = 1024 ** 3;

/**
 * Tổng bytes ảnh gốc + ảnh ghép của các phiên CHƯA bị xoá ảnh.
 *
 * Cộng từ database chứ không quét ổ đĩa: quét cả cây thư mục ảnh mỗi lần
 * trang nhân viên đọc lại là quá đắt, mà con số này chỉ dùng để nhân viên
 * biết khi nào cần dọn.
 *
 * Vì vậy nó THẤP HƠN dung lượng thật một chút — bản preview 1400px và file
 * khung ảnh nằm trên ổ nhưng không có dòng nào trong database. Chênh lệch
 * cỡ vài phần trăm (preview ~300KB so với ảnh gốc 10-25MB), và lệch theo
 * hướng an toàn: dọn xong luôn được nhiều hơn con số đã hứa.
 */
function bytesInUse(): number {
  try {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT
           (SELECT COALESCE(SUM(p.bytes), 0) FROM photos p
              JOIN sessions s ON s.id = p.session_id
             WHERE s.purged_at IS NULL) AS photos,
           (SELECT COALESCE(SUM(c.bytes), 0) FROM composites c
              JOIN sessions s ON s.id = c.session_id
             WHERE s.purged_at IS NULL) AS composites`,
      )
      .get() as { photos: number; composites: number } | undefined;
    return Number(row?.photos ?? 0) + Number(row?.composites ?? 0);
  } catch {
    return 0;
  }
}

export function diskInfo(): DiskInfo {
  const dataDir = resolve(CONFIG.dataDir);
  // parse().root cho ra "D:\" — bỏ dấu gạch cuối để hiện gọn là "D:".
  // Dùng `sep` thay vì viết thẳng dấu gạch chéo ngược cho khỏi rối escape.
  const root = parse(dataDir).root;
  const drive = root.endsWith(sep) ? root.slice(0, -1) : root;

  const base: DiskInfo = {
    drive,
    dataDir,
    totalBytes: 0,
    freeBytes: 0,
    usedByPhotosBytes: bytesInUse(),
    level: 'ok',
    ok: false,
  };

  try {
    // statfs cần đường dẫn tồn tại. Thư mục ảnh có thể chưa được tạo nếu
    // chưa có phiên nào -> tạo trước, rẻ và không phá gì.
    mkdirSync(dataDir, { recursive: true });
    const st = statfsSync(dataDir);
    const total = Number(st.blocks) * Number(st.bsize);
    // bavail = block người dùng thường ghi được, không phải bfree (gồm cả
    // phần dự trữ cho hệ thống) -> sát với thực tế hơn.
    const free = Number(st.bavail) * Number(st.bsize);
    const freeGb = free / GB;
    return {
      ...base,
      totalBytes: total,
      freeBytes: free,
      level: freeGb <= CRIT_GB ? 'critical' : freeGb <= WARN_GB ? 'warn' : 'ok',
      ok: true,
    };
  } catch {
    // Ổ rời bị rút, ký tự ổ đổi, hoặc mất quyền đọc. Không được ném lỗi ra
    // ngoài — trang nhân viên vẫn phải mở được để còn tạo mã cho khách.
    return base;
  }
}
