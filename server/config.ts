import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Cấu hình server. Đọc từ biến môi trường, có mặc định hợp lý để chạy thử ngay.
 *
 * Trên máy chủ thật, script cài đặt ghi sẵn vào .env.local:
 *   PHOTOBOOTH_DATA=D:\photobooth
 *   PHOTOBOOTH_PASSWORD=<mật khẩu nhân viên>
 */

// Nạp .env.local nếu có — biến môi trường thật vẫn được ưu tiên hơn.
const envFile = join(process.cwd(), '.env.local');
if (existsSync(envFile)) {
  // replace(/^﻿/) bỏ BOM: PowerShell trên Windows ghi file UTF-8 kèm BOM,
  // nếu không bỏ thì khoá đầu tiên thành "﻿PHOTOBOOTH_DATA" và bị bỏ qua.
  const text = readFileSync(envFile, 'utf8').replace(/^﻿/, '');
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

/**
 * Phiên bản đang chạy, đọc từ package.json.
 *
 * Neo vào vị trí file mã nguồn (`../package.json`) chứ không phải
 * `process.cwd()`: bố cục này giống nhau ở cả kho mã nguồn lẫn gói cài đặt,
 * còn thư mục làm việc thì đổi theo cách khởi động.
 *
 * Số này là thứ `CAP-NHAT` so với bản mới nhất trên GitHub để biết có cần
 * cập nhật không — đọc hụt thì trả '0.0.0' để luôn coi là có bản mới, thà
 * cập nhật thừa còn hơn kẹt mãi ở bản cũ mà không ai biết.
 */
function readVersion(): string {
  try {
    const path = fileURLToPath(new URL('../package.json', import.meta.url));
    return JSON.parse(readFileSync(path, 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const CONFIG = {
  /** Phiên bản phần mềm, ví dụ "1.2.0". */
  version: readVersion(),

  port: Number(process.env.PHOTOBOOTH_PORT ?? 8080),

  /** Thư mục gốc chứa database và toàn bộ ảnh. */
  dataDir: process.env.PHOTOBOOTH_DATA ?? join(process.cwd(), 'photobooth-data'),

  /** Mật khẩu chung cho nhân viên. */
  staffPassword: process.env.PHOTOBOOTH_PASSWORD ?? 'photobooth',

  /** Số ngày giữ ảnh trước khi tự xoá. */
  retentionDays: Number(process.env.PHOTOBOOTH_RETENTION_DAYS ?? 7),

  /** Mã 4 số hết hạn sau bao lâu nếu chưa ai nhập ở phòng (phút). */
  codeTtlMinutes: Number(process.env.PHOTOBOOTH_CODE_TTL ?? 120),

  /** Danh sách phòng. Đổi ở đây nếu thêm/bớt phòng. */
  rooms: (process.env.PHOTOBOOTH_ROOMS ?? '1,2,3').split(',').map((s) => s.trim()),

  /**
   * Thư mục gốc nơi phần mềm Canon lưu ảnh.
   *
   * Khi nhân viên tạo mã, server tạo sẵn thư mục con tên đúng bằng mã đó
   * (ví dụ D:\Anh\5680\). Nhân viên trỏ phần mềm chụp vào thư mục này, và khi
   * khách bấm "Đã chụp xong" server quét đúng thư mục ấy.
   *
   * Nhờ mỗi phiên một thư mục riêng, ảnh không thể lẫn giữa các khách —
   * kể cả khi hai phòng chụp cùng lúc.
   */
  captureRoot: process.env.PHOTOBOOTH_CAPTURE ?? '',

  /**
   * Cạnh dài tối đa của ảnh preview mà điện thoại tải về.
   * Phải khớp PREVIEW_MAX_EDGE trong src/media/assets.ts — ô trong dải chỉ
   * rộng ~500px @300DPI nên 1400px là thừa đủ cho cả export.
   */
  previewMaxEdge: 1400,
} as const;

export const dbPath = () => join(CONFIG.dataDir, 'data.db');

/** Cảnh báo nếu đang chạy với mật khẩu mặc định — không được để vậy khi dùng thật. */
export function warnIfInsecure(): void {
  if (!process.env.PHOTOBOOTH_PASSWORD) {
    console.warn(
      '\n  ⚠ Đang dùng MẬT KHẨU MẶC ĐỊNH cho trang nhân viên.\n' +
        '    Đặt PHOTOBOOTH_PASSWORD trước khi dùng thật.\n',
    );
  }
}
