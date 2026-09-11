import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { rmSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const dir = mkdtempSync(join(tmpdir(), 'pb-frames-'));
process.env.PHOTOBOOTH_DATA = dir;

const { getDb, closeDb } = await import('./db.ts');
const {
  seedBuiltins, listFrames, getFrame, createFrame, updateFrame, deleteFrame,
  readFrameImage, guessFormat, guessSize, framesDir, FrameError,
} = await import('./frames.ts');

const png6 = readFileSync('public/frames/basic-6.png');
const png3 = readFileSync('public/frames/basic-3.png');

beforeEach(() => {
  getDb().exec('DELETE FROM frames;');
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('guessFormat', () => {
  it('nhận đúng khổ từ tỉ lệ ảnh', () => {
    expect(guessFormat(600, 1800)).toBe('strip');      // 2x6
    expect(guessFormat(1200, 1800)).toBe('sheet46');   // 4x6
    expect(guessFormat(1800, 1800)).toBe('square66');  // 6x6
  });

  it('chọn khổ gần nhất khi tỉ lệ lệch vài pixel', () => {
    // File thiết kế thật hay lệch chút — không được từ chối
    expect(guessFormat(1204, 1797)).toBe('sheet46');
    expect(guessFormat(598, 1803)).toBe('strip');
  });
});

describe('guessSize', () => {
  it('khớp khổ dựng sẵn thì lấy đúng khổ đó', () => {
    expect(guessSize(600, 1800)).toEqual({ widthInch: 2, heightInch: 6 });
    expect(guessSize(1200, 1800)).toEqual({ widthInch: 4, heightInch: 6 });
  });

  it('tỉ lệ lạ thì GIỮ NGUYÊN tỉ lệ, không ép vào khổ gần nhất', () => {
    // 5x7 = 0.714, không trùng khổ nào -> giữ tỉ lệ, cạnh dài về 6in
    const s = guessSize(1000, 1400);
    expect(s.heightInch).toBe(6);
    expect(s.widthInch / s.heightInch).toBeCloseTo(1000 / 1400, 2);
  });
});

describe('kích thước in tuỳ ý', () => {
  it('lưu và trả lại đúng số inch nhân viên khai', async () => {
    const f = await createFrame({
      label: '5x7', png: png6, widthInch: 5, heightInch: 7,
    });
    expect(f.widthInch).toBe(5);
    expect(f.heightInch).toBe(7);
  });

  it('từ chối kích thước vượt trần canvas của iPhone', async () => {
    await expect(createFrame({ label: 'To quá', png: png6, widthInch: 40, heightInch: 40 }))
      .rejects.toThrow(FrameError);
    await expect(createFrame({ label: 'Bé quá', png: png6, widthInch: 0.1, heightInch: 6 }))
      .rejects.toThrow(FrameError);
  });

  it('sửa được kích thước sau khi đã lưu', async () => {
    const f = await createFrame({ label: 'A', png: png6 });
    const u = updateFrame(f.id, { widthInch: 3, heightInch: 4 });
    expect(u?.widthInch).toBe(3);
    expect(u?.heightInch).toBe(4);
  });
});

describe('tải lên định dạng khác PNG', () => {
  /*
   * File lưu ra luôn mang tên .png và mọi nơi phục vụ nó đều khai
   * 'content-type: image/png'. Ghi thẳng buffer WebP vào đó thì thành file
   * đội lốt: trình duyệt cũ và khâu in từ chối, mà triệu chứng chỉ là "khung
   * không hiện". Nên phải chuyển đổi thật khi lưu.
   */
  it('chuyển WebP sang PNG thật khi lưu, giữ nguyên vùng trong suốt', async () => {
    const webp = await sharp(png3).webp({ lossless: true }).toBuffer();
    const f = await createFrame({ label: 'Tu WebP', png: webp });

    const saved = readFrameImage(f.id)!;
    // Magic bytes của PNG, không tin vào đuôi file
    expect(saved[0]).toBe(0x89);
    expect(saved.subarray(1, 4).toString()).toBe('PNG');

    const meta = await sharp(saved).metadata();
    expect(meta.format).toBe('png');
    expect(meta.hasAlpha).toBe(true);
    expect(f.slotCount).toBe(3);
  });

  it('nhận cả AVIF và GIF', async () => {
    for (const [ten, buf] of [
      ['avif', await sharp(png3).avif().toBuffer()],
      ['gif', await sharp(png3).gif().toBuffer()],
    ] as Array<[string, Buffer]>) {
      const f = await createFrame({ label: `Tu ${ten}`, png: buf });
      const saved = readFrameImage(f.id)!;
      expect((await sharp(saved).metadata()).format, ten).toBe('png');
      expect(f.slotCount, ten).toBe(3);
    }
  });

  it('KHÔNG nén lại khi vốn đã là PNG', async () => {
    // Chuyển đổi thừa vừa tốn thời gian vừa có thể làm đổi file gốc
    const f = await createFrame({ label: 'Von la PNG', png: png3 });
    expect(readFrameImage(f.id)!.equals(png3)).toBe(true);
  });

  it('KHÔNG lưu khung không có ô nào', async () => {
    // Ảnh đặc + không vẽ ô = khung che kín ảnh khách. Phải chặn ở khâu lưu.
    const jpg = await sharp(png3).flatten({ background: '#fff' }).jpeg().toBuffer();
    await expect(createFrame({ label: 'Quen ve o', png: jpg })).rejects.toThrow(/ô nào/);
    expect(listFrames().length).toBe(0);
  });
});

describe('khoét lỗ cho khung đặc', () => {
  /** Đếm tỉ lệ pixel trong suốt của một file PNG. */
  async function tiLeTrong(buf: Buffer): Promise<number> {
    const { data, info } = await sharp(buf).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    let trong = 0;
    for (let i = 3; i < data.length; i += info.channels) if (data[i] < 128) trong++;
    return trong / (info.width * info.height);
  }

  const jpgDac = async () => sharp({
    create: { width: 600, height: 1800, channels: 3, background: { r: 30, g: 30, b: 30 } },
  }).jpeg().toBuffer();

  it('khoét đúng các ô nhân viên đặt', async () => {
    const f = await createFrame({
      label: 'JPG tu dat o',
      png: await jpgDac(),
      slots: [
        { x: 0.1, y: 0.05, w: 0.8, h: 0.28 },
        { x: 0.1, y: 0.36, w: 0.8, h: 0.28 },
        { x: 0.1, y: 0.67, w: 0.8, h: 0.28 },
      ],
    });

    const saved = readFrameImage(f.id)!;
    expect((await sharp(saved).metadata()).hasAlpha).toBe(true);
    expect(f.slotCount).toBe(3);
    // 3 ô × 0.8 × 0.28 = 67.2% diện tích
    expect(await tiLeTrong(saved)).toBeCloseTo(0.672, 2);
  });

  /*
   * Phép thử quan trọng nhất của cả tính năng: khung được đè LÊN TRÊN ảnh
   * khách lúc render, nên nếu khoét hỏng thì khách nhận về tấm ảnh che kín mà
   * không có lỗi nào báo ra.
   */
  it('ảnh khách hiện được qua lỗ vừa khoét', async () => {
    const f = await createFrame({
      label: 'Kiem tra hien anh',
      png: await jpgDac(),
      slots: [{ x: 0.2, y: 0.2, w: 0.6, h: 0.6 }],
    });

    const khung = readFrameImage(f.id)!;
    const anhKhach = await sharp({
      create: { width: 600, height: 1800, channels: 4, background: { r: 0, g: 200, b: 255, alpha: 1 } },
    }).png().toBuffer();

    const ghep = await sharp(anhKhach).composite([{ input: khung }]).png().toBuffer();
    const { data } = await sharp(ghep).raw().toBuffer({ resolveWithObject: true });

    let thay = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 2] > 200) thay++;
    expect(thay).toBeGreaterThan(0);
  });

  it('KHÔNG khoét khung vốn đã có vùng trong suốt', async () => {
    // Khung PNG thật: giữ nguyên file, không đụng vào lỗ sẵn có
    const f = await createFrame({ label: 'PNG san co', png: png3 });
    expect(readFrameImage(f.id)!.equals(png3)).toBe(true);
  });

  it('ô tràn ra ngoài mép ảnh vẫn khoét được, không lỗi', async () => {
    const f = await createFrame({
      label: 'O tran mep',
      png: await jpgDac(),
      slots: [{ x: 0.8, y: 0.8, w: 0.5, h: 0.5 }],
    });
    expect(await tiLeTrong(readFrameImage(f.id)!)).toBeGreaterThan(0);
  });
});

describe('seedBuiltins', () => {
  it('nạp 6 khung mẫu vào lần chạy đầu', () => {
    seedBuiltins();
    const all = listFrames();
    expect(all.length).toBe(6);
    expect(all.every((f) => f.builtin)).toBe(true);
    expect(all.every((f) => f.enabled)).toBe(true);
  });

  it('chép cả file PNG ra thư mục dữ liệu', () => {
    seedBuiltins();
    const f = listFrames()[0];
    expect(existsSync(join(framesDir(), `${f.id}.png`))).toBe(true);
    expect(readFrameImage(f.id)).toBeInstanceOf(Buffer);
  });

  it('KHÔNG nạp lại nếu đã có khung — khung mẫu đã xoá không tự mọc lại', () => {
    seedBuiltins();
    const first = listFrames()[0];
    deleteFrame(first.id);
    expect(listFrames().length).toBe(5);

    seedBuiltins();
    expect(listFrames().length).toBe(5);
  });
});

describe('createFrame', () => {
  it('dò ô rồi lưu khung mới', async () => {
    const f = await createFrame({ label: 'Khung Tết', png: png6 });
    expect(f.label).toBe('Khung Tết');
    expect(f.slotCount).toBe(6);
    expect(f.formatId).toBe('sheet46');
    expect(f.builtin).toBe(false);
    expect(f.enabled).toBe(true);
    expect(f.slots.length).toBe(6);
  });

  it('toạ độ ô đã chuẩn hoá 0..1', async () => {
    const f = await createFrame({ label: 'X', png: png6 });
    for (const s of f.slots) {
      expect(s.rect.x).toBeGreaterThanOrEqual(0);
      expect(s.rect.y).toBeGreaterThanOrEqual(0);
      expect(s.rect.x + s.rect.w).toBeLessThanOrEqual(1);
      expect(s.rect.y + s.rect.h).toBeLessThanOrEqual(1);
    }
  });

  it('từ chối khung không có tên', async () => {
    await expect(createFrame({ label: '   ', png: png6 })).rejects.toThrow(FrameError);
  });

  it('nhận toạ độ nắn tay thay cho toạ độ dò được', async () => {
    const manual = [
      { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
      { x: 0.6, y: 0.6, w: 0.3, h: 0.3 },
    ];
    const f = await createFrame({ label: 'Nắn tay', png: png6, slots: manual });
    expect(f.slotCount).toBe(2);
    expect(f.slots[0].rect).toEqual(manual[0]);
  });

  it('mỗi khung một file riêng — up lại cùng ảnh không đè lên nhau', async () => {
    const a = await createFrame({ label: 'A', png: png6 });
    const b = await createFrame({ label: 'B', png: png6 });
    expect(a.id).not.toBe(b.id);

    deleteFrame(a.id);
    // Xoá A không được làm mất ảnh của B
    expect(readFrameImage(b.id)).toBeInstanceOf(Buffer);
  });
});

describe('updateFrame', () => {
  it('bật/tắt khung, ảnh hưởng tới danh sách của khách', async () => {
    const f = await createFrame({ label: 'A', png: png6 });
    await createFrame({ label: 'B', png: png3 });
    expect(listFrames({ onlyEnabled: true }).length).toBe(2);

    updateFrame(f.id, { enabled: false });
    expect(listFrames({ onlyEnabled: true }).length).toBe(1);
    expect(listFrames().length).toBe(2);      // nhân viên vẫn thấy đủ
  });

  it('đổi tên', async () => {
    const f = await createFrame({ label: 'Cũ', png: png6 });
    expect(updateFrame(f.id, { label: 'Mới' })?.label).toBe('Mới');
  });

  it('sửa toạ độ ô thì slotCount đổi theo', async () => {
    const f = await createFrame({ label: 'A', png: png6 });
    const patched = updateFrame(f.id, {
      slots: [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }],
    });
    expect(patched?.slotCount).toBe(2);
    expect(patched?.slots.length).toBe(2);
  });

  it('trả null khi khung không tồn tại', () => {
    expect(updateFrame('khong-co', { label: 'X' })).toBeNull();
  });
});

describe('deleteFrame', () => {
  it('xoá cả bản ghi lẫn file', async () => {
    const f = await createFrame({ label: 'A', png: png6 });
    const file = join(framesDir(), `${f.id}.png`);
    expect(existsSync(file)).toBe(true);

    expect(deleteFrame(f.id)).toBe(true);
    expect(getFrame(f.id)).toBeNull();
    expect(existsSync(file)).toBe(false);
  });

  it('trả false khi khung không tồn tại', () => {
    expect(deleteFrame('khong-co')).toBe(false);
  });
});
