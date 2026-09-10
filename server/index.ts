import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { pathToFileURL } from 'node:url';
import QRCode from 'qrcode';

import { CONFIG, warnIfInsecure } from './config.ts';
import { getDb } from './db.ts';
import {
  createSession, claimSession, getByToken, activeForRoom, lastDoneForRoom,
  listSessions, setStatus, cancelSession, isLockedOut, getById,
  closeSession, busySession, sessionByAnyToken, openSessionsForRoom,
} from './session.ts';
import { addPhoto, listPhotos, getPhoto, countPhotos, previewName, CaptureError } from './capture.ts';
import { saveComposite, listComposites, getBySlug } from './composite.ts';
import { filePath, readFileFrom } from './storage.ts';
import {
  json, text, readBody, readJson, requireStaff, isStaff, checkPassword,
  makeStaffCookie, clearStaffCookie, rateLimit, clientIp, type Ctx,
} from './http.ts';
import {
  listFrames, readFrameImage, analyzeFrame, createFrame, updateFrame,
  deleteFrame, seedBuiltins,
} from './frames.ts';
import type { DetectedSlot } from './detect.ts';
import { renderFromOriginals, type Recipe } from './render.ts';
import { listPresets, createPreset, updatePreset, deletePreset } from './presets.ts';
import { runCleanup, cleanupTiers, purgeOlderThan, CLEANUP_TIERS } from './cleanup.ts';
import { intakeFromFolder, ensureCaptureDir, captureEnabled, captureDir } from './intake.ts';
import { diskInfo } from './disk.ts';
import { logLine, logError, recentLog } from './log.ts';

const DIST = resolve(process.cwd(), 'dist');

/**
 * Theo dõi agent còn sống hay không, theo từng phòng.
 * Chỉ giữ trong bộ nhớ — mất khi khởi động lại server là đúng, vì lúc đó
 * agent cũng sẽ ping lại ngay.
 */
const agentPing = new Map<string, number>();
const AGENT_TIMEOUT = 45_000;   // quá 45s không ping -> coi như đã tắt

function agentSeen(rooms: string[]): void {
  const t = Date.now();
  for (const r of rooms) agentPing.set(r, t);
}

const agentAlive = (room: string) =>
  Date.now() - (agentPing.get(room) ?? 0) < AGENT_TIMEOUT;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// Định tuyến
// ---------------------------------------------------------------------------

