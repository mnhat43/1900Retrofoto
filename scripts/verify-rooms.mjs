/**
 * Kiểm chứng quy tắc "mỗi phòng một phiên".
 *
 * Phòng chỉ rảnh khi NHÂN VIÊN bấm "Đóng phiên" — không tự rảnh khi khách
 * chụp/ghép xong. Nhờ vậy không có chuyện phòng nhận khách mới trong khi
 * lượt trước chưa dứt điểm.
 *
 *   node scripts/verify-rooms.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const dataDir = mkdtempSync(join(tmpdir(), 'pb-rm-'));
const captureRoot = mkdtempSync(join(tmpdir(), 'pb-rmcap-'));
process.env.PHOTOBOOTH_DATA = dataDir;
process.env.PHOTOBOOTH_CAPTURE = captureRoot;
process.env.PHOTOBOOTH_PASSWORD = 't';
process.env.PHOTOBOOTH_PORT = '8191';
process.env.PHOTOBOOTH_HOST = '127.0.0.1:8191';

const { start } = await import('../server/index.ts');
const server = start(8191);
await new Promise((r) => setTimeout(r, 400));
const BASE = 'http://127.0.0.1:8191';

const fails = [];
const check = (n, ok, x = '') => { console.log(ok ? `  ok   ${n}` : `  FAIL ${n} ${x}`); if (!ok) fails.push(n); };

let cookie = '';
async function api(p, o = {}) {
  const res = await fetch(BASE + p, { ...o, headers: { ...(o.headers ?? {}), ...(cookie ? { cookie } : {}) } });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const mk = (room, maxPhotos = 4) =>
  api('/api/staff/sessions', { method: 'POST', body: JSON.stringify({ room, maxPhotos }) });

await api('/api/staff/login', { method: 'POST', body: JSON.stringify({ password: 't' }) });

console.log('\n--- Bắt buộc chọn phòng ---');
const noRoom = await api('/api/staff/sessions', { method: 'POST', body: JSON.stringify({ maxPhotos: 4 }) });
check('không chọn phòng thì từ chối', noRoom.status === 400, JSON.stringify(noRoom.body));

console.log('\n--- Mỗi phòng chỉ một phiên ---');
const a = await mk('1');
check('tạo được mã cho phòng trống', a.status === 200 && !!a.body.code);
check('mã gắn đúng phòng', a.body.room === '1');

const dup = await mk('1');
check('phòng đang bận thì KHÔNG tạo được mã mới',
  dup.status === 409 && dup.body.reason === 'room_busy', JSON.stringify(dup.body));
check('báo rõ mã đang chiếm phòng', dup.body.busyCode === a.body.code);

const b = await mk('2');
check('phòng khác vẫn tạo được', b.status === 200);

console.log('\n--- Mã chỉ dùng được ở đúng phòng ---');
const wrong = await api('/api/room/claim', {
  method: 'POST', body: JSON.stringify({ room: '3', code: a.body.code }),
});
check('phòng 3 KHÔNG nhập được mã của phòng 1', wrong.status !== 200);

const right = await api('/api/room/claim', {
  method: 'POST', body: JSON.stringify({ room: '1', code: a.body.code }),
});
check('phòng 1 nhập được mã của mình', right.status === 200);

/*
 * Chụp xong là BUỒNG RẢNH NGAY.
 *
 * Khách cũ cầm QR ra ngoài ngồi ghép ảnh, khách mới vào chụp luôn — không
 * phải đợi nhân viên đóng phiên. Đây là chỗ tiết kiệm 5-10 phút mỗi lượt.
 */
console.log('\n--- Chụp xong: buồng rảnh ngay, khách cũ vẫn ghép được ---');
await api('/api/room/finish?room=1', { method: 'POST' });

const rooms = await api('/api/staff/rooms');
const room1 = rooms.body.rooms.find((r) => r.id === '1');
check('chụp xong: phòng 1 KHÔNG còn bận', room1?.busy === false,
  JSON.stringify(room1));
check('nhân viên thấy phiên đang ghép ảnh', (room1?.composing ?? []).length === 1,
  JSON.stringify(room1?.composing));
check('phòng 2 vẫn bận (đang chụp)',
  rooms.body.rooms.find((r) => r.id === '2')?.busy === true);
