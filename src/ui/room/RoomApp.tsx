import { useCallback, useEffect, useState } from 'react';
import {
  claimCode, roomSession, finishRoom, intakeRoom,
  type SessionInfo, type PhotoInfo, type QrPair, type IntakeResult, ApiError,
} from '../../api';
import './room.css';

/**
 * Màn hình phòng chụp — chạy toàn màn hình trên PC của phòng.
 *
 * Trạng thái: KHOÁ (nhập mã) -> ĐANG CHỤP -> XONG (2 mã QR).
 *
 * Luồng lấy ảnh: mỗi phiên có thư mục riêng đặt tên bằng mã 4 số, tạo sẵn
 * lúc nhân viên tạo mã. Khách chụp xong bấm "Đã chụp xong", server quét đúng
 * thư mục ấy. Nhờ vậy ảnh không thể lẫn giữa các khách.
 *
 * Poll mỗi 2s thay vì websocket: dễ debug, sống sót qua ngủ/thức và LAN
 * chập chờn, 2s là không nhận ra được.
 */
export default function RoomApp() {
  const room = new URLSearchParams(location.search).get('p') ?? '1';

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [photos, setPhotos] = useState<PhotoInfo[]>([]);
  const [qr, setQr] = useState<QrPair | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [offline, setOffline] = useState(false);
  const [captureOn, setCaptureOn] = useState(false);
  const [intake, setIntake] = useState<IntakeResult | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await roomSession(room);
      setSession(r.session);
      setPhotos(r.photos ?? []);
      setQr(r.qr ?? null);
      setCaptureOn(!!r.captureEnabled);
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
      setIntake(null);
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

  /** Quét thư mục của phiên để nạp ảnh vừa chụp. */
  async function onIntake() {
    setBusy('Đang lấy ảnh...');
    setError('');
    try {
      const r = await intakeRoom(room);
      setIntake(r);
      await refresh();
    } catch {
      // Chi tiết lỗi không hiện cho khách — chỉ bật cờ để hiện lời nhắn chung
      setError('loi');
    } finally {
      setBusy('');
    }
  }

  async function onFinish() {
    setBusy('...');
    try {
      const r = await finishRoom(room);
      setQr(r.qr);
      await refresh();
    } finally {
      setBusy('');
    }
  }

  const done = session?.status === 'done' || session?.status === 'composed';
  const remaining = session ? session.maxPhotos - photos.length : 0;

  /*
   * Có lỗi thật sự cần gọi nhân viên hay không.
   *
   * "Quét mà chưa có ảnh nào" KHÔNG tính là lỗi khi khách chưa chụp xong —
   * chỉ thành lỗi khi đã quét mà vẫn trắng tay, hoặc chưa cấu hình thư mục,
   * hoặc mất kết nối tới máy chủ.
   */
  const problem =
    !captureOn ||
    offline ||
    !!error ||
    (!!intake && intake.found === 0 && photos.length === 0);

  /** Thanh trên — có ở MỌI màn để logo luôn hiện. */
  const Bar = ({ right }: { right?: React.ReactNode }) => (
    <header className="room-top">
      <span className="brand">
        <span className="n">1900</span><span className="w">Retrofoto</span>
      </span>
      {right ?? <span className="room-tag">Phòng {room}</span>}
    </header>
  );

  // ---- XONG: hiện 2 mã QR ----
  if (done && qr) {
    return (
      <div className="room done">
        <Bar right={<span className="code-chip">{session?.code}</span>} />

        <div className="room-main">
          <div>
            <h1>Chụp xong!</h1>
            <p className="lead">Dùng điện thoại quét mã bên dưới</p>
          </div>

          <div className="qr-row">
            <div className="qr-card">
              <img src={qr.view} alt="QR xem ảnh" />
              <h2>Xem ảnh</h2>
              <p>Xem lại {photos.length} ảnh vừa chụp</p>
            </div>
            <div className="qr-card primary">
              <img src={qr.compose} alt="QR ghép khung" />
              <h2>Ghép khung</h2>
              <p>Chọn khung và tạo dải ảnh</p>
            </div>
          </div>

          <p className="warn">
            Hãy tải ảnh về máy <b>trước khi rời quán</b> — liên kết chỉ dùng
            được trong WiFi cửa hàng.
          </p>
        </div>
      </div>
    );
  }

  // ---- ĐANG CHỤP ----
  if (session) {
    const hasPhotos = photos.length > 0;
    return (
      <div className="room">
        <Bar right={<span className="code-chip">{session.code}</span>} />

        <div className="room-main">
          <div className="counter">
            <div className="big">{photos.length}<span>/{session.maxPhotos}</span></div>
            <p>
              {!hasPhotos
                ? 'Chụp xong thì bấm nút bên dưới'
                : remaining > 0
                  ? `Còn ${remaining} kiểu`
                  : 'Đã chụp đủ'}
            </p>
          </div>

          <div className="thumbs">
            {Array.from({ length: session.maxPhotos }, (_, i) => (
              <div key={i} className={i < photos.length ? 'slot filled' : 'slot'}>
                {i + 1}
              </div>
            ))}
          </div>

          {/*
            Màn này KHÁCH nhìn, không phải nhân viên — nên không lộ đường dẫn
            thư mục hay tên biến cấu hình. Chi tiết kỹ thuật vẫn được ghi ở
            console của server để nhân viên tra khi cần.
          */}
          {problem && !busy && (
            <div className="notice">
              <b>Hệ thống đang gặp lỗi</b>
              <span className="dim">Vui lòng liên hệ nhân viên để được hỗ trợ.</span>
            </div>
          )}

          <div className="actions">
            <button
              className="btn btn-primary"
              disabled={!!busy || !captureOn || remaining <= 0}
              onClick={onIntake}
            >
              {busy || (intake || hasPhotos ? 'Lấy thêm ảnh' : 'Đã chụp xong')}
            </button>

            <button
              className="btn btn-ghost"
              disabled={!!busy || !hasPhotos}
              onClick={onFinish}
            >
              Hiện mã QR
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