async function handleApi(ctx: Ctx): Promise<boolean> {
  const { url, req, res } = ctx;
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // ---- Nhân viên: đăng nhập ----
  if (path === '/api/staff/login' && method === 'POST') {
    if (!rateLimit(`login:${clientIp(req)}`, 10, 15 * 60_000)) {
      json(res, 429, { error: 'Thử quá nhiều lần, đợi một lát' });
      return true;
    }
    const body = await readJson<{ password?: string }>(req);
    if (!body.password || !checkPassword(body.password)) {
      json(res, 401, { error: 'Sai mật khẩu' });
      return true;
    }
    res.setHeader('set-cookie', makeStaffCookie());
    json(res, 200, { ok: true });
    return true;
  }

  if (path === '/api/staff/logout' && method === 'POST') {
    res.setHeader('set-cookie', clearStaffCookie());
    json(res, 200, { ok: true });
    return true;
  }

  if (path === '/api/staff/me') {
    json(res, 200, { staff: isStaff(req), rooms: CONFIG.rooms });
    return true;
  }

  /**
   * Agent báo còn sống. Nhờ vậy màn hình phòng biết ảnh sẽ tự về hay
   * phải thêm tay — thay vì để nhân viên đoán.
   */
  if (path === '/api/agent/ping' && method === 'POST') {
    const rooms = url.searchParams.get('rooms') ?? '';
    agentSeen(rooms.split(',').filter(Boolean));
    json(res, 200, { ok: true });
    return true;
  }

  /**
   * Kiểm tra sức khoẻ — KHÔNG cần đăng nhập.
   *
   * Tác vụ theo dõi và KIEM-TRA.bat phải trả lời được câu "server còn sống
   * không" trước khi có ai đăng nhập. Chỉ trả thông tin vô hại: không có
   * đường dẫn ổ đĩa, không có mật khẩu.
   */
  if (path === '/api/health') {
    const d = diskInfo();
    json(res, 200, {
      ok: true,
      uptimeSeconds: Math.round(process.uptime()),
      host: process.env.PHOTOBOOTH_HOST ?? `${lanAddress()}:${CONFIG.port}`,
      port: CONFIG.port,
      rooms: CONFIG.rooms,
      disk: { level: d.level, freeBytes: d.freeBytes, totalBytes: d.totalBytes },
    });
    return true;
  }

  // ---- Nhân viên: ổ đĩa và dọn dẹp ----

  /**
   * Thông tin ổ đĩa. Mặc định KHÔNG kèm bảng mốc dọn dẹp.
   *
   * Đèn báo trên thanh tiêu đề gọi endpoint này mỗi phút và chỉ cần mức cảnh
   * báo. Còn bảng mốc phải cộng dung lượng trong bảng photos/composites cho
   * từng mốc một, nên chỉ tính khi màn dọn dẹp thực sự được mở (?tiers=1).
   */
  if (path === '/api/staff/disk' && method === 'GET') {
    if (requireStaff(ctx)) return true;
    json(res, 200, {
      disk: diskInfo(),
      retentionDays: CONFIG.retentionDays,
      tiers: url.searchParams.get('tiers') === '1' ? cleanupTiers() : undefined,
    });
    return true;
  }

  /**
   * Nhân viên tự bấm dọn ảnh cũ hơn N ngày.
   *
   * Chỉ nhận đúng các mốc trong CLEANUP_TIERS, không cho truyền số tuỳ ý —
   * tránh việc gõ nhầm 0 rồi xoá sạch ảnh của khách còn đang chờ lấy.
   */
  if (path === '/api/staff/cleanup' && method === 'POST') {
    if (requireStaff(ctx)) return true;
    const body = await readJson<{ days?: number }>(req);
    const days = Number(body.days);
    if (!(CLEANUP_TIERS as readonly number[]).includes(days)) {
      json(res, 400, { error: 'Mốc dọn dẹp không hợp lệ' });
      return true;
    }
    const { purged } = purgeOlderThan(days);
    logLine(`Nhân viên dọn ảnh cũ hơn ${days} ngày -> đã xoá ${purged} phiên`);
    json(res, 200, { purged, disk: diskInfo(), tiers: cleanupTiers() });
    return true;
  }

  /** Mấy dòng log cuối — để chẩn đoán mà không cần mở File Explorer. */
  if (path === '/api/staff/log' && method === 'GET') {
    if (requireStaff(ctx)) return true;
    json(res, 200, { lines: recentLog(60) });
    return true;
  }

  // ---- Nhân viên: quản lý phiên ----
  if (path === '/api/staff/sessions' && method === 'GET') {
    if (requireStaff(ctx)) return true;
    // Dùng publicSession để tên trường khớp với client (room, maxPhotos...)
    // và KHÔNG lộ access_token ra danh sách.
    const rows = listSessions().map((s) => ({
      ...publicSession(s),
      photos: countPhotos(s.id),
      composites: listComposites(s.id).length,
    }));
    json(res, 200, { sessions: rows });
    return true;
  }

  if (path === '/api/staff/sessions' && method === 'POST') {
    if (requireStaff(ctx)) return true;
    const body = await readJson<{ maxPhotos?: number; note?: string; room?: string }>(req);
    const maxPhotos = Math.max(1, Math.min(100, Number(body.maxPhotos) || 8));
    const roomId = String(body.room ?? '');

    if (!CONFIG.rooms.includes(roomId)) {
      json(res, 400, { error: 'Chưa chọn phòng' });
      return true;
    }

    // Mỗi phòng chỉ một phiên tại một thời điểm. Phòng chỉ rảnh khi nhân viên
    // bấm "Đóng phiên" — không tự rảnh khi khách ghép xong.
    const busy = busySession(roomId);
    if (busy) {
      json(res, 409, {
        error: `Phòng ${roomId} đang có phiên (mã ${busy.code}). Đóng phiên đó trước khi tạo mã mới.`,
        reason: 'room_busy',
        busyCode: busy.code,
        busyId: busy.id,
      });
      return true;
    }

    const s = createSession({ maxPhotos, note: body.note, roomId });
    // Tao san thu muc chup de nhan vien tro phan mem Canon vao ngay
    const dir = ensureCaptureDir(s.code);
    json(res, 200, {
      id: s.id, code: s.code, maxPhotos: s.max_photos, room: roomId, captureDir: dir,
    });
    return true;
  }

  /** Nhân viên đóng phiên -> phòng rảnh để nhận khách tiếp theo. */
  if (path.match(/^\/api\/staff\/sessions\/[^/]+\/close$/) && method === 'POST') {
    if (requireStaff(ctx)) return true;
    const ok = closeSession(path.split('/')[4]);
    json(res, ok ? 200 : 409, ok ? { ok: true } : { error: 'Phiên không ở trạng thái đóng được' });
    return true;
  }

  /** Trạng thái bận/rảnh của từng phòng — trang nhân viên hiện cái này. */
  if (path === '/api/staff/rooms' && method === 'GET') {
    if (requireStaff(ctx)) return true;
    json(res, 200, {
      rooms: CONFIG.rooms.map((id) => {
        const b = busySession(id);
        // Khách đã ra khỏi buồng nhưng còn đang ghép ảnh ngoài quán.
        // Nhân viên cần thấy để biết còn phiên nào chưa đóng.
        const composing = openSessionsForRoom(id);
        return {
          id,
          busy: !!b,
          session: b ? { id: b.id, code: b.code, status: b.status } : null,
          composing: composing.map((c) => ({
            id: c.id, code: c.code, status: c.status,
          })),
        };
      }),
    });
    return true;
  }

  if (path.startsWith('/api/staff/sessions/') && method === 'DELETE') {
    if (requireStaff(ctx)) return true;
    cancelSession(path.split('/')[4]);
    json(res, 200, { ok: true });
    return true;
  }

  // Nhân viên xem chi tiết một phiên (lấy hộ khách quên tải)
  if (path.match(/^\/api\/staff\/sessions\/[^/]+$/) && method === 'GET') {
    if (requireStaff(ctx)) return true;
    const s = getById(path.split('/')[4]);
    if (!s) { json(res, 404, { error: 'Không tìm thấy' }); return true; }
    json(res, 200, {
      session: publicSession(s),
      token: s.access_token,       // NV cần token để mở trang xem
      photos: listPhotos(s.id).map(publicPhoto),
      composites: listComposites(s.id).map(publicComposite),
    });
    return true;
  }

  // ---- Khung ảnh ----

  /*
   * Danh sách khung cho KHÁCH: chỉ khung đang bật.
   * Không cần đăng nhập — khách phải xem được để chọn.
   */
  if (path === '/api/frames' && method === 'GET') {
    json(res, 200, { frames: listFrames({ onlyEnabled: true }) });
    return true;
  }

  // File PNG của khung. Ai xem được danh sách thì xem được ảnh.
  if (path.match(/^\/api\/frames\/[^/]+\/image$/) && method === 'GET') {
    const data = readFrameImage(path.split('/')[3]);
    if (!data) { json(res, 404, { error: 'Không tìm thấy khung' }); return true; }
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': data.length,
      // Nội dung khung không đổi sau khi tạo; sửa khung thì id đổi theo
      'cache-control': 'public, max-age=86400',
    });
    res.end(data);
    return true;
  }

  // Danh sách đầy đủ cho NHÂN VIÊN, gồm cả khung đang tắt
  if (path === '/api/staff/frames' && method === 'GET') {
    if (requireStaff(ctx)) return true;
    json(res, 200, { frames: listFrames() });
    return true;
  }

  /*
   * Dò thử một file khung mà chưa lưu — để nhân viên xem trước kết quả.
   * Nhận PNG thô ở body giống /api/composites, không cần bộ phân tích
   * multipart.
   */
  if (path === '/api/staff/frames/analyze' && method === 'POST') {
    if (requireStaff(ctx)) return true;
    const png = await readBody(req);
    if (png.length === 0) { json(res, 400, { error: 'Chưa chọn file' }); return true; }
    try {
      json(res, 200, await analyzeFrame(png));
    } catch (e) {
      json(res, 400, { error: e instanceof Error ? e.message : 'Không đọc được file khung' });
    }
    return true;
  }

  if (path === '/api/staff/frames' && method === 'POST') {
    if (requireStaff(ctx)) return true;
    const png = await readBody(req);
    if (png.length === 0) { json(res, 400, { error: 'Chưa chọn file' }); return true; }

    const label = url.searchParams.get('label') ?? '';
    const slotsRaw = url.searchParams.get('slots');
    const formatId = url.searchParams.get('format') ?? undefined;
    const wIn = Number(url.searchParams.get('win'));
    const hIn = Number(url.searchParams.get('hin'));

    let slots: DetectedSlot[] | undefined;
    if (slotsRaw) {
      try { slots = JSON.parse(decodeURIComponent(slotsRaw)); } catch { /* dò lại */ }
    }

    try {
      const f = await createFrame({
        label, png, slots, formatId,
        widthInch: wIn || undefined,
        heightInch: hIn || undefined,
      });
      json(res, 200, { frame: f });
    } catch (e) {
      json(res, 400, { error: e instanceof Error ? e.message : 'Không lưu được khung' });
    }
    return true;
  }

  if (path.match(/^\/api\/staff\/frames\/[^/]+$/) && method === 'PATCH') {
    if (requireStaff(ctx)) return true;
    const body = await readJson<{
      label?: string; enabled?: boolean; slots?: DetectedSlot[]; formatId?: string;
      widthInch?: number; heightInch?: number;
    }>(req);
    try {
      const f = updateFrame(path.split('/')[4], body);
      if (!f) { json(res, 404, { error: 'Không tìm thấy khung' }); return true; }
      json(res, 200, { frame: f });
    } catch (e) {
      json(res, 400, { error: e instanceof Error ? e.message : 'Không sửa được khung' });
    }
    return true;
  }

  if (path.match(/^\/api\/staff\/frames\/[^/]+$/) && method === 'DELETE') {
    if (requireStaff(ctx)) return true;
    const ok = deleteFrame(path.split('/')[4]);
    if (!ok) { json(res, 404, { error: 'Không tìm thấy khung' }); return true; }
    json(res, 200, { ok: true });
    return true;
  }

  // ---- Bộ chỉnh màu ----

  /* Danh sách cho KHÁCH: chỉ bộ đang bật, không cần đăng nhập. */
  if (path === '/api/color-presets' && method === 'GET') {
    json(res, 200, { presets: listPresets({ onlyEnabled: true }) });
    return true;
  }

  if (path === '/api/staff/color-presets' && method === 'GET') {
    if (requireStaff(ctx)) return true;
    json(res, 200, { presets: listPresets() });
    return true;
  }

  if (path === '/api/staff/color-presets' && method === 'POST') {
    if (requireStaff(ctx)) return true;
    const body = await readJson<{ label?: string; params?: unknown }>(req);
    try {
      json(res, 200, { preset: createPreset(String(body.label ?? ''), body.params) });
    } catch (e) {
      json(res, 400, { error: e instanceof Error ? e.message : 'Không lưu được' });
    }
    return true;
  }

  if (path.match(/^\/api\/staff\/color-presets\/[^/]+$/) && method === 'PATCH') {
    if (requireStaff(ctx)) return true;
    const body = await readJson<{ label?: string; params?: unknown; enabled?: boolean }>(req);
    try {
      const p = updatePreset(path.split('/')[4], body);
      if (!p) { json(res, 404, { error: 'Không tìm thấy' }); return true; }
      json(res, 200, { preset: p });
    } catch (e) {
      json(res, 400, { error: e instanceof Error ? e.message : 'Không sửa được' });
    }
    return true;
  }

  if (path.match(/^\/api\/staff\/color-presets\/[^/]+$/) && method === 'DELETE') {
    if (requireStaff(ctx)) return true;
    const ok = deletePreset(path.split('/')[4]);
    json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Không tìm thấy' });
    return true;
  }

  // ---- Phòng chụp ----
  if (path === '/api/room/claim' && method === 'POST') {
    const body = await readJson<{ room?: string; code?: string }>(req);
    const room = String(body.room ?? '');
    const code = String(body.code ?? '');
    if (!CONFIG.rooms.includes(room)) {
      json(res, 400, { error: 'Phòng không hợp lệ' });
      return true;
    }
    const r = claimSession(room, code);
    if (!r.ok) {
      json(res, r.reason === 'locked' ? 429 : 401, {
        error: r.reason === 'locked'
          ? 'Nhập sai quá nhiều lần. Vui lòng đợi 1 phút.'
          : 'Mã không đúng hoặc đã hết hạn',
        reason: r.reason,
      });
      return true;
    }
    json(res, 200, { session: publicSession(r.session) });
    return true;
  }

  if (path === '/api/room/session' && method === 'GET') {
    const room = url.searchParams.get('room') ?? '';
    if (!CONFIG.rooms.includes(room)) {
      json(res, 400, { error: 'Phòng không hợp lệ' });
      return true;
    }
    /*
     * Ưu tiên phiên ĐANG CHỤP; không có thì lấy phiên vừa chụp xong để còn
     * hiện QR. Buồng đã rảnh rồi nhưng khách vừa xong vẫn cần quét mã.
     */
    const s = activeForRoom(room) ?? lastDoneForRoom(room);
    if (!s) {
      json(res, 200, {
        session: null,
        locked: isLockedOut(room),
        agent: agentAlive(room),
        captureEnabled: captureEnabled(),
      });
      return true;
    }
    const done = s.status === 'done' || s.status === 'composed';
    json(res, 200, {
      session: publicSession(s),
      photos: listPhotos(s.id).map(publicPhoto),
      agent: agentAlive(room),
      captureEnabled: captureEnabled(),
      captureDir: captureEnabled() ? captureDir(s.code) : null,
      qr: done ? await makeQr(ctx, s.access_token) : null,
      /* Buồng đã sẵn sàng nhận khách mới — màn hình phòng nói rõ cho nhân viên */
      roomFree: done,
    });
    return true;
  }

  /**
   * Nhận ảnh. HỢP ĐỒNG dùng chung cho upload thủ công (giai đoạn này) và
   * app PC điều khiển Canon (sau này) — chỉ khác tham số `source`.
   */
  if (path === '/api/capture' && method === 'POST') {
    const room = url.searchParams.get('room') ?? '';
    const s = activeForRoom(room);
    if (!s) { json(res, 409, { error: 'Phòng chưa mở khoá' }); return true; }

    try {
      const data = await readBody(req);
      const source = url.searchParams.get('source') === 'agent' ? 'agent' : 'manual';
      const r = await addPhoto(s, data, source);
      json(res, 200, { photo: publicPhoto(r.photo), count: r.count, remaining: r.remaining });
    } catch (err) {
      if (err instanceof CaptureError) {
        json(res, err.code === 'full' ? 409 : 400, { error: err.message, reason: err.code });
      } else {
        json(res, 400, { error: String((err as Error).message) });
      }
    }
    return true;
  }

  /**
   * Khách bấm "Đã chụp xong" — quét thư mục của phiên và nạp ảnh.
   *
   * Gọi lại được nhiều lần (nút "Quét lại") mà không nhân đôi ảnh, vì
   * intakeFromFolder bỏ qua file đã nạp.
   */
  if (path === '/api/room/intake' && method === 'POST') {
    const room = url.searchParams.get('room') ?? '';
    const s = activeForRoom(room);
    if (!s) { json(res, 409, { error: 'Phòng chưa mở khoá' }); return true; }
    if (!captureEnabled()) {
      json(res, 400, {
        error: 'Chưa cấu hình thư mục chụp (PHOTOBOOTH_CAPTURE)',
        reason: 'not_configured',
      });
      return true;
    }

    try {
      const r = await intakeFromFolder(s);
      json(res, 200, r);
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
    return true;
  }

  if (path === '/api/room/finish' && method === 'POST') {
    const room = url.searchParams.get('room') ?? '';
    const s = activeForRoom(room);
    if (!s) { json(res, 409, { error: 'Phòng chưa mở khoá' }); return true; }
    setStatus(s.id, 'done');
    json(res, 200, { qr: await makeQr(ctx, s.access_token) });
    return true;
  }

  // ---- Khách (xác thực bằng token trong QR) ----
  if (path === '/api/s' && method === 'GET') {
    const s = getByToken(url.searchParams.get('t') ?? '');
    if (!s) { json(res, 404, { error: 'Liên kết không hợp lệ hoặc đã hết hạn' }); return true; }
    json(res, 200, {
      session: publicSession(s),
      photos: listPhotos(s.id).map(publicPhoto),
      composites: listComposites(s.id).map(publicComposite),
    });
    return true;
  }

  if (path === '/api/composites' && method === 'POST') {
    const s = getByToken(url.searchParams.get('t') ?? '');
    if (!s) { json(res, 404, { error: 'Liên kết không hợp lệ' }); return true; }

    const frameId = url.searchParams.get('frame') ?? 'unknown';
    const width = Number(url.searchParams.get('w')) || 0;
    const height = Number(url.searchParams.get('h')) || 0;
    const recipeRaw = url.searchParams.get('recipe') ?? '{}';
    const data = await readBody(req);
    if (data.length === 0) { json(res, 400, { error: 'Không có dữ liệu ảnh' }); return true; }

    let recipe: unknown = {};
    try { recipe = JSON.parse(decodeURIComponent(recipeRaw)); } catch { /* giữ {} */ }

    /*
     * Dựng lại từ ẢNH GỐC máy chụp.
     *
     * Điện thoại ghép từ bản preview 1400px (bắt buộc, vì ảnh gốc 24MP giải
     * nén hết ~92MB RAM mỗi tấm và Safari sẽ sập). Server không vướng giới hạn
     * đó nên dựng lại đúng tấm ấy ở độ nét tối đa của máy ảnh.
     *
     * Hỏng ở bất kỳ khâu nào thì GIỮ bản khách gửi lên — khách luôn có ảnh,
     * cùng lắm là kém nét hơn chứ không mất trắng.
     */
    let finalData = data;
    let finalW = width;
    let finalH = height;
    try {
      const hi = await renderFromOriginals(s, recipe as Recipe);
      if (hi) {
        finalData = hi.data;
        finalW = hi.width;
        finalH = hi.height;
      }
    } catch (err) {
      console.error('Không dựng lại được ảnh nét từ ảnh gốc:', err);
    }

    const c = await saveComposite(s, {
      frameId, data: finalData, width: finalW, height: finalH, recipe,
    });
    json(res, 200, { composite: publicComposite(c) });
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Phục vụ ảnh
// ---------------------------------------------------------------------------

/**
 * Ảnh chỉ phục vụ khi có token đúng của phiên (hoặc là nhân viên).
 * Luôn kiểm tra ảnh THUỘC phiên của token — không tin session id từ client.
 */
async function handleMedia(ctx: Ctx): Promise<boolean> {
  const { url, req, res } = ctx;
  const m = url.pathname.match(/^\/media\/(previews|originals|strips)\/([^/]+)$/);
  if (!m) return false;

  const [, bucket, id] = m;
  const token = url.searchParams.get('t') ?? '';
  const session = token ? getByToken(token) : null;

  if (bucket === 'strips') {
    // Ảnh ghép mở được bằng token phiên HOẶC slug chia sẻ
    const slug = url.searchParams.get('s');
    const found = slug ? getBySlug(slug) : null;
    const target = found
      ? found
      : session
        ? (() => {
            const c = listComposites(session.id).find((x) => x.id === id);
            return c ? { composite: c, session } : null;
          })()
        : null;
    if (!target || (slug && target.composite.id !== id && found?.composite.id !== id)) {
      json(res, 404, { error: 'Không tìm thấy' });
      return true;
    }
    sendFile(res, filePath(target.session.dir, 'strips', target.composite.filename));
    return true;
  }

  const staff = isStaff(req);
  if (!session && !staff) { json(res, 401, { error: 'Không có quyền' }); return true; }

  /*
   * Nhân viên xem được MỌI phiên, kể cả phiên đã đóng — vì getByToken từ chối
   * phiên 'closed', nếu chỉ dựa vào nó thì nhân viên mất quyền xem đúng những
   * phiên mình vừa đóng, tức là không lấy hộ khách được nữa.
   */
  const owner = session ?? (staff ? sessionByAnyToken(token) : null);
  if (!owner) { json(res, 404, { error: 'Không tìm thấy' }); return true; }

  const photo = getPhoto(owner.id, id);
  if (!photo) { json(res, 404, { error: 'Không tìm thấy' }); return true; }

  const name = bucket === 'previews' ? previewName(photo) : photo.filename;
  sendFile(res, filePath(owner.dir, bucket as 'originals' | 'previews', name));
  return true;
}

function sendFile(res: import('node:http').ServerResponse, abs: string): void {
  if (!existsSync(abs)) { json(res, 404, { error: 'File không tồn tại' }); return; }
  const stat = statSync(abs);
  const ext = extname(abs).toLowerCase();

  /*
   * HTML KHÔNG được cache: tên file cố định (staff.html, room.html...) nên
   * trình duyệt giữ bản cũ sau mỗi lần build, và người dùng thấy giao diện cũ
   * dù server đã cập nhật. Đây là lỗi rất khó nhận ra vì "server chạy đúng".
   *
   * File trong /assets/ thì ngược lại — tên có mã băm, đổi nội dung là đổi tên,
   * nên cache lâu được và còn nên cache lâu.
   */
  const isHtml = ext === '.html';
  const hashed = abs.includes(`${sep}assets${sep}`);

  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': isHtml
      ? 'no-cache, must-revalidate'
      : hashed
        ? 'public, max-age=31536000, immutable'
        : 'private, max-age=3600',
    'referrer-policy': 'no-referrer',
  });
  const stream = createReadStream(abs);
  /*
   * BẮT BUỘC phải có listener 'error'.
   *
   * existsSync ở trên chỉ đúng tại đúng thời điểm kiểm tra. Ngay sau đó job
   * dọn dẹp có thể xoá đúng thư mục này (khách đang tải ảnh lúc dọn dẹp chạy),
   * ổ rời có thể bị rút, phần mềm diệt virus có thể đang giữ file. Stream lỗi
   * mà không ai nghe thì Node coi là uncaught exception và THOÁT CẢ TIẾN
   * TRÌNH — mất server giữa buổi bán hàng chỉ vì một file ảnh.
   */
  stream.on('error', (err) => {
    logError(`Không đọc được file ${abs}`, err);
    res.destroy();
  });
  stream.pipe(res);
}