check('phòng 3 còn trống',
  rooms.body.rooms.find((r) => r.id === '3')?.busy === false);

const detailA = await api(`/api/staff/sessions/${a.body.id}`);
const tokenA = detailA.body.token;
const guestA = await api(`/api/s?t=${encodeURIComponent(tokenA)}`);
check('khách vừa chụp xong VẪN mở được QR', guestA.status === 200);

/*
 * Trước khi có mã mới, màn hình phòng vẫn phải hiện QR của khách vừa xong —
 * họ còn đứng đó chờ quét.
 */
const beforeNew = await api('/api/room/session?room=1');
check('chưa có mã mới: màn hình phòng còn hiện QR của khách vừa xong',
  beforeNew.body.session?.code === a.body.code && !!beforeNew.body.qr,
  JSON.stringify(beforeNew.body.session));

const next = await mk('1');
check('tạo được mã mới cho phòng ngay', next.status === 200 && !!next.body.code,
  JSON.stringify(next.body));
check('mã mới khác mã của khách đang ghép', next.body.code !== a.body.code);

/*
 * Có mã mới là màn hình phòng phải BỎ QR ngay, quay về bàn phím nhập mã.
 *
 * Nếu không, khách mới cầm mã 7600 đứng trước màn hình đang hiện QR của
 * khách 7038 và không có chỗ nào để nhập — phòng chết dù buồng trống.
 */
const afterNew = await api('/api/room/session?room=1');
check('có mã mới: màn hình phòng quay về màn nhập mã',
  afterNew.body.session === null, JSON.stringify(afterNew.body.session));
check('màn nhập mã không kèm QR của khách cũ', !afterNew.body.qr);

/* QR của khách cũ không mất — nhân viên chìa lại được từ trang quản lý. */
const qrBack = await api(`/api/staff/sessions/${a.body.id}/qr`);
check('nhân viên hiện lại được QR của khách đang ghép',
  qrBack.status === 200 && qrBack.body.qr?.view?.startsWith('data:image/'),
  JSON.stringify(qrBack.body).slice(0, 120));
check('QR hiện lại đúng phiên', qrBack.body.code === a.body.code);

/*
 * Phòng 2 cũng có mã chờ khách (chưa ai nhập) nên cũng phải là màn nhập mã —
 * và nhập được đúng mã của nó, không bị mã phòng 1 làm nhiễu.
 */
const room2Screen = await api('/api/room/session?room=2');
check('phòng 2 đang chờ khách nhập mã', room2Screen.body.session === null,
  JSON.stringify(room2Screen.body.session));

// Khách mới vào chụp -> màn hình phòng phải theo phiên MỚI
await api('/api/room/claim', {
  method: 'POST', body: JSON.stringify({ room: '1', code: next.body.code }),
});
const roomNow = await api('/api/room/session?room=1');
check('màn hình phòng hiện phiên ĐANG CHỤP, không phải phiên cũ',
  roomNow.body.session?.code === next.body.code,
  `${roomNow.body.session?.code} vs ${next.body.code}`);

console.log('\n--- Nhân viên đóng phiên của khách đã ghép xong ---');
const closed = await api(`/api/staff/sessions/${a.body.id}/close`, { method: 'POST' });
check('đóng được phiên', closed.status === 200, JSON.stringify(closed.body));

const freed = await api('/api/staff/rooms');
check('phòng 1 vẫn bận vì khách MỚI đang chụp',
  freed.body.rooms.find((r) => r.id === '1')?.busy === true);
check('không còn phiên nào đang ghép ở phòng 1',
  (freed.body.rooms.find((r) => r.id === '1')?.composing ?? []).length === 0);

console.log('\n--- Phiên đã đóng thì khách không truy cập nữa ---');
// Lay token cua phien da dong qua trang nhan vien
const detail = await api(`/api/staff/sessions/${a.body.id}`);
check('nhân viên vẫn xem lại được phiên đã đóng',
  detail.status === 200 && !!detail.body.token);

const guest = await api(`/api/s?t=${encodeURIComponent(tokenA)}`);
check('khách KHÔNG mở được QR của phiên đã đóng', guest.status === 404);

