import { useEffect, useState } from 'react';
import { staffSessionQr, type QrPair } from '../../api';

interface QrModalProps {
  /** Phiên cần hiện lại QR. */
  id: string;
  /** Mã 4 số — hiện ngay ở tiêu đề, không phải đợi tải xong. */
  code: string;
  onClose: () => void;
}

/**
 * Hiện lại hai mã QR của một phiên trên máy nhân viên.
 *
 * Vì sao cần: màn hình phòng bỏ QR ngay khi nhân viên phát mã cho khách tiếp
 * theo, nên khách cũ đang ngồi ghép ảnh ngoài quán không còn chỗ quét lại.
 * Nhân viên xoay màn hình ra là xong, không phải đóng phiên của khách mới.
 *
 * Tải QR lúc mở chứ không nhận qua props: ảnh data-URL nặng, chỉ nên sinh khi
 * thật sự có người xem.
 */
export default function QrModal({ id, code, onClose }: QrModalProps) {
  const [qr, setQr] = useState<QrPair | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    staffSessionQr(id)
      .then((r) => { if (alive) setQr(r.qr); })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Không lấy được mã QR');
      });
    return () => { alive = false; };
  }, [id]);

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-inner qr-modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Mã QR của phiên {code}</h2>
          <button className="ghost" onClick={onClose}>Đóng</button>
        </header>

        {error && <p className="error">{error}</p>}
        {!qr && !error && <p className="empty">Đang tạo mã...</p>}

        {qr && (
          <>
            <p className="qr-hint">
              Đưa màn hình cho khách quét. Chỉ quét được khi điện thoại đang
              dùng WiFi cửa hàng.
            </p>
            <div className="qr-pair">
              <div className="qr-item">
                <img src={qr.view} alt={`QR xem ảnh phiên ${code}`} />
                <b>Xem ảnh</b>
                <span className="qr-url">{qr.viewUrl}</span>
              </div>
              <div className="qr-item">
                <img src={qr.compose} alt={`QR ghép khung phiên ${code}`} />
                <b>Ghép khung</b>
                <span className="qr-url">{qr.composeUrl}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
