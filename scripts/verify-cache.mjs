/**
 * Kiểm chứng header cache.
 *
 * HTML KHÔNG được cache — tên file cố định nên trình duyệt sẽ giữ bản cũ sau
 * mỗi lần build, làm người dùng thấy giao diện cũ dù server đã cập nhật.
 * Lỗi này rất khó nhận ra vì server vẫn "chạy đúng".
 *
 *   node scripts/verify-cache.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'pb-cache-'));
process.env.PHOTOBOOTH_DATA = dataDir;
process.env.PHOTOBOOTH_PASSWORD = 't';
process.env.PHOTOBOOTH_PORT = '8190';
process.env.PHOTOBOOTH_HOST = '127.0.0.1:8190';

const { start } = await import('../server/index.ts');
const server = start(8190);
await new Promise((r) => setTimeout(r, 400));
const BASE = 'http://127.0.0.1:8190';

const fails = [];
const check = (n, ok, x = '') => { console.log(ok ? `  ok   ${n}` : `  FAIL ${n} ${x}`); if (!ok) fails.push(n); };

const head = async (p) => {
  const r = await fetch(BASE + p);
  return { status: r.status, cc: r.headers.get('cache-control') ?? '', body: await r.text() };
};

console.log('\n--- HTML không được cache ---');
for (const p of ['/staff', '/room?p=1', '/c/abc', '/']) {
  const r = await head(p);
  check(`${p} không cache`, r.cc.includes('no-cache'), r.cc);
}

console.log('\n--- File assets cache lâu (tên có mã băm) ---');
const html = (await head('/staff')).body;
const asset = html.match(/assets\/[\w.-]+\.js/)?.[0];
check('tìm được file assets trong HTML', !!asset, asset);
if (asset) {
  const r = await head('/' + asset);
  check('assets cache lâu', r.cc.includes('max-age=31536000'), r.cc);
  check('assets đánh dấu immutable', r.cc.includes('immutable'), r.cc);
}

console.log('\n--- Đổi build thì trình duyệt lấy được bản mới ---');
// HTML no-cache nghĩa là trình duyệt luôn hỏi lại server -> luôn thấy tên
// file assets mới nhất sau khi build lại.
check('HTML luôn hỏi lại server nên không kẹt bản cũ',
  (await head('/staff')).cc.includes('must-revalidate'));

server.close();
(await import('../server/db.ts')).closeDb();
rmSync(dataDir, { recursive: true, force: true });

console.log(fails.length ? `\nFAIL: ${fails.length} kiểm tra\n` : '\nOK — header cache đúng.\n');
process.exit(fails.length ? 1 : 0);
