import { useState, useCallback } from 'react';
import Dialog, { type DialogSpec } from './Dialog';

/**
 * Mở hộp thoại xác nhận / nhập liệu.
 *
 * Trả về `ask` để gọi và `dialog` để render:
 *
 *   const { ask, dialog } = useDialog();
 *   ...
 *   ask({ title: 'Xoá khung?', danger: true, onConfirm: () => doXoa() });
 *   return <>...{dialog}</>;
 */
export function useDialog() {
  /*
   * `seq` tăng mỗi lần hỏi, và dùng làm `key` của <Dialog>.
   *
   * Mỗi lần hỏi là một hộp thoại MỚI hoàn toàn: React tháo cái cũ, dựng cái
   * mới, nên state bên trong khởi tạo lại từ spec mới ngay ở render đầu.
   * Không có key thì Dialog bị dùng lại và phải tự đồng bộ state theo prop
   * bằng effect — đúng cái bẫy làm ô nhập rỗng một nhịp trước khi điền.
   */
  const [state, setState] = useState<{ spec: DialogSpec; seq: number } | null>(null);

  const ask = useCallback((s: DialogSpec) => {
    setState((prev) => ({ spec: s, seq: (prev?.seq ?? 0) + 1 }));
  }, []);
  const close = useCallback(() => setState(null), []);

  return {
    ask,
    dialog: state
      ? <Dialog key={state.seq} spec={state.spec} onClose={close} />
      : null,
  };
}
