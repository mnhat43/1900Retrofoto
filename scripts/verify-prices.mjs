import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'pb-gia-'));
process.env.PHOTOBOOTH_DATA = dataDir;
process.env.PHOTOBOOTH_PASSWORD = 't';
process.env.PHOTOBOOTH_PORT = '8395';
process.env.PHOTOBOOTH_HOST = '127.0.0.1:8395';

const { start } = await import('../server/index.ts');
const server = start(8395);
await new Promise((r) => setTimeout(r, 400));
const BASE = 'http://127.0.0.1:8395';

let cookie = '';
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}), ...(cookie ? { cookie } : {}) },
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const fails = [];
const check = (n, ok, x = '') => { console.log(ok ? `  ok   ${n}` : `  FAIL ${n} ${x}`); if (!ok) fails.push(n); };

console.log('\n--- Goi gia ---');
await api('/api/staff/login', { method: 'POST', body: JSON.stringify({ password: 't' }) });

let r = await api('/api/staff/prices');
check('ban dau chua co goi nao', r.body.prices?.length === 0);

r = await api('/api/staff/prices', { method: 'POST', body: JSON.stringify({ label: 'Goi co ban', amount: 100000 }) });
const g1 = r.body.price;
check('tao duoc goi', r.status === 200 && g1?.amount === 100000, JSON.stringify(r.body));

r = await api('/api/staff/prices', { method: 'POST', body: JSON.stringify({ label: 'Goi VIP', amount: 250000 }) });
const g2 = r.body.price;
check('tao goi thu hai', r.status === 200 && g2?.amount === 250000);

r = await api('/api/staff/prices', { method: 'POST', body: JSON.stringify({ label: '', amount: 50000 }) });
check('khong cho ten rong', r.status === 400, JSON.stringify(r.body));

r = await api('/api/staff/prices', { method: 'POST', body: JSON.stringify({ label: 'Am', amount: -5 }) });
check('khong cho gia am', r.status === 400);

r = await api('/api/staff/prices', { method: 'POST', body: JSON.stringify({ label: 'Qua to', amount: 999999999 }) });
check('chan gia phi ly (go nham so 0)', r.status === 400);

r = await api('/api/staff/prices', { method: 'POST', body: JSON.stringify({ label: 'Le', amount: 99999.7 }) });
check('gia le lam tron thanh so nguyen', r.body.price?.amount === 100000, String(r.body.price?.amount));

console.log('\n--- Tao phien co gia ---');
r = await api('/api/staff/sessions', { method: 'POST', body: JSON.stringify({ room: '2', priceId: g1.id }) });
const s1 = r.body;
check('tao phien kem goi', r.status === 200 && !!s1.code, JSON.stringify(r.body).slice(0, 80));

r = await api('/api/staff/sessions', { method: 'POST', body: JSON.stringify({ room: '3' }) });
const s2 = r.body;
check('tao phien KHONG goi cung duoc', r.status === 200 && !!s2.code);

console.log('\n--- Thong ke hom nay ---');
r = await api('/api/staff/stats');
check('lay duoc thong ke', r.status === 200, JSON.stringify(r.body).slice(0, 60));
check('co 2 phien hom nay', r.body.sessions?.length === 2, String(r.body.sessions?.length));
check('tong tien = 100.000 (chi cong phien co gia)', r.body.total === 100000, String(r.body.total));
check('dem dung so phien chua co gia', r.body.missing === 1, String(r.body.missing));

const coGia = r.body.sessions.find((x) => x.code === s1.code);
check('phien co gia tra ve dung so tien', coGia?.priceAmount === 100000, String(coGia?.priceAmount));
check('phien co gia tra ve ten goi', coGia?.priceLabel === 'Goi co ban', String(coGia?.priceLabel));
const khongGia = r.body.sessions.find((x) => x.code === s2.code);
check('phien khong goi -> priceAmount null, KHONG phai 0', khongGia?.priceAmount === null, String(khongGia?.priceAmount));

console.log('\n--- Sua gia sau khi tao ---');
r = await api(`/api/staff/sessions/${s2.id}/price`, { method: 'POST', body: JSON.stringify({ priceId: g2.id }) });
check('sua duoc gia phien da tao', r.status === 200, JSON.stringify(r.body));
r = await api('/api/staff/stats');
check('tong tien cap nhat theo gia moi', r.body.total === 350000, String(r.body.total));
check('khong con phien thieu gia', r.body.missing === 0, String(r.body.missing));

r = await api(`/api/staff/sessions/${s2.id}/price`, { method: 'POST', body: JSON.stringify({ priceId: null }) });
check('go gia ra duoc', r.status === 200);
r = await api('/api/staff/stats');
check('go gia xong tong giam lai', r.body.total === 100000, String(r.body.total));

console.log('\n--- Doanh thu cu khong doi khi sua goi ---');
await api(`/api/staff/prices/${g1.id}`, { method: 'PATCH', body: JSON.stringify({ amount: 999000 }) });
r = await api('/api/staff/stats');
check('sua GOI khong lam doi doanh thu DA GHI', r.body.total === 100000, String(r.body.total));

await api(`/api/staff/prices/${g1.id}`, { method: 'DELETE' });
r = await api('/api/staff/stats');
check('XOA goi cung khong lam doi doanh thu da ghi', r.body.total === 100000, String(r.body.total));

console.log('\n--- Ngay khac ---');
r = await api('/api/staff/stats?day=2020-01-01');
check('ngay khong co phien -> rong, tong 0', r.body.sessions?.length === 0 && r.body.total === 0);
check('danh sach ngay co du lieu', Array.isArray(r.body.days) && r.body.days.length >= 1, JSON.stringify(r.body.days));

server.close();
await new Promise((r) => setTimeout(r, 300));
try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
console.log(fails.length ? `\n${fails.length} loi\n` : '\nTat ca deu dat\n');
process.exit(fails.length ? 1 : 0);
