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
  /**
   * Số tiền chốt lúc tạo mã. null = phiên tạo trước khi có tính năng giá,
   * KHÁC với bán 0 đồng — hiện dấu gạch và không cộng vào tổng.
   */
  priceAmount?: number | null;
  priceLabel?: string | null;
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

/** Mã QR ghép khung của một phiên — mã duy nhất khách cần quét. */
export type GuestQr = {
  composeUrl: string;
  /** Ảnh QR dạng data-URL. */
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
export const createSession = (room: string, priceId?: string) =>
  req<{
    id: string; code: string; maxPhotos: number; room: string;
  }>('/api/staff/sessions', {
    method: 'POST',
    body: JSON.stringify({ room, priceId }),
  });

// --- Gói giá ---

export type PriceInfo = {
  id: string;
  label: string;
  /** Số nguyên đồng. Tiền Việt không có hào. */
  amount: number;
  enabled: boolean;
};

export const staffPrices = () =>
  req<{ prices: PriceInfo[] }>('/api/staff/prices');

export const createPrice = (label: string, amount: number) =>
  req<{ price: PriceInfo }>('/api/staff/prices', {
    method: 'POST',
    body: JSON.stringify({ label, amount }),
  });

export const updatePrice = (
  id: string,
  patch: { label?: string; amount?: number; enabled?: boolean },
) =>
  req<{ price: PriceInfo }>(`/api/staff/prices/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const deletePrice = (id: string) =>
  req<{ ok: true }>(`/api/staff/prices/${id}`, { method: 'DELETE' });

/** Đổi giá phiên đã tạo. priceId null = gỡ giá ra. */
export const setSessionPrice = (sessionId: string, priceId: string | null) =>
  req<{ ok: true }>(`/api/staff/sessions/${sessionId}/price`, {
    method: 'POST',
    body: JSON.stringify({ priceId }),
  });

// --- Thống kê theo ngày ---

export type DayStats = {
  /** Ngày đang xem, dạng YYYY-MM-DD. */
  day: string;
  /** Những ngày CÓ phiên, mới nhất trước. */
  days: string[];
  sessions: Array<SessionInfo & { photos: number; composites: number }>;
  /** Tổng tiền — chỉ cộng phiên CÓ giá. */
  total: number;
  counted: number;
  /** Số phiên chưa có giá, không tính vào tổng. */
  missing: number;
};

export const staffStats = (day?: string) =>
  req<DayStats>('/api/staff/stats' + (day ? `?day=${encodeURIComponent(day)}` : ''));

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
 * Lấy lại mã QR ghép khung của một phiên để chìa cho khách quét.
 *
 * Gọi theo yêu cầu chứ không kèm sẵn trong `staffRooms` — ảnh QR là data-URL
 * khá nặng so với nhịp đọc lại mỗi 4 giây của trang nhân viên.
 */
export const staffSessionQr = (id: string) =>
  req<{ code: string; status: string; qr: GuestQr }>(`/api/staff/sessions/${id}/qr`);

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
    qr?: GuestQr | null;
    locked?: boolean;
  }>(`/api/room/session?room=${encodeURIComponent(room)}`);

/** Khách chụp xong -> chuyển phiên sang chờ ghép, lấy QR. */
export const finishRoom = (room: string) =>
  req<{ qr: GuestQr }>(`/api/room/finish?room=${encodeURIComponent(room)}`, {
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

/**
 * Khách tải một ảnh từ album điện thoại lên phiên của mình.
 *
 * Ảnh thành ảnh thật của phiên trên server — nhờ vậy bước dựng lại bản nét
 * ở server vẫn tìm thấy ảnh gốc, y như ảnh máy chụp.
 */
export const uploadGuestPhoto = (token: string, blob: Blob) =>
  req<{ photo: PhotoInfo; remaining: number }>(
    `/api/s/photos?t=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'content-type': blob.type || 'image/jpeg' },
      body: blob,
    },
  );

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