// ---------------------------------------------------------------------------
// Chuyển đổi cho client (không bao giờ lộ access_token qua danh sách)
// ---------------------------------------------------------------------------

const publicSession = (s: ReturnType<typeof getById> & object) => ({
  id: s.id,
  code: s.code,
  status: s.status,
  maxPhotos: s.max_photos,
  room: s.room_id,
  note: s.note,
  createdAt: s.created_at,
  /** Lúc khách nhập mã ở phòng — null nếu chưa ai dùng mã. */
  claimedAt: s.claimed_at,
  /** Lúc phiên kết thúc (nhân viên đóng) — null nếu còn đang mở. */
  doneAt: s.done_at,
  expiresAt: s.expires_at,
});

const publicPhoto = (p: import('./capture.ts').Photo) => ({
  id: p.id,
  seq: p.seq,
  width: p.width,
  height: p.height,
});

const publicComposite = (c: import('./composite.ts').Composite) => ({
  id: c.id,
  frameId: c.frame_id,
  width: c.width,
  height: c.height,
  slug: c.share_slug,
  createdAt: c.created_at,
});

/** Địa chỉ LAN để nhúng vào QR — khách quét phải ra IP máy chủ, không phải localhost. */
/**
 * Card mạng ẢO cần bỏ qua khi đi tìm địa chỉ LAN.
 *
 * Vì sao đây là chỗ nguy hiểm nhất trong file: mã QR đưa cho khách được dựng
 * từ địa chỉ này. Máy nào có cài WSL, Docker, VirtualBox hay VPN đều mọc thêm
 * card ảo (172.x, 192.168.56.x). Chọn nhầm card thì QR trỏ vào nơi điện thoại
 * khách không bao giờ tới được — trong khi trang quản lý trên máy chủ vẫn mở
 * bình thường, nên không ai phát hiện ra cho tới khi khách phàn nàn.
 */
