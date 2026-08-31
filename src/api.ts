/** Lớp gọi API mỏng, dùng chung cho cả 3 giao diện mới. */

export type SessionInfo = {
  id: string;
  code: string;
  status: string;
  maxPhotos: number;
  room: string | null;
  note: string | null;
  createdAt: number;
  claimedAt: number | null;
  doneAt: number | null;
  expiresAt: number;
};

export type PhotoInfo = { id: string; seq: number; width: number; height: number };

export type CompositeInfo = {
  id: string;
  frameId: string;
  width: number;
  height: number;
  slug: string;
  createdAt: number;
};

export type QrPair = {
  viewUrl: string;
  composeUrl: string;
  view: string;
  compose: string;
};

export class ApiError extends Error {
  status: number;
  reason?: string;
  constructor(message: string, status: number, reason?: string) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    // Mất mạng giữa chừng — báo rõ thay vì để treo im lặng
    throw new ApiError('Mất kết nối tới máy chủ. Kiểm tra WiFi rồi thử lại.', 0);
  }
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() : null;
  if (!res.ok) {
    throw new ApiError(body?.error ?? `Lỗi ${res.status}`, res.status, body?.reason);
  }
  return body as T;
}

// ---- Nhân viên ----

export const staffMe = () =>
  req<{ staff: boolean; rooms: string[] }>('/api/staff/me');

export const staffLogin = (password: string) =>
  req<{ ok: true }>('/api/staff/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });

export const staffLogout = () =>
  req<{ ok: true }>('/api/staff/logout', { method: 'POST' });

export const staffSessions = () =>
  req<{ sessions: Array<SessionInfo & { photos: number; composites: number }> }>(
    '/api/staff/sessions',
  );

export type RoomStatus = {
  id: string;
  busy: boolean;
  session: { id: string; code: string; status: string } | null;
};

export const staffRooms = () =>
  req<{ rooms: RoomStatus[] }>('/api/staff/rooms');

export const createSession = (room: string, maxPhotos: number) =>
  req<{
    id: string; code: string; maxPhotos: number;
    room: string; captureDir: string | null;
  }>('/api/staff/sessions', {
    method: 'POST',
    body: JSON.stringify({ room, maxPhotos }),
  });

/** Đóng phiên -> phòng rảnh để nhận khách tiếp theo. */
export const closeSession = (id: string) =>
  req<{ ok: true }>(`/api/staff/sessions/${id}/close`, { method: 'POST' });

export const cancelSession = (id: string) =>
  req<{ ok: true }>(`/api/staff/sessions/${id}`, { method: 'DELETE' });

export const staffSessionDetail = (id: string) =>
  req<{
    session: SessionInfo;
    token: string;
    photos: PhotoInfo[];
    composites: CompositeInfo[];
  }>(`/api/staff/sessions/${id}`);

// ---- Phòng chụp ----

export const claimCode = (room: string, code: string) =>
  req<{ session: SessionInfo }>('/api/room/claim', {
    method: 'POST',
    body: JSON.stringify({ room, code }),
  });

export const roomSession = (room: string) =>
  req<{
    session: SessionInfo | null;
    photos?: PhotoInfo[];
    qr?: QrPair | null;
    locked?: boolean;
    /** Agent theo dõi thư mục có đang chạy cho phòng này không. */
    agent?: boolean;
    /** Đã cấu hình thư mục chụp chưa. */
    captureEnabled?: boolean;
    /** Đường dẫn thư mục của phiên — hiện cho nhân viên trỏ phần mềm Canon vào. */
    captureDir?: string | null;
  }>(`/api/room/session?room=${encodeURIComponent(room)}`);

export type IntakeResult = {
  found: number;
  added: number;
  total: number;
  skippedFull: number;
  failed: number;
  dir: string;
};

/** Quét thư mục của phiên và nạp ảnh — gọi khi khách bấm "Đã chụp xong". */
export const intakeRoom = (room: string) =>
  req<IntakeResult>(`/api/room/intake?room=${encodeURIComponent(room)}`, {
    method: 'POST',
  });

/**
 * Gửi một ảnh lên phiên đang mở.
 *
 * Giao diện KHÔNG dùng hàm này nữa (đã bỏ nút thêm ảnh tay) — giữ lại vì
 * agent theo dõi thư mục vẫn gọi cùng endpoint, và để test dùng được.
 */
export const capture = (room: string, file: File) =>
  req<{ photo: PhotoInfo; count: number; remaining: number }>(
    `/api/capture?room=${encodeURIComponent(room)}`,
    { method: 'POST', headers: { 'content-type': file.type }, body: file },
  );

export const finishRoom = (room: string) =>
  req<{ qr: QrPair }>(`/api/room/finish?room=${encodeURIComponent(room)}`, {
    method: 'POST',
  });

// ---- Khung ảnh ----

/**
 * Khung do server trả về.
 *
 * Cùng hình dạng với `Frame` ở src/core/types nên dùng thẳng được cho phần
 * render — chỉ khác là toạ độ ô đến từ database chứ không phải mã nguồn.
 */
export type ApiFrame = {
  id: string;
  label: string;
  slotCount: number;
  formatId: string;
  slots: Array<{ id: string; rect: { x: number; y: number; w: number; h: number } }>;
  overlaySrc: string;
  enabled: boolean;
  builtin: boolean;
  width: number;
  height: number;
  /** Kích thước in, inch. Có thì thắng formatId. */
  widthInch?: number;
  heightInch?: number;
};

/** Danh sách khung cho khách — chỉ khung đang bật. */
export const listFrames = () => req<{ frames: ApiFrame[] }>('/api/frames');

/** Danh sách đầy đủ cho nhân viên, gồm cả khung đang tắt. */
export const staffFrames = () => req<{ frames: ApiFrame[] }>('/api/staff/frames');

export type FrameAnalysis = {
  width: number;
  height: number;
  formatId: string;
  widthInch: number;
  heightInch: number;
  slots: Array<{ x: number; y: number; w: number; h: number }>;
};

/** Dò thử file khung mà chưa lưu, để nhân viên xem trước. */
export const analyzeFrame = (file: File) =>
  req<FrameAnalysis>('/api/staff/frames/analyze', {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: file,
  });

export const uploadFrame = (
  file: File,
  label: string,
  opts: {
    slots?: FrameAnalysis['slots']; formatId?: string;
    widthInch?: number; heightInch?: number;
  } = {},
) => {
  const q = new URLSearchParams({ label });
  if (opts.slots) q.set('slots', encodeURIComponent(JSON.stringify(opts.slots)));
  if (opts.formatId) q.set('format', opts.formatId);
  if (opts.widthInch) q.set('win', String(opts.widthInch));
  if (opts.heightInch) q.set('hin', String(opts.heightInch));
  return req<{ frame: ApiFrame }>(`/api/staff/frames?${q}`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: file,
  });
};

