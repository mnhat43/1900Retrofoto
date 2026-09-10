import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from './config.ts';

/**
 * Ghi log ra file để còn chẩn đoán được sau khi sự việc đã xảy ra.
 *
 * Vì sao cần: server chạy dưới quyền SYSTEM qua Task Scheduler, không có cửa
 * sổ nào để nhân viên đọc. Khi server chết lúc 2 giờ sáng thì thứ duy nhất
 * còn lại là file này — KIEM-TRA.bat đọc mấy dòng cuối và hiện cho nhân viên.
 */

const MAX_BYTES = 2 * 1024 * 1024;

export const logPath = () => join(CONFIG.dataDir, 'logs', 'server.log');

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Ghi một dòng. TUYỆT ĐỐI không được ném lỗi ra ngoài — hàm này được gọi từ
 * trong bộ bắt lỗi cấp tiến trình, nếu nó tự lỗi thì mất luôn cả server.
 */
export function logLine(msg: string): void {
  try {
    const file = logPath();
    mkdirSync(join(CONFIG.dataDir, 'logs'), { recursive: true });

    // Cắt file khi quá to, giữ lại một bản .old để vẫn tra được hôm trước
    if (existsSync(file) && statSync(file).size > MAX_BYTES) {
      renameSync(file, `${file}.old`);
    }
    appendFileSync(file, `[${stamp()}] ${msg}\n`, 'utf8');
  } catch {
    /* không ghi được thì thôi, không được làm sập server vì chuyện ghi log */
  }
}

export function logError(label: string, err: unknown): void {
  const detail =
    err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  logLine(`${label}: ${detail}`);
  console.error(label, err);
}

/** Mấy dòng cuối của log — dùng cho endpoint kiểm tra và KIEM-TRA.bat. */
export function recentLog(lines = 40): string[] {
  try {
    const all = readFileSync(logPath(), 'utf8').split(/\r?\n/).filter(Boolean);
    return all.slice(-lines);
  } catch {
    return [];
  }
}
