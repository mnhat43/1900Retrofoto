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
  const [spec, setSpec] = useState<DialogSpec | null>(null);

  const ask = useCallback((s: DialogSpec) => setSpec(s), []);
  const close = useCallback(() => setSpec(null), []);

  return {
    ask,
    dialog: <Dialog spec={spec} onClose={close} />,
  };
}
