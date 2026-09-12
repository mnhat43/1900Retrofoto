/**
 * Agent theo dõi thư mục ảnh có sẵn trên máy chủ.
 *
 * Cách dùng:
 *   1. Chép agent/config.example.json  ->  agent/config.json
 *   2. Sửa đường dẫn từng phòng cho đúng máy bạn
 *   3. npm run agent
 *
 * Agent CHỈ ĐỌC thư mục của bạn — không di chuyển, không đổi tên, không xoá gì.
 * Danh sách file đã gửi được ghi nhớ riêng trong thư mục dữ liệu của app,
 * nên quy trình hiện tại của bạn không bị ảnh hưởng.
 *
 * ĐÂY CHÍNH LÀ HỢP ĐỒNG dùng cho Canon: phần mềm máy ảnh lưu ảnh vào thư mục
 * phòng như bình thường, agent bắt được và đẩy lên server. Không phải sửa
 * server, giao diện, hay chính agent này.
 */
import { watch, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readFile, stat, readdir } from 'node:fs/promises';
import { join, extname, basename, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type Config = {
  server?: string;
  rooms?: Record<string, string>;
  sendExisting?: boolean;
  watchSubfolders?: boolean;
};

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.tif', '.tiff']);
const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.heic': 'image/heic',
  '.tif': 'image/tiff', '.tiff': 'image/tiff',
};

const log = (msg: string) =>
  console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

// ---------------------------------------------------------------------------
// Cấu hình
// ---------------------------------------------------------------------------

function loadConfig(): Required<Config> & { rooms: Record<string, string> } {
  const file = join(import.meta.dirname, 'config.json');
  let cfg: Config = {};

  if (existsSync(file)) {
    try {
      cfg = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
    } catch (err) {
      console.error(`\n  Lỗi đọc agent/config.json: ${(err as Error).message}\n`);
      process.exit(1);
    }
  }

  /*
   * Biến môi trường ghi đè file — tiện cho việc test và cho máy phòng chỉ
   * chạy một phòng của nó.
   *
   * Khai bằng biến môi trường thì THAY HẲN danh sách trong file, không trộn
   * vào: trộn thì test chỉ định hai phòng tạm vẫn kéo theo các phòng thật
   * trong config.json, quét cả chục nghìn ảnh qua ổ mạng và làm test chậm
   * tới mức trượt.
   */
  const fromEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    const m = k.match(/^PHOTOBOOTH_ROOM(\w+)_DIR$/);
    if (m && v) fromEnv[m[1].toLowerCase()] = v;
  }
  const rooms: Record<string, string> =
    Object.keys(fromEnv).length > 0 ? fromEnv : { ...(cfg.rooms ?? {}) };

  if (Object.keys(rooms).length === 0) {
    console.error('\n  Chưa khai báo thư mục cho phòng nào.');
    console.error('  Chép agent/config.example.json thành agent/config.json');
    console.error('  rồi sửa đường dẫn cho đúng máy bạn.\n');
    process.exit(1);
  }

  return {
    server: process.env.PHOTOBOOTH_SERVER ?? cfg.server ?? 'http://127.0.0.1:8090',
    rooms,
    sendExisting: process.env.PHOTOBOOTH_SEND_EXISTING === '1' || cfg.sendExisting === true,
    watchSubfolders: cfg.watchSubfolders !== false,
  };
}

const CONFIG = loadConfig();

// ---------------------------------------------------------------------------
// Ghi nhớ file đã gửi
//
// Vì KHÔNG di chuyển file trong thư mục của bạn, phải tự nhớ file nào đã gửi.
// Nhớ theo (đường dẫn + kích thước + thời điểm sửa) nên file khác trùng tên
// vẫn được nhận ra là file mới.
// ---------------------------------------------------------------------------

