import type { FormatId } from './format';

/**
 * Toạ độ chuẩn hoá 0..1 so với khổ giấy.
 * Không phụ thuộc DPI — cùng một định nghĩa chạy đúng ở preview và ở export 300 DPI.
 */
export type NormRect = { x: number; y: number; w: number; h: number };

export type Rect = { x: number; y: number; w: number; h: number };

export type Size = { w: number; h: number };

/** Một ô trống trên khung, nơi ảnh được chèn vào. */
export type Slot = {
  id: string;
  rect: NormRect;
  /** Bo góc, chuẩn hoá theo cạnh ngắn của ô. 0 = góc vuông. */
  radius?: number;
};

/** Khung trang trí: PNG có vùng trong suốt + toạ độ các ô. */
export type Frame = {
  id: string;
  label: string;
  slotCount: number;
  /** Khổ giấy dựng sẵn. Dùng khi khung không tự khai kích thước in. */
  formatId: FormatId;
  /** Kích thước in do nhân viên khai, inch. Có thì THẮNG formatId. */
  widthInch?: number;
  heightInch?: number;
  /** PNG vẽ ĐÈ LÊN TRÊN ảnh. Vùng trong suốt để lộ ảnh bên dưới. */
  overlaySrc: string;
  slots: Slot[];
  tags?: string[];
};

/**
 * Vị trí ảnh trong ô — lưu 3 số, không lưu pixel.
 * Nhờ vậy transform độc lập với độ phân giải: preview và export cho khung hình
 * trùng khớp tuyệt đối.
 */
export type SlotContent = {
  photoId: string;
  /** Bội số so với cover-fit. 1 = vừa khít ô. Luôn >= 1 để không hở nền. */
  zoom: number;
  /** Dịch chuyển, tính theo TỈ LỆ phần thừa. -1..1. 0 = căn giữa. */
  offset: { x: number; y: number };
};

/**
 * Ảnh đã nạp, sẵn sàng để vẽ.
 *
 * Ảnh có thể đến từ 2 nguồn: file người dùng chọn từ máy, hoặc URL trên server
 * (khi khách ghép khung bằng điện thoại). Đường render chỉ dùng `bitmap` và
 * `natural` nên không phân biệt nguồn.
 */
export type Photo = {
  id: string;
  /** Bản thu nhỏ dùng cho cả preview lẫn export (khổ strip nhỏ nên đủ dùng). */
  bitmap: ImageBitmap;
  natural: Size;
  /** Nguồn ảnh cho thẻ <img> xem trước: blob URL hoặc http URL. */
  thumbUrl: string;
  /** Chỉ có khi ảnh được chọn từ máy. */
  file?: File;
};

export type ColorState = {
  presetId: string;
  brightness: number;
  contrast: number;
  saturation: number;
};

export const DEFAULT_COLOR: ColorState = {
  presetId: 'none',
  brightness: 0,
  contrast: 0,
  saturation: 0,
};

export const DEFAULT_CONTENT = (photoId: string): SlotContent => ({
  photoId,
  zoom: 1,
  offset: { x: 0, y: 0 },
});
