/**
 * Kiểm chứng agent theo dõi thư mục có sẵn.
 *
 * Điểm quan trọng nhất: agent KHÔNG được đụng vào thư mục của người dùng,
 * và KHÔNG được vụt hàng nghìn ảnh cũ vào phiên đang mở.
 *
 *   node scripts/verify-agent.mjs
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const dataDir = mkdtempSync(join(tmpdir(), 'pb-agent-'));
// Giả lập thư mục ảnh CÓ SẴN của người dùng, mỗi phòng một nơi khác nhau
const roomA = mkdtempSync(join(tmpdir(), 'pb-roomA-'));
const roomB = mkdtempSync(join(tmpdir(), 'pb-roomB-'));

process.env.PHOTOBOOTH_DATA = dataDir;
process.env.PHOTOBOOTH_PASSWORD = 'test-secret';
process.env.PHOTOBOOTH_PORT = '8196';
process.env.PHOTOBOOTH_HOST = '127.0.0.1:8196';

const { start } = await import('../server/index.ts');
const server = start(8196);
await new Promise((r) => setTimeout(r, 400));

const BASE = 'http://127.0.0.1:8196';
const fails = [];
const check = (n, ok, extra = '') => {
  console.log(ok ? `  ok   ${n}` : `  FAIL ${n} ${extra}`);
  if (!ok) fails.push(n);
};

let cookie = '';
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts, headers: { ...(opts.headers ?? {}), ...(cookie ? { cookie } : {}) },
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const sharp = (await import('sharp')).default;
const jpeg = (rgb) =>
  sharp({ create: { width: 1600, height: 1200, channels: 3, background: rgb } })
    .jpeg().toBuffer();
const C = { do: { r: 220, g: 40, b: 70 }, xanh: { r: 40, g: 140, b: 220 },
            luc: { r: 50, g: 190, b: 100 }, vang: { r: 240, g: 175, b: 45 } };

// --- Thư mục CÓ SẴN với ảnh cũ + thư mục con ---
writeFileSync(join(roomA, 'anh-cu-1.jpg'), await jpeg(C.do));
writeFileSync(join(roomA, 'anh-cu-2.jpg'), await jpeg(C.xanh));
mkdirSync(join(roomA, 'Captured'), { recursive: true });
writeFileSync(join(roomA, 'Captured', 'anh-cu-3.jpg'), await jpeg(C.luc));
writeFileSync(join(roomA, 'ghi-chu.txt'), 'file khong phai anh');
const before = snapshot(roomA);
console.log(`\nThư mục có sẵn ${readdirSync(roomA).length} mục (gồm 3 ảnh cũ)\n`);

// --- Mở phiên ---
await api('/api/staff/login', { method: 'POST', body: JSON.stringify({ password: 'test-secret' }) });
const s1 = await api('/api/staff/sessions', { method: 'POST', body: JSON.stringify({ room: '1', maxPhotos: 3 }) });
await api('/api/room/claim', { method: 'POST', body: JSON.stringify({ room: '1', code: s1.body.code }) });

// --- Chạy agent, trỏ mỗi phòng vào một đường dẫn riêng ---
const agent = spawn(
  process.execPath,
  ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'agent/watcher.ts'],
  {
    env: {
      ...process.env,
      PHOTOBOOTH_SERVER: BASE,
      PHOTOBOOTH_ROOM1_DIR: roomA,
      PHOTOBOOTH_ROOM2_DIR: roomB,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
const out = [];
agent.stdout.on('data', (d) => out.push(d.toString()));
agent.stderr.on('data', (d) => out.push(d.toString()));
await new Promise((r) => setTimeout(r, 3000));

const count = async (room = '1') =>
  (await api(`/api/room/session?room=${room}`)).body.photos?.length ?? 0;

check('theo dõi được đường dẫn tuỳ ý của từng phòng',
  out.join('').includes(roomA) && out.join('').includes(roomB));
check('KHÔNG gửi ảnh cũ có sẵn trong thư mục', (await count()) === 0,
  `da gui ${await count()}`);

// --- Ảnh mới ---
console.log('Thêm 1 ảnh mới ...');
writeFileSync(join(roomA, 'moi-1.jpg'), await jpeg(C.vang));
await waitFor(async () => (await count()) === 1, 15000);
check('ảnh mới tự lên server', (await count()) === 1);

// --- Ảnh mới trong thư mục con ---
console.log('Thêm 1 ảnh mới trong thư mục con ...');
writeFileSync(join(roomA, 'Captured', 'moi-2.jpg'), await jpeg(C.do));
await waitFor(async () => (await count()) === 2, 20000);
check('ảnh trong thư mục con cũng lên', (await count()) === 2);

// --- Nhiều ảnh cùng lúc ---
console.log('Thêm 2 ảnh cùng lúc (gói còn 1 chỗ) ...');
writeFileSync(join(roomA, 'moi-3.jpg'), await jpeg(C.xanh));
writeFileSync(join(roomA, 'moi-4.jpg'), await jpeg(C.luc));
await new Promise((r) => setTimeout(r, 6000));
check('không vượt quá số ảnh của gói', (await count()) === 3, `${await count()}`);

// --- KHÔNG ĐỤNG VÀO THƯ MỤC NGƯỜI DÙNG (quan trọng nhất) ---
const after = snapshot(roomA);
const missing = [...before].filter((f) => !after.has(f));
check('KHÔNG xoá/di chuyển file nào của người dùng', missing.length === 0,
  `mat: ${missing.join(',')}`);
check('không tạo thư mục lạ trong thư mục người dùng',
  !existsSync(join(roomA, 'da-gui')));
check('file không phải ảnh vẫn nguyên', existsSync(join(roomA, 'ghi-chu.txt')));

// --- Phòng chưa mở khoá thì chờ, không mất ảnh ---
console.log('Thêm ảnh vào phòng 2 (chưa nhập mã) ...');
writeFileSync(join(roomB, 'cho-1.jpg'), await jpeg(C.do));
await new Promise((r) => setTimeout(r, 4000));
check('phòng chưa mở khoá: giữ file, không báo mất', existsSync(join(roomB, 'cho-1.jpg')));
check('phòng chưa mở khoá: chưa gửi gì', (await count('2')) === 0);

// Mở khoá -> ảnh đang chờ phải tự gửi (nhờ vòng quét định kỳ)
const s2 = await api('/api/staff/sessions', { method: 'POST', body: JSON.stringify({ room: '2', maxPhotos: 2 }) });
await api('/api/room/claim', { method: 'POST', body: JSON.stringify({ room: '2', code: s2.body.code }) });
await waitFor(async () => (await count('2')) === 1, 20000);
check('mở khoá xong, ảnh đang chờ TỰ gửi', (await count('2')) === 1);

// --- Không gửi trùng ---
await new Promise((r) => setTimeout(r, 6000));
check('không gửi trùng ảnh đã gửi', (await count('2')) === 1, `${await count('2')}`);

// --- Nguồn ---
const { getDb } = await import('../server/db.ts');
const src = getDb().prepare(`SELECT DISTINCT source FROM photos WHERE source != 'pending'`).all();
check('ảnh được đánh dấu source = agent',
  src.length === 1 && src[0].source === 'agent', JSON.stringify(src));

agent.kill();
server.close();
(await import('../server/db.ts')).closeDb();
for (const d of [dataDir, roomA, roomB]) rmSync(d, { recursive: true, force: true });

if (fails.length) {
  console.log('\n--- log agent ---\n' + out.join(''));
  console.error(`\nFAIL: ${fails.length} kiểm tra\n`);
  process.exit(1);
}
console.log('\nOK — agent chạy đúng và không đụng vào thư mục người dùng.\n');

function snapshot(dir, prefix = '') {
  const set = new Set();
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) for (const s of snapshot(join(dir, e.name), rel)) set.add(s);
    else set.add(rel);
  }
  return set;
}

async function waitFor(fn, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
