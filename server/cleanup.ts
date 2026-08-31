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

  let purged = 0;
  for (const s of due) {
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

  if (purged > 0) {
    console.log(`[dọn dẹp] đã xoá ảnh của ${purged} phiên quá ${CONFIG.retentionDays} ngày`);
  }
  return { purged };
}
