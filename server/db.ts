import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { CONFIG, dbPath } from './config.ts';

/**
 * SQLite một file. Dùng node:sqlite có sẵn trong Node 22 — không cần biên dịch
 * native, quan trọng trên Windows nơi better-sqlite3 hay lỗi node-gyp.
 *
 * Toàn bộ truy vấn đi qua module này, nên nếu cần đổi sang better-sqlite3
 * thì chỉ sửa ở đây.
 */

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;

  mkdirSync(CONFIG.dataDir, { recursive: true });
  db = new DatabaseSync(dbPath());

  // WAL cho phép đọc song song khi đang ghi — nhiều phòng upload cùng lúc.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  migrate(db);
  return db;
}

function migrate(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id              TEXT PRIMARY KEY,
      code            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'created',
      max_photos      INTEGER NOT NULL,
      room_id         TEXT,
      access_token    TEXT NOT NULL UNIQUE,
      dir             TEXT NOT NULL,
      note            TEXT,
      code_expires_at INTEGER NOT NULL,
      expires_at      INTEGER NOT NULL,
      created_at      INTEGER NOT NULL,
      claimed_at      INTEGER,
      done_at         INTEGER,
      purged_at       INTEGER
    );

    -- Mã phải duy nhất trong SUỐT thời gian phiên còn dùng được, kể cả khi
    -- khách đã chụp xong ('done'/'composed') — vì thư mục ảnh đặt tên theo mã,
    -- tái dùng mã sớm sẽ làm hai phiên ghi đè thư mục của nhau.
    -- Chỉ khi nhân viên đóng phiên ('closed') mã mới được dùng lại.
    CREATE UNIQUE INDEX IF NOT EXISTS sessions_live_code
      ON sessions(code) WHERE status IN ('created','active','shooting','done','composed');

    CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at)
      WHERE purged_at IS NULL;
    CREATE INDEX IF NOT EXISTS sessions_room ON sessions(room_id, status);

    CREATE TABLE IF NOT EXISTS photos (
      id         TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      seq        INTEGER NOT NULL,
      filename   TEXT NOT NULL,
      width      INTEGER,
      height     INTEGER,
      bytes      INTEGER,
      source     TEXT NOT NULL DEFAULT 'manual',
      source_name TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (session_id, seq)
    );

    CREATE TABLE IF NOT EXISTS composites (
      id         TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      frame_id   TEXT NOT NULL,
      filename   TEXT NOT NULL,
      width      INTEGER,
      height     INTEGER,
      bytes      INTEGER,
      recipe     TEXT NOT NULL,
      share_slug TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS code_attempts (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT,
      ok      INTEGER NOT NULL,
      at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS code_attempts_room ON code_attempts(room_id, at DESC);

    -- Khung ảnh nhân viên tải lên. File PNG nằm ở <dataDir>/frames/<id>.png;
    -- bảng này giữ toạ độ ô đã dò được và trạng thái bật/tắt.
    --
    -- slots là JSON mảng {x,y,w,h} CHUẨN HOÁ 0..1, không phải pixel — nhờ vậy
    -- một khung dùng được cho mọi khổ giấy, giống hệt khung dựng sẵn.
    CREATE TABLE IF NOT EXISTS frames (
      id         TEXT PRIMARY KEY,
      label      TEXT NOT NULL,
      slot_count INTEGER NOT NULL,
      format_id  TEXT NOT NULL,
      slots      TEXT NOT NULL,
      filename   TEXT NOT NULL,
      width      INTEGER NOT NULL,
      height     INTEGER NOT NULL,
      enabled    INTEGER NOT NULL DEFAULT 1,
      builtin    INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS frames_enabled
      ON frames(enabled, sort_order);
  `);

  // --- Nâng cấp database tạo từ bản cũ ---
  // ALTER TABLE không có IF NOT EXISTS nên phải kiểm tra trước.
  const cols = d.prepare('PRAGMA table_info(photos)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'source_name')) {
    d.exec('ALTER TABLE photos ADD COLUMN source_name TEXT');
  }

  // Khung tự khai kích thước in -> không bó vào 3 khổ dựng sẵn
  const fcols = d.prepare('PRAGMA table_info(frames)').all() as Array<{ name: string }>;
  if (fcols.length && !fcols.some((c) => c.name === 'width_inch')) {
    d.exec(`
      ALTER TABLE frames ADD COLUMN width_inch REAL;
      ALTER TABLE frames ADD COLUMN height_inch REAL;
    `);
  }

  // Chỉ số cũ chỉ phủ created/active/shooting -> phải dựng lại cho đúng phạm vi
  const idx = d
    .prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name='sessions_live_code'`)
    .get() as { sql: string } | undefined;
  if (idx?.sql && !idx.sql.includes("'composed'")) {
    d.exec(`
      DROP INDEX sessions_live_code;
      CREATE UNIQUE INDEX sessions_live_code ON sessions(code)
        WHERE status IN ('created','active','shooting','done','composed');
    `);
  }
}

/** Đóng kết nối — dùng trong test và khi tắt server. */
export function closeDb(): void {
  db?.close();
  db = null;
}

export const now = () => Date.now();
