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

/**
 * Tình trạng server. Không cần đăng nhập — KIEM-TRA.bat cũng gọi đúng đường
 * này, và trang nhân viên đọc `version` để hiện bản đang chạy.
 */
export const health = () =>
  req<{ ok: true; version: string; uptimeSeconds: number; host: string }>(
    '/api/health',
  );

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
  /** Còn người đang chụp trong buồng. */
  busy: boolean;
  session: { id: string; code: string; status: string } | null;
  /** Khách đã ra khỏi buồng nhưng còn đang ghép ảnh ngoài quán. */
  composing?: Array<{ id: string; code: string; status: string }>;
};

export const staffRooms = () =>
  req<{ rooms: RoomStatus[] }>('/api/staff/rooms');

/**
 * Tạo phiên cho một phòng.
 *
 * Không gửi `maxPhotos`: trần ảnh lấy từ thiết lập chung của quán, nhân viên
 * không chọn từng phiên nữa (xem `staffSettings`).
 */
export const createSession = (room: string) =>
  req<{
    id: string; code: string; maxPhotos: number;
    room: string; captureDir: string | null;
  }>('/api/staff/sessions', {
    method: 'POST',
    body: JSON.stringify({ room }),
  });

export type StaffSettings = {
  /** Trần ảnh áp cho các phiên tạo mới. */
  maxPhotosPerSession: number;
  maxPhotosMin: number;
  maxPhotosMax: number;
};

export const staffSettings = () => req<StaffSettings>('/api/staff/settings');

/** Trả về giá trị server đã thực sự lưu. */
export const saveStaffSettings = (maxPhotosPerSession: number) =>
  req<{ maxPhotosPerSession: number }>('/api/staff/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ maxPhotosPerSession }),
  });

/** Đóng phiên -> phòng rảnh để nhận khách tiếp theo. */
export const closeSession = (id: string) =>
  req<{ ok: true }>(`/api/staff/sessions/${id}/close`, { method: 'POST' });

export const cancelSession = (id: string) =>
  req<{ ok: true }>(`/api/staff/sessions/${id}`, { method: 'DELETE' });

/**
 * Lấy lại hai mã QR của một phiên để chìa cho khách quét.
 *
 * Gọi theo yêu cầu chứ không kèm sẵn trong `staffRooms` — ảnh QR là data-URL
 * khá nặng so với nhịp đọc lại mỗi 4 giây của trang nhân viên.
 */
export const staffSessionQr = (id: string) =>
  req<{ code: string; status: string; qr: QrPair }>(`/api/staff/sessions/${id}/qr`);

export const staffSessionDetail = (id: string) =>
  req<{
    session: SessionInfo;
    token: string;
    photos: PhotoInfo[];
    composites: CompositeInfo[];
  }>(`/api/staff/sessions/${id}`);

// ---- Ổ đĩa và dọn dẹp ----

export type DiskInfo = {
  /** Ổ chứa thư mục ảnh, ví dụ "D:" */
  drive: string;
  dataDir: string;
  totalBytes: number;
  freeBytes: number;
  /** Phần ảnh khách đang chiếm, tính từ database. */
  usedByPhotosBytes: number;
  level: 'ok' | 'warn' | 'critical';
  /** Đọc được ổ đĩa hay không. Sai thì các số trên là 0. */
  ok: boolean;
};

/** Một mốc dọn dẹp: xoá ảnh cũ hơn `days` ngày thì được bao nhiêu. */
export type CleanupTier = { days: number; sessions: number; bytes: number };

/**
 * Dung lượng ổ đĩa.
 *
 * `withTiers` chỉ bật ở màn dọn dẹp: tính bảng mốc phải quét bảng ảnh cho
 * từng mốc, không đáng làm ở nhịp đọc mỗi phút của đèn báo trên tiêu đề.
 */
export const staffDisk = (withTiers = false) =>
  req<{ disk: DiskInfo; tiers?: CleanupTier[]; retentionDays: number }>(
    `/api/staff/disk${withTiers ? '?tiers=1' : ''}`,
  );

export const staffCleanup = (days: number) =>
  req<{ purged: number; disk: DiskInfo; tiers: CleanupTier[] }>(
    '/api/staff/cleanup',
    { method: 'POST', body: JSON.stringify({ days }) },
  );

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
  /** Ảnh đặc: lúc lưu server sẽ khoét lỗ theo các ô nhân viên đặt. */
  duc: boolean;
};

/*
 * Gửi nguyên file, khai đúng loại của nó.
 *
 * Server đọc thẳng body bằng sharp nên content-type chỉ là khai báo, nhưng
 * khai 'image/png' cho một file JPG là nói sai — và sẽ lừa chính chúng ta khi
 * đọc log hay bắt gói tin về sau.
 */
export const analyzeFrame = (file: File) =>
  req<FrameAnalysis>('/api/staff/frames/analyze', {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream' },
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
    headers: { 'content-type': file.type || 'application/octet-stream' },
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

// ---- Bộ chỉnh màu ----

export type ColorPreset = {
  id: string;
  label: string;
  /** ColorState — mọi thanh -1..1 nên áp được cho mọi ảnh. */
  params: Record<string, number | string>;
  enabled: boolean;
};

/** Bộ đang bật, cho khách chọn. */
export const listColorPresets = () =>
  req<{ presets: ColorPreset[] }>('/api/color-presets');

/** Đầy đủ, cho nhân viên. */
export const staffColorPresets = () =>
  req<{ presets: ColorPreset[] }>('/api/staff/color-presets');

export const createColorPreset = (label: string, params: unknown) =>
  req<{ preset: ColorPreset }>('/api/staff/color-presets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label, params }),
  });

export const updateColorPreset = (
  id: string,
  patch: { label?: string; params?: unknown; enabled?: boolean },
) =>
  req<{ preset: ColorPreset }>(`/api/staff/color-presets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });

export const deleteColorPreset = (id: string) =>
  req<{ ok: true }>(`/api/staff/color-presets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

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
