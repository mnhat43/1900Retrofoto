import type { Photo } from '../core/types';

/**
 * Ô trong dải rộng ~500px @300DPI, nên bản preview 1400px là thừa đủ cho cả
 * preview LẪN export (còn dư khi người dùng phóng to trong ô).
 * Nhờ vậy không cần decode lại full-res lúc export — vòng đời bộ nhớ đơn giản hẳn.
 *
 * Server cũng sinh bản preview đúng kích thước này (server/config.ts).
 */
const PREVIEW_MAX_EDGE = 1400;

let seq = 0;
const uid = () => `photo-${Date.now().toString(36)}-${seq++}`;

/**
 * Decode và thu nhỏ một Blob thành Photo.
 *
 * Dùng chung cho cả ảnh từ máy lẫn ảnh từ server, nên kỷ luật bộ nhớ
 * (close() bản full-res ngay) chỉ viết một lần và áp dụng cho cả hai đường.
 */
async function fromBlob(
  blob: Blob,
  id: string,
  thumbUrl: string,
  file?: File,
): Promise<Photo> {
  // imageOrientation: 'from-image' để ảnh chụp dọc không bị xoay sai.
  const source = await createImageBitmap(blob, { imageOrientation: 'from-image' });

  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(source.width, source.height));

  let bitmap: ImageBitmap;
  if (scale === 1) {
    bitmap = source;
  } else {
    const w = Math.round(source.width * scale);
    const h = Math.round(source.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    bitmap = await createImageBitmap(canvas);
    // Giải phóng bản full-res NGAY. Đây là dòng quan trọng nhất về bộ nhớ:
    // close() là cách duy nhất giải phóng xác định, GC không hẹn được.
    source.close();
  }

  return {
    id,
    bitmap,
    natural: { w: bitmap.width, h: bitmap.height },
    thumbUrl,
    file,
  };
}

/**
 * Nạp một File từ máy người dùng.
 *
 * Giữ File handle (không tạo object URL cho dữ liệu gốc — dễ leak, mà
 * createImageBitmap nhận Blob trực tiếp). Object URL chỉ tạo cho ảnh xem trước.
 */
export async function loadPhoto(file: File): Promise<Photo> {
  return fromBlob(file, uid(), URL.createObjectURL(file), file);
}

/**
 * Nạp ảnh từ URL trên server (khách ghép khung bằng điện thoại).
 *
 * `thumbUrl` mặc định trùng `url` — server đã phục vụ sẵn bản preview nhỏ nên
 * không cần bản xem trước riêng.
 */
export async function loadPhotoFromUrl(
  url: string,
  id: string = uid(),
  thumbUrl: string = url,
): Promise<Photo> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được ảnh (${res.status})`);
  return fromBlob(await res.blob(), id, thumbUrl);
}

/** Giải phóng ảnh — đóng bitmap và thu hồi object URL nếu có. */
export function releasePhoto(photo: Photo): void {
  photo.bitmap.close();
  if (photo.file && photo.thumbUrl.startsWith('blob:')) {
    URL.revokeObjectURL(photo.thumbUrl);
  }
}

/** Nạp tuần tự, KHÔNG Promise.all — 20 lần decode full-res song song là kịch bản OOM. */
export async function loadPhotos(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<Photo[]> {
  const out: Photo[] = [];
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      out.push(await loadPhoto(file));
    } catch {
      // Bỏ qua file hỏng, vẫn nạp tiếp các file còn lại.
    }
    onProgress?.(out.length, files.length);
  }
  return out;
}

/**
 * Nạp nhiều ảnh từ server.
 *
 * Tải song song vài ảnh một (mạng là nút thắt, không phải decode) nhưng vẫn
 * decode tuần tự trong từng lô để không phình bộ nhớ.
 */
export async function loadPhotosFromUrls(
  items: Array<{ url: string; id: string }>,
  onProgress?: (done: number, total: number) => void,
): Promise<Photo[]> {
  const out: Photo[] = [];
  const BATCH = 3;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const blobs = await Promise.all(
      batch.map(async (it) => {
        const res = await fetch(it.url);
        if (!res.ok) throw new Error(`Không tải được ảnh (${res.status})`);
        return { blob: await res.blob(), ...it };
      }),
    );
    for (const b of blobs) {
      out.push(await fromBlob(b.blob, b.id, b.url));
      onProgress?.(out.length, items.length);
    }
  }
  return out;
}

/**
 * Cạnh dài tối đa của ảnh album gửi lên server.
 *
 * 4000px ~ 12MP: vẫn nét cho khổ in lớn nhất, mà nằm dưới trần canvas iOS
 * (~16.7M điểm ảnh) nên Safari không vẽ ra ảnh trắng.
 */
const UPLOAD_MAX_EDGE = 4000;

/**
 * Chuẩn bị một ảnh trong album điện thoại để gửi lên phiên.
 *
 * Luôn vẽ lại thành JPEG thay vì gửi nguyên file:
 *   - iPhone lưu HEIC, server (sharp) không đọc được — trình duyệt thì đọc được.
 *   - Xoay theo EXIF ngay ở đây, khỏi phụ thuộc server hiểu EXIF của máy nào.
 *   - Ảnh 48MP của điện thoại mới gửi qua WiFi quán rất chậm; thu về ~12MP là đủ.
 */
export async function prepareUpload(file: File): Promise<Blob> {
  const source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, UPLOAD_MAX_EDGE / Math.max(source.width, source.height));
    const w = Math.round(source.width * scale);
    const h = Math.round(source.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.92));
    // Thả bộ nhớ canvas ngay — iOS tính cả canvas đã bỏ vào hạn mức nếu chưa GC.
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error('Không đọc được ảnh');
    return blob;
  } finally {
    source.close();
  }
}

export function loadOverlay(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Không nạp được khung: ${src}`));
    img.src = src;
  });
}