const VIRTUAL_NIC =
  /vethernet|wsl|hyper-v|virtualbox|vmware|docker|loopback|tailscale|zerotier|tap-|tun|bluetooth|npcap/i;

/**
 * Chấm điểm địa chỉ theo mức "giống mạng LAN của quán".
 * 192.168.x là kiểu router gia đình/quán cà phê hay dùng nhất nên ưu tiên cao.
 */
function lanScore(addr: string): number {
  if (addr.startsWith('192.168.')) return 3;
  if (addr.startsWith('10.')) return 2;
  const m = addr.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return 1;
  return 0;
}

export function lanAddress(): string {
  if (process.env.PHOTOBOOTH_HOST) return process.env.PHOTOBOOTH_HOST;

  const found: Array<{ addr: string; score: number }> = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_NIC.test(name)) continue;
    for (const ni of list ?? []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      // 169.254.x: Windows tự gán khi xin DHCP thất bại -> không ai tới được
      if (ni.address.startsWith('169.254.')) continue;
      found.push({ addr: ni.address, score: lanScore(ni.address) });
    }
  }
  found.sort((a, b) => b.score - a.score);
  return found[0]?.addr ?? 'localhost';
}

async function makeQr(ctx: Ctx, token: string) {
  const host = process.env.PHOTOBOOTH_HOST ?? `${lanAddress()}:${CONFIG.port}`;
  const view = `http://${host}/v/${token}`;
  const compose = `http://${host}/c/${token}`;
  const opts = { margin: 1, width: 320 } as const;
  return {
    viewUrl: view,
    composeUrl: compose,
    view: await QRCode.toDataURL(view, opts),
    compose: await QRCode.toDataURL(compose, opts),
  };
}

