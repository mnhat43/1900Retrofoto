import { useCallback, useEffect, useState } from 'react';
import {
  claimCode, roomSession, finishRoom,
  type SessionInfo, type GuestQr, ApiError,
} from '../../api';
import './room.css';

/**
 * Màn hình phòng chụp — chạy toàn màn hình trên PC của phòng.
 *
 * Trạng thái: KHOÁ (nhập mã) -> ĐANG CHỤP -> XONG (mã QR ghép khung).
 *
 * Hệ thống KHÔNG lấy ảnh từ máy chụp: quán tự đưa file ảnh cho khách, khách
 * quét QR rồi tự tải ảnh lên trang ghép khung. Màn này chỉ còn việc mở khoá
 * phòng bằng mã và hiện QR khi khách chụp xong.
 *
 * Poll mỗi 2s thay vì websocket: dễ debug, sống sót qua ngủ/thức và LAN
 * chập chờn, 2s là không nhận ra được.
 */
export default function RoomApp() {
  const room = new URLSearchParams(location.search).get('p') ?? '1';

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [qr, setQr] = useState<GuestQr | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await roomSession(room);
      setSession(r.session);
      setQr(r.qr ?? null);
      setOffline(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) setOffline(true);
    }
  }, [room]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  async function submitCode(value: string) {
    setError('');
    setBusy('...');
    try {
      const r = await claimCode(room, value);
      setSession(r.session);
      setCode('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi');
      setCode('');
    } finally {
      setBusy('');
    }
  }

  function press(d: string) {
    if (busy) return;
    const next = (code + d).slice(0, 4);
    setCode(next);
    setError('');
    if (next.length === 4) submitCode(next);
  }

  async function onFinish() {
    setBusy('...');
    setError('');
    try {
      const r = await finishRoom(room);
      setQr(r.qr);
      await refresh();
    } catch {
      // Chi tiết lỗi không hiện cho khách — chỉ bật cờ để hiện lời nhắn chung
      setError('loi');
    } finally {
      setBusy('');
    }
  }

  const done = session?.status === 'done' || session?.status === 'composed';

  /** Thanh trên — có ở MỌI màn để logo luôn hiện. */
  const Bar = ({ right }: { right?: React.ReactNode }) => (
    <header className="room-top">
      <span className="brand">
        <span className="n">1900</span><span className="w">Retrofoto</span>
      </span>
      {right ?? <span className="room-tag">Phòng {room}</span>}
    </header>
  );

  // ---- XONG: hiện mã QR ghép khung ----
  if (done && qr) {
    return (
      <div className="room done">
        <Bar right={<span className="code-chip">{session?.code}</span>} />

        <div className="room-main">
          <div>
            <h1>Chụp xong!</h1>
            <p className="lead">Dùng điện thoại quét mã bên dưới</p>
          </div>

          {/*
            Chỉ một mã: ghép khung. Ảnh do quán gửi cho khách (AirDrop,
            Zalo...), khách tải lên từ album điện thoại rồi ghép.
          */}
          <div className="qr-row">
            <div className="qr-card primary">
              <img src={qr.compose} alt="QR ghép khung" />
              <h2>Ghép khung</h2>
              <p>Tải ảnh quán gửi bạn lên, chọn khung và ghép</p>
            </div>
          </div>

          <p className="warn">
            Hãy tải ảnh về máy <b>trước khi rời quán</b> — liên kết chỉ dùng
            được trong WiFi cửa hàng.
          </p>

          {/*
            Buồng đã rảnh ngay khi bấm "Đã chụp xong". Nói rõ để khách biết
            cứ cầm điện thoại ra ngoài ngồi ghép, không phải đứng chiếm phòng.
          */}
          <p className="free-note">
            Bạn có thể <b>ra ngoài ngồi ghép ảnh</b> — phòng đã sẵn sàng cho
            khách tiếp theo.
          </p>
        </div>
      </div>
    );
  }

  // ---- ĐANG CHỤP ----
  if (session) {
    return (
      <div className="room">
        <Bar right={<span className="code-chip">{session.code}</span>} />

        <div className="room-main">
          <div>
            <h1>Chúc bạn chụp vui!</h1>
            <p className="lead">Chụp xong thì bấm nút bên dưới để lấy mã QR ghép ảnh</p>
          </div>

          {/*
            Màn này KHÁCH nhìn, không phải nhân viên — lỗi gì cũng chỉ hướng
            sang nhân viên, không lộ chi tiết kỹ thuật.
          */}
          {(offline || error) && !busy && (
            <div className="notice">
              <b>Hệ thống đang gặp lỗi</b>
              <span className="dim">Vui lòng liên hệ nhân viên để được hỗ trợ.</span>
            </div>
          )}

          <div className="actions">
            <button className="btn btn-primary" disabled={!!busy} onClick={onFinish}>
              {busy || 'Đã chụp xong'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- KHOÁ: nhập mã ----
  return (
    <div className="room locked">
      <Bar />

      <div className="room-main">
        <div>
          <h1>Phòng {room}</h1>
          <p className="lead">Nhập mã 4 số để bắt đầu</p>
        </div>

        <div className="code-boxes">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={code[i] ? 'box on' : 'box'}>
              {code[i] ?? ''}
            </div>
          ))}
        </div>

        {/* Sai mã thì khách tự sửa được -> nói thẳng. Còn lại là lỗi hệ thống,
            khách không tự xử lý được -> hướng sang nhân viên. */}
        {error && <p className="error">{error}</p>}
        {offline && (
          <p className="error">Hệ thống đang gặp lỗi — vui lòng liên hệ nhân viên</p>
        )}

        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} onClick={() => press(d)} disabled={!!busy}>{d}</button>
          ))}
          <button className="wide" onClick={() => setCode('')} disabled={!!busy}>
            Xoá
          </button>
          <button onClick={() => press('0')} disabled={!!busy}>0</button>
        </div>
      </div>
    </div>
  );
}