export const updateFrame = (
  id: string,
  patch: {
    label?: string; enabled?: boolean; slots?: FrameAnalysis['slots'];
    formatId?: string; widthInch?: number; heightInch?: number;
  },
) =>
  req<{ frame: ApiFrame }>(`/api/staff/frames/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });

export const deleteFrame = (id: string) =>
  req<{ ok: true }>(`/api/staff/frames/${encodeURIComponent(id)}`, { method: 'DELETE' });

// ---- Khách ----

export const guestSession = (token: string) =>
  req<{ session: SessionInfo; photos: PhotoInfo[]; composites: CompositeInfo[] }>(
    `/api/s?t=${encodeURIComponent(token)}`,
  );

/** URL ảnh preview (bản nhỏ) — dùng cho cả xem trước lẫn ghép khung. */
export const photoUrl = (id: string, token: string) =>
  `/media/previews/${id}?t=${encodeURIComponent(token)}`;

export const compositeUrl = (id: string, slug: string) =>
  `/media/strips/${id}?s=${encodeURIComponent(slug)}`;

export async function saveComposite(
  token: string,
  opts: { frameId: string; width: number; height: number; recipe: unknown; blob: Blob },
) {
  const q = new URLSearchParams({
    t: token,
    frame: opts.frameId,
    w: String(opts.width),
    h: String(opts.height),
    recipe: encodeURIComponent(JSON.stringify(opts.recipe)),
  });
  return req<{ composite: CompositeInfo }>(`/api/composites?${q}`, {
    method: 'POST',
    headers: { 'content-type': opts.blob.type || 'image/png' },
    body: opts.blob,
  });
}
