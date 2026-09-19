import { randomUUID } from 'node:crypto';

import { getDb, now } from './db.ts';

/**
 * Gói giá nhân viên tự đặt.
 *
 * Chỉ tên và giá, KHÔNG gắn số kiểu ảnh — cùng một số ảnh vẫn bán được nhiều
 * mức giá khác nhau, và ngược lại. Nhân viên chọn số ảnh và giá riêng rẽ.
 *
 * Để trong database chứ không trong mã nguồn: quán đổi bảng giá là chuyện
 * thường, không đáng phải build lại app.
 */

export type PriceRow = {
  id: string;
  label: string;
  amount: number;
  enabled: number;
  sort_order: number;
  created_at: number;
};

export type PriceInfo = {
  id: string;
  label: string;
  amount: number;
  enabled: boolean;
};

export class PriceError extends Error {}

/** Trần giá: 100 triệu. Cao hơn gần như chắc chắn là gõ nhầm số 0. */
const MAX_AMOUNT = 100_000_000;

/**
 * Ép số tiền về số nguyên dương hợp lệ.
 *
 * Số nguyên đồng, không phải số thực: tiền Việt không có hào, và số thực thì
 * cộng dồn một ngày sẽ lệch những đồng lẻ không ai giải thích nổi.
 */
export function sanitizeAmount(input: unknown): number {
  const v = Math.round(Number(input));
  if (!Number.isFinite(v) || v < 0) throw new PriceError('Giá không hợp lệ');
  if (v > MAX_AMOUNT) throw new PriceError('Giá quá lớn, kiểm tra lại số 0');
  return v;
}

const toInfo = (r: PriceRow): PriceInfo => ({
  id: r.id,
  label: r.label,
  amount: r.amount,
  enabled: r.enabled === 1,
});

export function listPrices(opts: { onlyEnabled?: boolean } = {}): PriceInfo[] {
  const rows = getDb().prepare(
    opts.onlyEnabled
      ? 'SELECT * FROM price_options WHERE enabled = 1 ORDER BY sort_order, created_at'
      : 'SELECT * FROM price_options ORDER BY sort_order, created_at',
  ).all() as PriceRow[];
  return rows.map(toInfo);
}

export function getPrice(id: string): PriceInfo | null {
  const r = getDb().prepare('SELECT * FROM price_options WHERE id = ?')
    .get(id) as PriceRow | undefined;
  return r ? toInfo(r) : null;
}

export function createPrice(label: string, amount: unknown): PriceInfo {
  const name = label.trim();
  if (!name) throw new PriceError('Chưa đặt tên gói');

  const db = getDb();
  const id = randomUUID();
  const maxOrder = (db.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) AS m FROM price_options',
  ).get() as { m: number }).m;

  db.prepare(`
    INSERT INTO price_options (id, label, amount, enabled, sort_order, created_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(id, name, sanitizeAmount(amount), maxOrder + 1, now());

  return getPrice(id)!;
}

export function updatePrice(
  id: string,
  patch: { label?: string; amount?: unknown; enabled?: boolean },
): PriceInfo | null {
  const db = getDb();
  if (!getPrice(id)) return null;

  if (patch.label !== undefined) {
    const name = patch.label.trim();
    if (!name) throw new PriceError('Chưa đặt tên gói');
    db.prepare('UPDATE price_options SET label = ? WHERE id = ?').run(name, id);
  }
  if (patch.amount !== undefined) {
    db.prepare('UPDATE price_options SET amount = ? WHERE id = ?')
      .run(sanitizeAmount(patch.amount), id);
  }
  if (patch.enabled !== undefined) {
    db.prepare('UPDATE price_options SET enabled = ? WHERE id = ?')
      .run(patch.enabled ? 1 : 0, id);
  }
  return getPrice(id);
}

/**
 * Xoá hẳn một gói.
 *
 * An toàn với doanh thu đã ghi: phiên lưu SỐ TIỀN chốt lúc tạo mã, không phải
 * khoá ngoại tới bảng này. Xoá gói không làm đổi thống kê của những ngày trước.
 */
export function deletePrice(id: string): boolean {
  const res = getDb().prepare('DELETE FROM price_options WHERE id = ?').run(id);
  return res.changes > 0;
}
