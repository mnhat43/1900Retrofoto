import { mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { writeFile, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { CONFIG } from './config.ts';

/**
 * Đọc/ghi thư mục ảnh trên ổ cứng.
 *
 * Cấu trúc người đọc được — mở File Explorer là thấy ngay, không cần công cụ:
 *   D:\photobooth\2026-08-31\4829\originals\01.jpg
 *                                  \previews\01.jpg
 *                                  \strips\strip-1.png
 */

export type Bucket = 'originals' | 'previews' | 'strips';

/**
 * Ghép đường dẫn an toàn. Chặn path traversal — dir và filename đến từ
 * database và request, không được phép thoát ra ngoài dataDir.
 */
function safeJoin(...parts: string[]): string {
  const root = resolve(CONFIG.dataDir);
  const full = resolve(root, ...parts);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error('Đường dẫn không hợp lệ');
  }
  return full;
}

export function sessionDir(dir: string, bucket?: Bucket): string {
  return bucket ? safeJoin(dir, bucket) : safeJoin(dir);
}

export function filePath(dir: string, bucket: Bucket, filename: string): string {
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new Error('Tên file không hợp lệ');
  }
  return safeJoin(dir, bucket, filename);
}

export async function saveFile(
  dir: string,
  bucket: Bucket,
  filename: string,
  data: Buffer | Uint8Array,
): Promise<string> {
  const target = filePath(dir, bucket, filename);
  mkdirSync(sessionDir(dir, bucket), { recursive: true });
  await writeFile(target, data);
  return target;
}

export async function readFileFrom(
  dir: string,
  bucket: Bucket,
  filename: string,
): Promise<Buffer> {
  return readFile(filePath(dir, bucket, filename));
}

export function fileExists(dir: string, bucket: Bucket, filename: string): boolean {
  try {
    return existsSync(filePath(dir, bucket, filename));
  } catch {
    return false;
  }
}

export function fileSize(dir: string, bucket: Bucket, filename: string): number {
  try {
    return statSync(filePath(dir, bucket, filename)).size;
  } catch {
    return 0;
  }
}

/** Xoá toàn bộ thư mục của một phiên — dùng cho job dọn dẹp. */
export function removeSessionDir(dir: string): void {
  rmSync(sessionDir(dir), { recursive: true, force: true });
}
