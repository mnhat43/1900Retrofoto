import { getDb, now } from './db.ts';
import { removeSessionDir } from './storage.ts';
import { CONFIG } from './config.ts';
import type { Session } from './session.ts';

/**
 * Xoá ảnh của các phiên quá hạn giữ (mặc định 7 ngày).
 *
 * Xoá thư mục ảnh nhưng GIỮ lại dòng trong database (đánh dấu purged_at) —
 * để nhân viên vẫn tra được "phiên này đã từng tồn tại, ảnh đã bị xoá theo
 * chính sách", thay vì biến mất không dấu vết.
 */
export function runCleanup(): { purged: number } {
  const db = getDb();
  const t = now();

  const due = db
    .prepare(
      `SELECT * FROM sessions
        WHERE expires_at < ? AND purged_at IS NULL`,
    )
    .all(t) as Session[];

  const purged = purgeAll(due);
  if (purged > 0) {
    console.log(`[dọn dẹp] đã xoá ảnh của ${purged} phiên quá ${CONFIG.retentionDays} ngày`);
  }
  return { purged };
}

// ---------------------------------------------------------------------------
// Dọn dẹp theo giai đoạn — nhân viên tự bấm khi ổ đĩa gần đầy
// ---------------------------------------------------------------------------

/**
 * Các mốc tuổi ảnh nhân viên chọn được, từ nhẹ tay đến mạnh tay.
 *
 * Vì sao có mốc nhỏ hơn hạn giữ tự động (7 ngày): khi ổ sắp đầy giữa buổi
 * bán hàng, chờ hết 7 ngày là quá muộn. Nhân viên cần hạ xuống 3 ngày ngay,
 * và biết trước sẽ giải phóng được bao nhiêu GB.
 */
export const CLEANUP_TIERS = [30, 14, 7, 3] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Phiên đang chiếm phòng thì KHÔNG được xoá, dù tính theo tuổi đã đủ điều
 * kiện — khách có thể vẫn đang chụp trong buồng. Chỉ xoá phiên đã kết thúc.
 */
const PURGEABLE = `status NOT IN ('created', 'active', 'shooting')`;

export type CleanupTier = {
  days: number;
  sessions: number;
  bytes: number;
};

/** Xem trước: mỗi mốc sẽ xoá bao nhiêu phiên và giải phóng bao nhiêu bytes. */
export function cleanupTiers(): CleanupTier[] {
  const db = getDb();
  const t = now();

  return CLEANUP_TIERS.map((days) => {
    const cutoff = t - days * DAY_MS;
    // Dùng CTE để điều kiện chọn phiên viết ĐÚNG MỘT LẦN và chỉ có MỘT tham
    // số. Bản trước lặp lại điều kiện ba lần với ba dấu `?` phải nhận cùng
    // giá trị — chỉ cần sửa sai thứ tự một chỗ là con số hiện cho nhân viên
    // lệch đi mà không có gì báo.
    const row = db
      .prepare(
        `WITH due AS (
           SELECT id FROM sessions
            WHERE purged_at IS NULL AND created_at < ? AND ${PURGEABLE}
         )
         SELECT
           (SELECT COUNT(*) FROM due) AS sessions,
           COALESCE((SELECT SUM(bytes) FROM photos
                      WHERE session_id IN (SELECT id FROM due)), 0) AS photoBytes,
           COALESCE((SELECT SUM(bytes) FROM composites
                      WHERE session_id IN (SELECT id FROM due)), 0) AS compositeBytes`,
      )
      .get(cutoff) as
      | { sessions: number; photoBytes: number; compositeBytes: number }
      | undefined;

    return {
      days,
      sessions: Number(row?.sessions ?? 0),
      bytes: Number(row?.photoBytes ?? 0) + Number(row?.compositeBytes ?? 0),
    };
  });
}

/** Xoá ảnh của mọi phiên cũ hơn `days` ngày. Trả về số phiên đã xoá. */
export function purgeOlderThan(days: number): { purged: number } {
  const db = getDb();
  const cutoff = now() - days * DAY_MS;

  const due = db
    .prepare(
      `SELECT * FROM sessions
        WHERE purged_at IS NULL AND created_at < ? AND ${PURGEABLE}`,
    )
    .all(cutoff) as Session[];

  const purged = purgeAll(due);
  if (purged > 0) {
    console.log(`[dọn dẹp tay] đã xoá ảnh của ${purged} phiên cũ hơn ${days} ngày`);
  }
  return { purged };
}

/**
 * Xoá thư mục của từng phiên, lỗi một phiên không làm dừng cả lượt.
 *
 * Thư mục có thể đang bị Explorer hoặc phần mềm quét virus giữ file — bỏ qua
 * phiên đó và xoá tiếp, lần dọn sau sẽ gặp lại.
 */
function purgeAll(list: Session[]): number {
  const db = getDb();
  const t = now();
  let purged = 0;

  for (const s of list) {
    try {
      removeSessionDir(s.dir);
      db.prepare(
        `UPDATE sessions SET purged_at = ?, status = 'expired' WHERE id = ?`,
      ).run(t, s.id);
      purged++;
    } catch (err) {
      console.error(`Không xoá được thư mục phiên ${s.code}:`, err);
    }
  }
  return purged;
}
