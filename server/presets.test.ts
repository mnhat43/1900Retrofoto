import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pb-cp-'));
process.env.PHOTOBOOTH_DATA = dir;

const { getDb, closeDb } = await import('./db.ts');
const {
  listPresets, getPreset, createPreset, updatePreset, deletePreset,
  sanitize, PresetError,
} = await import('./presets.ts');

beforeEach(() => { getDb().exec('DELETE FROM color_presets;'); });
afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe('sanitize', () => {
  it('giữ mọi thanh hợp lệ', () => {
    const p = sanitize({
      exposure: 0.5, highlights: -0.3, temperature: 0.2, smoothSkin: 0.8,
    });
    expect(p.exposure).toBe(0.5);
    expect(p.highlights).toBe(-0.3);
    expect(p.smoothSkin).toBe(0.8);
  });

  it('kẹp về -1..1 — không tin số gửi lên', () => {
    const p = sanitize({ exposure: 99, contrast: -50 });
    expect(p.exposure).toBe(1);
    expect(p.contrast).toBe(-1);
  });

  it('bỏ khoá lạ và giá trị không phải số', () => {
    const p = sanitize({ hack: 1, exposure: 'abc' }) as Record<string, unknown>;
    expect(p.hack).toBeUndefined();
    expect(p.exposure).toBeUndefined();
  });

  it('luôn đặt presetId là none — bộ đã lưu là thông số THUẦN', () => {
    expect(sanitize({ presetId: 'bw', exposure: 0.2 }).presetId).toBe('none');
  });
});

describe('createPreset', () => {
  it('lưu và đọc lại đúng thông số', () => {
    const p = createPreset('Tone quán', { exposure: 0.4, temperature: 0.25 });
    expect(p.label).toBe('Tone quán');
    expect(p.enabled).toBe(true);
    expect(getPreset(p.id)?.params.exposure).toBe(0.4);
  });

  it('từ chối tên rỗng', () => {
    expect(() => createPreset('   ', {})).toThrow(PresetError);
  });
});

describe('bật/tắt và xoá', () => {
  it('tắt thì khách không thấy, nhân viên vẫn thấy', () => {
    const a = createPreset('A', { exposure: 0.1 });
    createPreset('B', { contrast: 0.1 });
    expect(listPresets({ onlyEnabled: true }).length).toBe(2);

    updatePreset(a.id, { enabled: false });
    expect(listPresets({ onlyEnabled: true }).length).toBe(1);
    expect(listPresets().length).toBe(2);
  });

  it('sửa thông số ghi đè bộ cũ', () => {
    const p = createPreset('A', { exposure: 0.1 });
    expect(updatePreset(p.id, { params: { exposure: 0.9 } })?.params.exposure).toBe(0.9);
  });

  it('xoá được, và trả false nếu không có', () => {
    const p = createPreset('A', { exposure: 0.1 });
    expect(deletePreset(p.id)).toBe(true);
    expect(getPreset(p.id)).toBeNull();
    expect(deletePreset('khong-co')).toBe(false);
  });
});