// ---------------------------------------------------------------------------
// File tĩnh — mỗi vai trò một entry point riêng
// ---------------------------------------------------------------------------

/*
 * Ba giao diện: phòng, nhân viên, khách.
 * Mọi đường dẫn khác (kể cả "/") về trang nhân viên — không còn editor
 * độc lập, vì nó không thuộc luồng vận hành nào.
 */
function entryFor(pathname: string): string {
  if (pathname.startsWith('/room')) return 'room.html';
  if (
    pathname.startsWith('/c/') ||
    pathname.startsWith('/v/') ||
    pathname.startsWith('/s/')
  ) return 'studio.html';
  return 'staff.html';
}

function serveStatic(ctx: Ctx): void {
  const { url, res } = ctx;
  const p = url.pathname;

  // File thật (js/css/ảnh khung...)
  if (p !== '/' && !p.endsWith('/')) {
    const abs = join(DIST, p);
    if (abs.startsWith(DIST) && existsSync(abs) && statSync(abs).isFile()) {
      sendFile(res, abs);
      return;
    }
  }

  const html = join(DIST, entryFor(p));
  if (!existsSync(html)) {
    text(res, 503, 'Chưa build giao diện. Chạy: npm run build');
    return;
  }
  sendFile(res, html);
}

// ---------------------------------------------------------------------------

