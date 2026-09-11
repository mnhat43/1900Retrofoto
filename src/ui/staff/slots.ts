/**
 * Toạ độ các ô chứa ảnh khách trên khung, và hai phép dựng ô sẵn.
 *
 * Tách riêng khỏi SlotEditor để kiểm chứng được bằng test: đây là phần tính
 * toán thuần, không dính gì đến chuột hay DOM.
 *
 * Toạ độ luôn CHUẨN HOÁ 0..1 — giống hệt thứ server lưu và phần render dùng,
 * nên ảnh xem trước to nhỏ bao nhiêu cũng không ảnh hưởng.
 */

export type Rect = { x: number; y: number; w: number; h: number };

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Ô nhỏ hơn mức này coi như bấm nhầm, không cho tạo. */
export const MIN_SIZE = 0.02;

/** Lề quanh mép khung và khe giữa các ô khi xếp lưới, theo tỉ lệ ảnh. */
export const LE = 0.06;
export const KHE = 0.03;

/** Mỗi nhịp co/nới đổi 1% mỗi chiều — đủ nhỏ để căn viền, đủ lớn để thấy. */
export const BUOC_VIEN = 0.01;

/**
 * Xếp n ô thành lưới đều nhau.
 *
 * Số cột chọn theo cách khung ảnh thật hay được bố trí: dải dọc xếp một cột,
 * 4 ô thành 2x2, 6 ô thành 2x3, 9 ô thành 3x3. Nhân viên kéo lại được hết,
 * đây chỉ là điểm bắt đầu đỡ phải căn tay.
 */
export function xepLuoi(n: number, tiLe: number): Rect[] {
  // Khung cao hơn rộng nhiều (dải 2x6) thì xếp một cột cho giống khung thật
  const cot = tiLe < 0.5 ? 1
    : n <= 2 ? 1
      : n <= 4 ? 2
        : n <= 6 ? 2
          : 3;
  const hang = Math.ceil(n / cot);

  const wO = (1 - LE * 2 - KHE * (cot - 1)) / cot;
  const hO = (1 - LE * 2 - KHE * (hang - 1)) / hang;

  const out: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cot;
    const r = Math.floor(i / cot);
    out.push({
      x: LE + c * (wO + KHE),
      y: LE + r * (hO + KHE),
      w: wO,
      h: hO,
    });
  }
  return out;
}

/**
 * Co (d < 0) hoặc nới (d > 0) tất cả ô cùng một nhịp.
 *
 * Đây là cách chừa viền cho đều. Kéo tay từng ô vào trong thì sáu ô ra sáu cỡ
 * khác nhau, mà với ảnh đặc lệch một chút là hoa văn bị khoét mất một chút —
 * nhìn ra thành ảnh khách đè lên viền.
 *
 * Nắn từng MÉP rồi mới tính lại bề rộng, chứ không cộng thẳng vào w/h: cộng
 * thẳng thì ô đang sát mép sẽ bị nới tràn ra ngoài ảnh.
 */
export function coNoi(slots: Rect[], d: number): Rect[] {
  return slots.map((s) => {
    const x0 = clamp01(s.x - d);
    const y0 = clamp01(s.y - d);
    const x1 = clamp01(s.x + s.w + d);
    const y1 = clamp01(s.y + s.h + d);
    // Co quá tay thì giữ nguyên ô, đừng để nó teo đi mất
    if (x1 - x0 < MIN_SIZE || y1 - y0 < MIN_SIZE) return s;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  });
}
