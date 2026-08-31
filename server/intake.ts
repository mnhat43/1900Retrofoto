import { mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { CONFIG } from './config.ts';
import { addPhoto, listPhotos, CaptureError } from './capture.ts';
import type { Session } from './session.ts';

/**
 * Nạp ảnh từ thư mục chụp của phiên.
 *
 * Mỗi phiên có một thư mục riêng đặt tên đúng bằng mã 4 số, tạo ngay lúc
 * nhân viên tạo mã. Khi khách bấm "Đã chụp xong", server quét đúng thư mục ấy.
 *
 * Vì mỗi phiên một thư mục, ảnh KHÔNG THỂ lẫn giữa các khách — kể cả khi
 * hai phòng chụp cùng lúc. Đây là lý do chọn cách này thay vì lọc theo
 * thời gian trên một thư mục dùng chung.
 */

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.tif', '.tiff']);

/** Đã cấu hình thư mục chụp chưa. */
export const captureEnabled = () => CONFIG.captureRoot.trim() !== '';

/** Đường dẫn thư mục chụp của một mã. */
export function captureDir(code: string): string {
  if (!captureEnabled()) throw new Error('Chưa cấu hình PHOTOBOOTH_CAPTURE');
  // Mã luôn là 4 chữ số nên không có nguy cơ thoát thư mục, vẫn kiểm cho chắc.
  if (!/^\d{4}$/.test(code)) throw new Error('Mã không hợp lệ');
  return resolve(CONFIG.captureRoot, code);
}

/**
 * Tạo sẵn thư mục cho một mã. Gọi ngay khi nhân viên tạo mã, để nhân viên
 * trỏ phần mềm Canon vào được trước lúc khách bắt đầu chụp.
 */
export function ensureCaptureDir(code: string): string | null {
  if (!captureEnabled()) return null;
  try {
    const dir = captureDir(code);
    mkdirSync(dir, { recursive: true });
    return dir;
  } catch (err) {
    console.error(`Không tạo được thư mục chụp cho mã ${code}:`, err);
    return null;
  }
}

/** Liệt kê file ảnh trong thư mục, sắp theo thời điểm tạo. */
function listImages(dir: string): Array<{ path: string; name: string; mtime: number }> {
  if (!existsSync(dir)) return [];
  const out: Array<{ path: string; name: string; mtime: number }> = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Chỉ quét một cấp — phần mềm chụp lưu thẳng vào thư mục mã
    if (!entry.isFile()) continue;
    if (!IMAGE_EXT.has(extname(entry.name).toLowerCase())) continue;
    const p = join(dir, entry.name);
    try {
      const st = statSync(p);
      if (st.size > 0) out.push({ path: p, name: entry.name, mtime: st.mtimeMs });
    } catch {
      /* file vừa bị xoá/khoá -> bỏ qua */
    }
  }

  // Sắp theo thời gian tạo để thứ tự ảnh khớp thứ tự chụp
  out.sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name));
  return out;
}

export type IntakeResult = {
  /** Tổng số ảnh tìm thấy trong thư mục */
  found: number;
  /** Số ảnh vừa nạp thêm vào phiên lần này */
  added: number;
  /** Tổng số ảnh phiên đang có sau khi nạp */
  total: number;
  /** Số ảnh bị bỏ vì vượt số của gói */
  skippedFull: number;
  /** Số file lỗi không đọc được */
  failed: number;
  dir: string;
};

/**
 * Quét thư mục của phiên và nạp ảnh vào.
 *
 * Chạy được nhiều lần — ảnh đã nạp rồi thì bỏ qua, nên khách bấm "Quét lại"
 * bao nhiêu lần cũng không bị nhân đôi ảnh.
 */
export async function intakeFromFolder(session: Session): Promise<IntakeResult> {
  const dir = captureDir(session.code);
  const files = listImages(dir);

  // Ảnh đã nạp rồi thì bỏ qua — nhận diện theo tên file gốc đã lưu.
  const already = new Set(listPhotos(session.id).map((p) => p.sourceName ?? ''));

  let added = 0;
  let skippedFull = 0;
  let failed = 0;

  for (const f of files) {
    if (already.has(f.name)) continue;
    try {
      const data = await readFile(f.path);
      await addPhoto(session, data, 'agent', f.name);
      added++;
    } catch (err) {
      if (err instanceof CaptureError && err.code === 'full') {
        skippedFull++;
        break;   // hết chỗ thì dừng luôn, không thử tiếp
      }
      failed++;
      console.error(`Không nạp được ${f.name}:`, err);
    }
  }

  return {
    found: files.length,
    added,
    total: listPhotos(session.id).length,
    skippedFull,
    failed,
    dir,
  };
}
