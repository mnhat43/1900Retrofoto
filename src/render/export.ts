import { framePx } from '../core/format';
import { drawStrip, type StripState } from './draw';

export type ExportFormat = 'png' | 'jpeg';

/**
 * Render trang ở 300 DPI và trả về Blob.
 *
 * Khổ giấy lấy từ chính khung (3-4 ô -> 2x6 inch, 6 ô -> 4x6, 9 ô -> 6x6),
 * nên người dùng không phải chọn gì thêm.
 *
 * Dùng chung `drawStrip` với preview — chỉ khác kích thước truyền vào,
 * nên khung hình và màu sắc trùng khớp tuyệt đối với những gì người dùng thấy.
 */
export async function exportStrip(
  state: StripState,
  overlay: HTMLImageElement | ImageBitmap | null,
  format: ExportFormat = 'png',
  quality = 0.95,
): Promise<Blob> {
  const page = framePx(state.frame);

  const canvas = document.createElement('canvas');
  canvas.width = page.w;
  canvas.height = page.h;

  const ctx = canvas.getContext('2d', {
    alpha: format === 'png',
    colorSpace: 'srgb',
  }) as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Không tạo được canvas context');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, page.w, page.h);
  }

  drawStrip(ctx, state, page.w, page.h, overlay);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, `image/${format}`, quality),
  );
  if (!blob) throw new Error('Không xuất được ảnh');
  return blob;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Thu hồi sau một nhịp để trình duyệt kịp bắt đầu tải.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