// Đừng để nhân viên chìa ra một mã QR chết rồi khách quét vào trang lỗi
const qrClosed = await api(`/api/staff/sessions/${a.body.id}/qr`);
check('không hiện lại QR của phiên đã đóng', qrClosed.status === 409,
  JSON.stringify(qrClosed.body));

console.log('\n--- Thời gian tạo / kết thúc ---');
const listed = await api('/api/staff/sessions');
const row = listed.body.sessions.find((x) => x.id === a.body.id);
check('có thời gian tạo phiên', typeof row?.createdAt === 'number' && row.createdAt > 0);
check('phiên đã đóng có thời gian kết thúc',
  typeof row?.doneAt === 'number' && row.doneAt >= row.createdAt,
  JSON.stringify({ createdAt: row?.createdAt, doneAt: row?.doneAt }));

const open2 = listed.body.sessions.find((x) => x.id === next.body.id);
check('phiên còn mở thì chưa có thời gian kết thúc', open2?.doneAt === null,
  JSON.stringify(open2?.doneAt));
check('thời gian kết thúc sau thời gian tạo',
  (row?.doneAt ?? 0) >= (row?.createdAt ?? 0));

/*
 * Dựng một khách "đang ghép ảnh ngoài quán" ở phòng 3 để kiểm tra nút hiện
 * lại QR trên giao diện. Không tạo mã mới cho phòng 3 — phòng phải còn TRỐNG
 * thì mấy kiểm tra bên dưới về nút chọn phòng mới còn đúng.
 */
const c3 = await mk('3');
await api('/api/room/claim', { method: 'POST', body: JSON.stringify({ room: '3', code: c3.body.code }) });
await api('/api/room/finish?room=3', { method: 'POST' });

console.log('\n--- Giao diện nhân viên ---');
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1100, height: 900 } });
await p.goto(`${BASE}/staff`);
await p.waitForSelector('.login');
await p.fill('input[type=password]', 't');
await p.click('.login button');
await p.waitForSelector('.rooms');
await p.waitForTimeout(600);

check('hiện thẻ trạng thái cho từng phòng',
  (await p.locator('.room-card').count()) === 3);
check('phòng bận có nút "Đóng phiên"',
  (await p.locator('.btn-close').count()) >= 1);
check('nút chọn phòng bận bị khoá',
  (await p.locator('.pkg:disabled').count()) >= 1);
await p.screenshot({ path: 'scratch/rooms-staff.png' });

/*
 * Nhân viên chìa lại QR cho khách đang ghép.
 *
 * Đây là đường thoát duy nhất sau khi màn hình phòng bỏ QR để nhận khách
 * mới — hỏng cái này là khách cũ mất ảnh.
 */
const qrBtn = p.locator('.composing button.link', { hasText: 'Hiện QR' }).first();
check('dòng "đang ghép ảnh" có nút hiện lại QR', (await qrBtn.count()) === 1);
await qrBtn.click();
await p.waitForSelector('.qr-pair img', { timeout: 5000 });
check('mở ra đủ hai mã QR (xem ảnh + ghép khung)',
  (await p.locator('.qr-pair img').count()) === 2);
await p.screenshot({ path: 'scratch/rooms-qr-lai.png' });
await p.locator('.qr-modal header button').click();
check('đóng được cửa sổ QR', (await p.locator('.qr-modal').count()) === 0);

// Dong het roi kiem lai
for (const r of (await api('/api/staff/rooms')).body.rooms) {
  if (r.busy) await api(`/api/staff/sessions/${r.session.id}/close`, { method: 'POST' });
}
await p.reload();
await p.waitForSelector('.rooms');
await p.waitForTimeout(800);
check('đóng hết thì mọi phòng hiện Trống',
  (await p.locator('.room-card.free').count()) === 3);
await p.screenshot({ path: 'scratch/rooms-all-free.png' });

await browser.close();
server.close();
(await import('../server/db.ts')).closeDb();
rmSync(dataDir, { recursive: true, force: true });
rmSync(captureRoot, { recursive: true, force: true });

console.log(fails.length ? `\nFAIL: ${fails.length} kiểm tra\n` : '\nOK — quy tắc mỗi phòng một phiên chạy đúng.\n');
process.exit(fails.length ? 1 : 0);
