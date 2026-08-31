import { randomUUID } from 'node:crypto';

import { getDb, now } from './db.ts';
import type { ColorState } from '../src/core/types.ts';

/**
 * Bộ chỉnh màu do nhân viên lưu.
 *
 * Chỉnh một lần cho ưng ý rồi lưu lại, những ảnh sau chọn đúng bộ đó là ra
 * cùng một tone — không phải kéo lại từng thanh.
 *
 * Lưu trong database chứ không trong mã nguồn, nên thêm/sửa/xoá ngay trên
 * giao diện, không cần build lại app và không mất khi cập nhật mã.
 */

export type PresetRow = {
  id: string;
  label: string;
  params: string;
  enabled: number;
  sort_order: number;
  created_at: number;
};

export type PresetInfo = {
  id: string;
  label: string;
  params: ColorState;
  enabled: boolean;
};

export class PresetError extends Error {}

/** Chỉ giữ các khoá hợp lệ và ép về -1..1, không tin dữ liệu gửi lên. */
const KEYS = [
  'brightness', 'contrast', 'saturation',
  'exposure', 'highlights', 'shadows', 'white', 'black',
  'temperature', 'tint', 'vibrance', 'clarity', 'smoothSkin',
] as const;

export function sanitize(input: unknown): ColorState {
  const o = (input ?? {}) as Record<string, unknown>;
  const out: ColorState = {
    // presetId luôn là 'none': bộ đã lưu là thông số THUẦN, không chồng lên
    // một bộ lọc khác — chồng hai lớp thì kết quả phụ thuộc thứ tự áp.
    presetId: 'none',
    brightness: 0, contrast: 0, saturation: 0,
  };
  for (const k of KEYS) {
    const v = Number(o[k]);
    if (Number.isFinite(v) && v !== 0) {
      (out as Record<string, number>)[k] = Math.max(-1, Math.min(1, v));
    }
  }
  return out;
}

const toInfo = (r: PresetRow): PresetInfo => ({
  id: r.id,
  label: r.label,
  params: JSON.parse(r.params) as ColorState,
  enabled: r.enabled === 1,
});

export function listPresets(opts: { onlyEnabled?: boolean } = {}): PresetInfo[] {
  const rows = getDb().prepare(
    opts.onlyEnabled
      ? 'SELECT * FROM color_presets WHERE enabled = 1 ORDER BY sort_order, created_at'
      : 'SELECT * FROM color_presets ORDER BY sort_order, created_at',
  ).all() as PresetRow[];
  return rows.map(toInfo);
}

export function getPreset(id: string): PresetInfo | null {
  const r = getDb().prepare('SELECT * FROM color_presets WHERE id = ?')
    .get(id) as PresetRow | undefined;
  return r ? toInfo(r) : null;
}

export function createPreset(label: string, params: unknown): PresetInfo {
  const name = label.trim();
  if (!name) throw new PresetError('Chưa đặt tên bộ chỉnh');

  const db = getDb();
  const id = randomUUID();
  const maxOrder = (db.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) AS m FROM color_presets',
  ).get() as { m: number }).m;

  db.prepare(`
    INSERT INTO color_presets (id, label, params, enabled, sort_order, created_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(id, name, JSON.stringify(sanitize(params)), maxOrder + 1, now());

  return getPreset(id)!;
}

export function updatePreset(
  id: string,
  patch: { label?: string; params?: unknown; enabled?: boolean },
): PresetInfo | null {
  const db = getDb();
  if (!getPreset(id)) return null;

  if (patch.label !== undefined) {
    const name = patch.label.trim();
    if (!name) throw new PresetError('Chưa đặt tên bộ chỉnh');
    db.prepare('UPDATE color_presets SET label = ? WHERE id = ?').run(name, id);
  }
  if (patch.params !== undefined) {
    db.prepare('UPDATE color_presets SET params = ? WHERE id = ?')
      .run(JSON.stringify(sanitize(patch.params)), id);
  }
  if (patch.enabled !== undefined) {
    db.prepare('UPDATE color_presets SET enabled = ? WHERE id = ?')
      .run(patch.enabled ? 1 : 0, id);
  }
  return getPreset(id);
}

export function deletePreset(id: string): boolean {
  const r = getDb().prepare('DELETE FROM color_presets WHERE id = ?').run(id);
  return r.changes > 0;
}
