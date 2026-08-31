import { useEffect, useRef, useState } from 'react';

/**
 * Hộp thoại thay cho confirm()/prompt() của trình duyệt.
 *
 * VÌ SAO KHÔNG DÙNG DIALOG SẴN CÓ:
 * - Không đổi được kiểu dáng, nhìn lạc hẳn khỏi giao diện còn lại.
 * - Chặn cứng luồng JavaScript, và một số trình duyệt cho phép người dùng
 *   tick "chặn hộp thoại từ trang này" — bấm nút xong không thấy gì xảy ra.
 * - Không hiển thị được nội dung có định dạng (mã phiên, cảnh báo nhiều dòng).
 *
 * Dùng <dialog> của HTML để không phải tự làm bẫy tiêu điểm, phím Esc và
 * lớp phủ — trình duyệt lo sẵn, và trình đọc màn hình hiểu đúng.
 */

export type DialogSpec = {
  title: string;
  /** Nội dung mô tả; xuống dòng bằng \n sẽ thành từng đoạn. */
  message?: string;
  /** Có ô nhập -> hộp thoại kiểu prompt. Giá trị này là mặc định điền sẵn. */
  input?: { label: string; value: string; placeholder?: string };
  confirmLabel?: string;
  cancelLabel?: string;
  /** Hành động không hoàn tác được -> nút xác nhận màu đỏ. */
  danger?: boolean;
  /** Nhận giá trị ô nhập nếu có, ngược lại là chuỗi rỗng. */
  onConfirm: (value: string) => void;
};

export default function Dialog({
  spec, onClose,
}: { spec: DialogSpec | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!spec) return;
    setValue(spec.input?.value ?? '');
    // showModal() mới tạo lớp phủ và bẫy tiêu điểm; open=true thì không.
    ref.current?.showModal();

    // Bôi đen sẵn tên cũ: gõ là thay luôn, không phải xoá từng ký tự.
    // React bỏ qua autoFocus bên trong <dialog>, nên phải tự gọi.
    if (spec.input) {
      const el = ref.current?.querySelector('input');
      el?.focus();
      el?.select();
    }
  }, [spec]);

  if (!spec) return null;

  const needsValue = !!spec.input;
  const canConfirm = !needsValue || value.trim() !== '';

  const close = () => { ref.current?.close(); onClose(); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canConfirm) return;
    spec.onConfirm(value.trim());
    close();
  };

  return (
    <dialog
      className="dialog"
      ref={ref}
      // Phím Esc và bấm nền đều là "huỷ" — đóng mà không chạy hành động
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === ref.current) close(); }}
    >
      <form onSubmit={submit}>
        <h2>{spec.title}</h2>

        {spec.message?.split('\n').filter(Boolean).map((line, i) => (
          <p key={i} className="dialog-msg">{line}</p>
        ))}

        {spec.input && (
          <label className="dialog-field">
            <span className="field-label">{spec.input.label}</span>
            <input
              className="text-input"
              value={value}
              placeholder={spec.input.placeholder}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        )}

        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={close}>
            {spec.cancelLabel ?? 'Huỷ'}
          </button>
          {/*
            KHÔNG autoFocus nút này.
            Hộp thoại xác nhận mở ra với tiêu điểm ở "Huỷ" — bấm Enter theo
            phản xạ sẽ huỷ chứ không xoá mất thứ gì. Vẫn bấm Enter để xác nhận
            được sau khi Tab sang, hoặc gõ xong tên ở ô nhập.
          */}
          <button
            type="submit"
            className={spec.danger ? 'primary danger' : 'primary'}
            disabled={!canConfirm}
          >
            {spec.confirmLabel ?? 'Xác nhận'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
