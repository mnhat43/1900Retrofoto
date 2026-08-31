import { randomBytes } from 'node:crypto';
import { getDb, now } from './db.ts';
import { saveFile } from './storage.ts';
import { generateSlug } from './session.ts';
import type { Session } from './session.ts';

export type Composite = {
  id: string;
  session_id: string;
  frame_id: string;
  filename: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  recipe: string;
  share_slug: string;
  created_at: number;
};

/**
 * Lưu ảnh đã ghép khung.
 *
 * Ảnh được render TRÊN ĐIỆN THOẠI khách rồi gửi lên — không render ở server.
 * Đảm bảo "preview khớp export" có được là vì cả hai đường đều gọi drawStrip;
 * render lại ở server sẽ là bản cài đặt thứ hai của cùng phép toán.
 *
 * `recipe` lưu toàn bộ trạng thái editor ở toạ độ chuẩn hoá. Vì placement.ts
 * bất biến theo scale, từ recipe dựng lại được đúng y hệt ảnh này ở bất kỳ
 * kích thước nào — kể cả khi file PNG mất.
 */
export async function saveComposite(
  session: Session,
  opts: {
    frameId: string;
    data: Buffer;
    width: number;
    height: number;
    recipe: unknown;
    ext?: 'png' | 'jpg';
  },
): Promise<Composite> {
  const db = getDb();
  const seq =
    ((db
      .prepare('SELECT COUNT(*) AS n FROM composites WHERE session_id = ?')
      .get(session.id) as { n: number }).n) + 1;

  const ext = opts.ext ?? 'png';
  const filename = `strip-${seq}.${ext}`;
  await saveFile(session.dir, 'strips', filename, opts.data);

  const composite: Composite = {
    id: randomBytes(12).toString('hex'),
    session_id: session.id,
    frame_id: opts.frameId,
    filename,
    width: opts.width,
    height: opts.height,
    bytes: opts.data.length,
    recipe: JSON.stringify(opts.recipe),
    share_slug: generateSlug(),
    created_at: now(),
  };

  db.prepare(
    `INSERT INTO composites
       (id, session_id, frame_id, filename, width, height, bytes, recipe, share_slug, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    composite.id, composite.session_id, composite.frame_id, composite.filename,
    composite.width, composite.height, composite.bytes, composite.recipe,
    composite.share_slug, composite.created_at,
  );

  db.prepare(`UPDATE sessions SET status = 'composed' WHERE id = ?`).run(session.id);
  return composite;
}

export function listComposites(sessionId: string): Composite[] {
  return getDb()
    .prepare('SELECT * FROM composites WHERE session_id = ? ORDER BY created_at')
    .all(sessionId) as Composite[];
}

/** Tra theo slug — dùng cho link "sao chép liên kết" gửi nhân viên. */
export function getBySlug(
  slug: string,
): { composite: Composite; session: Session } | null {
  const db = getDb();
  const composite = db
    .prepare('SELECT * FROM composites WHERE share_slug = ?')
    .get(slug) as Composite | undefined;
  if (!composite) return null;

  const session = db
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .get(composite.session_id) as Session | undefined;
  if (!session || session.purged_at || session.expires_at < now()) return null;

  return { composite, session };
}