const dataDir = process.env.PHOTOBOOTH_DATA ?? join(process.cwd(), 'photobooth-data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, 'agent-sent.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS sent (
    key     TEXT PRIMARY KEY,
    room    TEXT NOT NULL,
    path    TEXT NOT NULL,
    sent_at INTEGER NOT NULL
  );
`);

const fileKey = (path: string, size: number, mtimeMs: number) =>
  `${resolve(path)}|${size}|${Math.round(mtimeMs)}`;

const alreadySent = (key: string) =>
  db.prepare('SELECT 1 FROM sent WHERE key = ?').get(key) !== undefined;

const markSent = (key: string, room: string, path: string) =>
  db.prepare('INSERT OR REPLACE INTO sent (key, room, path, sent_at) VALUES (?,?,?,?)')
    .run(key, room, path, Date.now());

/**
 * Gói nhiều lần ghi vào một transaction.
 *
 * Lúc khởi động ta đánh dấu TOÀN BỘ ảnh cũ là đã xử lý — thư mục thật có
 * hàng chục nghìn file. Mỗi INSERT rời là một lần ép ghi đĩa, 15.000 file
 * mất hơn một phút MỖI PHÒNG và agent trông như bị treo. Gói lại còn dưới
 * một giây.
 */
function inTransaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* đã hỏng thì thôi */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Gửi ảnh
// ---------------------------------------------------------------------------

const inFlight = new Set<string>();

/**
 * Chờ file ghi xong.
 *
 * Máy ảnh và phần mềm copy ghi file theo từng khối — đọc quá sớm sẽ được file
 * cụt. Chờ tới khi kích thước ngừng thay đổi mới coi là xong.
 */
async function waitUntilStable(
  path: string,
  timeoutMs = 60_000,
): Promise<{ size: number; mtimeMs: number } | null> {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  let stableFor = 0;

  while (Date.now() < deadline) {
    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(path);
    } catch {
      return null; // file đã bị xoá/di chuyển
    }
    if (st.size > 0 && st.size === last) {
      stableFor += 300;
      if (stableFor >= 900) return { size: st.size, mtimeMs: st.mtimeMs };
    } else {
      stableFor = 0;
      last = st.size;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

async function handleFile(room: string, path: string): Promise<void> {
  const name = basename(path);
  if (!IMAGE_EXT.has(extname(name).toLowerCase())) return;
  if (inFlight.has(path)) return;
  inFlight.add(path);

  try {
    const info = await waitUntilStable(path);
    if (!info) return;

    const key = fileKey(path, info.size, info.mtimeMs);
    if (alreadySent(key)) return;

    const data = await readFile(path);
    const res = await fetch(
      `${CONFIG.server}/api/capture?room=${encodeURIComponent(room)}` +
        `&source=agent&mtime=${Math.round(info.mtimeMs)}`,
      {
        method: 'POST',
        headers: { 'content-type': MIME[extname(name).toLowerCase()] ?? 'image/jpeg' },
        body: data,
      },
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, string | number>;

    if (res.ok) {
      markSent(key, room, path);
      log(`phòng ${room}: đã gửi ${name} (${body.count}/${Number(body.count) + Number(body.remaining)})`);
      return;
    }

    // Phòng chưa mở khoá -> KHÔNG đánh dấu đã gửi, khách nhập mã xong sẽ thử lại
    if (res.status === 409 && String(body.error ?? '').includes('chưa mở khoá')) {
      log(`phòng ${room}: chưa nhập mã, chờ ${name}`);
      return;
    }
    /*
     * Ảnh của lượt chụp TRƯỚC về trễ (server biết nhờ trigger LumaBooth).
     * Đánh dấu đã gửi: thử lại cũng vô ích, và để nó treo thì ảnh sẽ chảy
     * vào khách kế tiếp — đúng thứ trigger sinh ra để ngăn.
     */
    if (body.reason === 'stale') {
      markSent(key, room, path);
      log(`phòng ${room}: ${name} thuộc lượt trước, bỏ qua`);
      return;
    }
    // Đủ ảnh rồi -> đánh dấu để khỏi thử lại mãi
    if (body.reason === 'full') {
      markSent(key, room, path);
      log(`phòng ${room}: đã đủ ảnh của gói, bỏ qua ${name}`);
      return;
    }
    log(`phòng ${room}: lỗi gửi ${name} — ${body.error ?? res.status}`);
  } catch (err) {
    log(`phòng ${room}: không gửi được ${name} — ${(err as Error).message}`);
  } finally {
    inFlight.delete(path);
  }
}

/**
 * Quét thư mục để tìm ảnh mới xuất hiện mà sự kiện watch có thể bỏ sót.
 *
 * Tham số collect chỉ dùng cho lượt đánh dấu lúc khởi động: gom kết quả lại để
 * người gọi ghi một thể trong một transaction, thay vì ghi từng file.
 */
async function scan(
  room: string,
  dir: string,
  markOnly = false,
  collect?: Array<{ key: string; room: string; path: string }>,
): Promise<void> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (CONFIG.watchSubfolders) await scan(room, p, markOnly, collect);
      continue;
    }
    if (!IMAGE_EXT.has(extname(e.name).toLowerCase())) continue;

    if (markOnly) {
      // Lúc khởi động: ghi nhận ảnh cũ là "đã xử lý" mà KHÔNG gửi,
      // để thư mục có sẵn hàng nghìn ảnh cũ không bị vụt hết vào phiên đang mở.
      try {
        const st = await stat(p);
        const key = fileKey(p, st.size, st.mtimeMs);
        if (collect) collect.push({ key, room, path: p });
        else markSent(key, room, p);
      } catch { /* bỏ qua */ }
    } else {
      void handleFile(room, p);
    }
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('\n  Agent theo dõi thư mục ảnh');
  console.log(`  Server: ${CONFIG.server}\n`);

  try {
    const r = await fetch(`${CONFIG.server}/api/staff/me`);
    if (!r.ok) throw new Error(String(r.status));
  } catch {
    console.error(`  Không kết nối được server ở ${CONFIG.server}`);
    console.error('  Hãy chạy start-server.cmd trước.\n');
    process.exit(1);
  }

  let ok = 0;
  for (const [room, dir] of Object.entries(CONFIG.rooms)) {
    if (!existsSync(dir)) {
      console.error(`  [LỖI] phòng ${room}: không tìm thấy thư mục ${dir}`);
      continue;
    }

    if (CONFIG.sendExisting) {
      console.log(`  [ok] phòng ${room}: ${dir}  (sẽ gửi cả ảnh có sẵn)`);
      void scan(room, dir);
    } else {
      // Đánh dấu ảnh cũ là đã xử lý -> chỉ gửi ảnh xuất hiện từ giờ trở đi
      const found: Array<{ key: string; room: string; path: string }> = [];
      await scan(room, dir, true, found);
      inTransaction(() => {
        for (const f of found) markSent(f.key, f.room, f.path);
      });
      console.log(`  [ok] phòng ${room}: ${dir}  (${found.length} ảnh có sẵn, sẽ không gửi)`);
    }

    watch(dir, { recursive: CONFIG.watchSubfolders }, (_e, filename) => {
      if (!filename) return;
      const p = join(dir, filename.toString());
      if (existsSync(p)) void handleFile(room, p);
    });
    ok++;
  }

  if (ok === 0) {
    console.error('\n  Không theo dõi được thư mục nào. Kiểm tra lại agent/config.json\n');
    process.exit(1);
  }

  // Quét định kỳ: một số ổ mạng và thư mục chia sẻ không bắn sự kiện watch
  setInterval(() => {
    for (const [room, dir] of Object.entries(CONFIG.rooms)) {
      if (existsSync(dir)) void scan(room, dir);
    }
  }, 10_000);

  // Báo cho server biết agent còn sống, để màn hình phòng hiện đúng trạng thái
  const ping = () => {
    const rooms = encodeURIComponent(Object.keys(CONFIG.rooms).join(','));
    fetch(`${CONFIG.server}/api/agent/ping?rooms=${rooms}`, { method: 'POST' })
      .catch(() => { /* server tắt tạm thì bỏ qua, lần sau ping tiếp */ });
  };
  ping();
  setInterval(ping, 15_000);

  if (!CONFIG.sendExisting) {
    console.log('\n  Bỏ qua ảnh đã có sẵn — chỉ gửi ảnh mới từ lúc này.');
  }
  console.log('  Không di chuyển hay xoá gì trong thư mục của bạn.');
  console.log('  Ctrl+C để dừng.\n');
}

main();