/**
 * Lưới an toàn cấp tiến trình.
 *
 * Đường xử lý request đã có try/catch riêng (xem createServer bên dưới),
 * nhưng lỗi sinh ra NGOÀI đường đó — trong stream, trong timer, trong callback
 * của thư viện — vẫn giết cả server.
 *
 * Ở đây chọn GHI LOG RỒI CHẠY TIẾP thay vì thoát, ngược với lời khuyên chung
 * cho server web. Lý do: máy này là thiết bị đặt ở quán. Chết 5 phút chờ tác
 * vụ theo dõi bật lại là mất khách thật, còn chạy tiếp sau một lỗi lẻ thì gần
 * như luôn an toàn hơn — mỗi request tự cô lập trạng thái của nó, và SQLite
 * ghi theo giao dịch nên không để lại dữ liệu nửa vời.
 *
 * CHỈ gọi khi chạy như tiến trình chính (xem cuối file), KHÔNG gọi trong
 * start(): các script kiểm chứng cũng gọi start(), và nếu bọc luôn cho chúng
 * thì một lỗi bất ngờ trong script sẽ bị ghi log rồi bỏ qua — script vẫn báo
 * "OK". Đúng chỗ đó thì fail-fast mới là hành vi cần.
 */
function installProcessGuards(): void {
  process.on('uncaughtException', (err) => logError('Lỗi không bắt được', err));
  process.on('unhandledRejection', (reason) => logError('Promise bị bỏ lỡ', reason));
}

export function start(port = CONFIG.port) {
  warnIfInsecure();
  getDb();
  // Lần chạy đầu: đưa 6 khung dựng sẵn vào database để nhân viên quản lý
  // chung một chỗ với khung tự tải lên.
  seedBuiltins();
  runCleanup();
  setInterval(runCleanup, 6 * 60 * 60 * 1000).unref();

  const server = createServer(async (req, res) => {
    const ctx: Ctx = {
      req,
      res,
      url: new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`),
    };
    try {
      if (await handleApi(ctx)) return;
      if (await handleMedia(ctx)) return;
      serveStatic(ctx);
    } catch (err) {
      console.error('Lỗi xử lý', ctx.url.pathname, err);
      if (!res.headersSent) json(res, 500, { error: 'Lỗi máy chủ' });
      else res.end();
    }
  });

  /*
   * Cổng bị chiếm là lỗi hay gặp nhất lúc khởi động: lần chạy trước chưa tắt
   * hẳn, hoặc IIS/Skype đang giữ cổng. Không bắt ở đây thì Node ném
   * EADDRINUSE ra ngoài, tiến trình chết im lặng, và tác vụ theo dõi cứ bật
   * lại rồi chết lại mỗi 5 phút suốt cả ngày mà không ai hiểu vì sao.
   */
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logLine(`Cổng ${port} đang bị chương trình khác dùng — server không chạy được`);
      console.error(
        `\n  KHÔNG CHẠY ĐƯỢC: cổng ${port} đang bị chương trình khác dùng.` +
          `\n  Cách xử lý: chạy lại CAI-DAT.bat, đổi Cổng thành ${port + 5}.\n`,
      );
    } else {
      logError('Lỗi máy chủ', err);
    }
    process.exit(1);
  });

  server.listen(port, () => {
    // PHOTOBOOTH_HOST có thể đã kèm sẵn cổng -> không thêm lần nữa
    const host = process.env.PHOTOBOOTH_HOST ?? `${lanAddress()}:${port}`;
    console.log(`\n  Photo Booth Studio đang chạy`);
    console.log(`  Dữ liệu:    ${CONFIG.dataDir}`);
    console.log(`  Nhân viên:  http://${host}/staff`);
    for (const r of CONFIG.rooms) {
      console.log(`  Phòng ${r}:    http://${host}/room?p=${r}`);
    }
    console.log('');
  });
  return server;
}

// Chạy trực tiếp: node --experimental-strip-types server/index.ts
//
// Dùng pathToFileURL chứ không tự ghép chuỗi: trên Windows import.meta.url là
// "file:///E:/..." (ba dấu gạch) còn ghép tay ra "file://E:/..." (hai dấu),
// không bao giờ khớp -> server im lặng thoát ngay mà không báo gì.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  installProcessGuards();
  start();
}
