import { useEffect, useState, useCallback } from 'react';
import {
  staffMe, staffLogin, staffLogout, staffSessions, staffRooms, createSession,
  closeSession, staffSessionDetail, photoUrl, compositeUrl,
  ApiError,
  type SessionInfo, type PhotoInfo, type CompositeInfo, type RoomStatus,
} from '../../api';
import FramesPanel from './FramesPanel';
import { useDialog } from './useDialog';
import './staff.css';

type Row = SessionInfo & { photos: number; composites: number };

const PACKAGES = [4, 8, 12, 16, 20];

const STATUS_LABEL: Record<string, string> = {
  created: 'Chờ khách',
  active: 'Đang ở phòng',
  shooting: 'Đang chụp',
  done: 'Chụp xong',
  composed: 'Đã ghép',
  closed: 'Đã đóng',
  expired: 'Đã xoá ảnh',
  cancelled: 'Đã huỷ',
};

/** Trạng thái mà nhân viên còn đóng được (phiên đang chiếm phòng). */
const CLOSABLE = new Set(['created', 'active', 'shooting', 'done', 'composed']);

/** Số phiên hiện mỗi trang — đủ để không phải cuộn trên màn hình thường. */
const PER_PAGE = 10;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Ngày/tháng + giờ:phút.
 *
 * Xuống dòng làm hai phần để cột không quá rộng, và ngày đọc được ngay mà
 * không phải suy ra từ tiêu đề nhóm.
 */
function fmtWhen(t: number) {
  const d = new Date(t);
  return {
    day: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export default function StaffApp() {
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [rooms, setRooms] = useState<RoomStatus[]>([]);
  const [room, setRoom] = useState('');
  const [maxPhotos, setMaxPhotos] = useState(8);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<'sessions' | 'frames'>('sessions');
  const { ask, dialog } = useDialog();
  const [detail, setDetail] = useState<{
    session: SessionInfo; token: string; photos: PhotoInfo[]; composites: CompositeInfo[];
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([staffSessions(), staffRooms()]);
      setRows(s.sessions);
      setRooms(r.rooms);
      // Tự chọn phòng rảnh đầu tiên nếu chưa chọn hoặc phòng đang chọn đã bận
      setRoom((cur) => {
        const stillFree = r.rooms.find((x) => x.id === cur && !x.busy);
        return stillFree ? cur : (r.rooms.find((x) => !x.busy)?.id ?? '');
      });
    } catch { /* phiên đăng nhập hết hạn */ }
  }, []);

  useEffect(() => {
    staffMe().then((r) => {
      setLoggedIn(r.staff);
      setReady(true);
      if (r.staff) load();
    });
  }, [load]);

  useEffect(() => {
    if (!loggedIn) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [loggedIn, load]);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await staffLogin(password);
      setLoggedIn(true);
      setPassword('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi');
    }
  }

  async function onCreate() {
    if (!room) return;
    setBusy(true);
    setError('');
    try {
      await createSession(room, maxPhotos);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tạo được mã');
    } finally {
      setBusy(false);
    }
  }

  function onClose(id: string, code: string) {
    ask({
      title: `Đóng phiên mã ${code}?`,
      message:
        'Phòng sẽ sẵn sàng nhận khách mới.\n' +
        'Khách của phiên này sẽ KHÔNG quét QR xem ảnh được nữa.',
      confirmLabel: 'Đóng phiên',
      danger: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          await closeSession(id);
          await load();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Không đóng được phiên');
        } finally {
          setBusy(false);
        }
      },
    });
  }

  if (!ready) return <div className="staff"><p>Đang tải...</p></div>;

  if (!loggedIn) {
    return (
      <div className="staff center">
        <form className="login" onSubmit={onLogin}>
          <div className="brand">
            <span className="n">1900</span><span className="w">Retrofoto</span>
          </div>
          <p>Đăng nhập nhân viên</p>
          <input
            type="password"
            placeholder="Mật khẩu"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          {error && <p className="error">{error}</p>}
          <button type="submit">Đăng nhập</button>
        </form>
      </div>
    );
  }

  const allBusy = rooms.length > 0 && rooms.every((r) => r.busy);

  /*
   * Phân trang trước, rồi mới nhóm theo ngày TRONG trang đó.
   *
   * Làm ngược lại (nhóm trước, phân trang sau) sẽ khiến một ngày bị cắt đôi
   * giữa hai trang mà không nói rõ, gây hiểu nhầm là thiếu phiên.
   */
  const sorted = [...rows].sort((a, b) => b.createdAt - a.createdAt);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const current = Math.min(page, pageCount - 1);
  const slice = sorted.slice(current * PER_PAGE, (current + 1) * PER_PAGE);

  return (
    <div className="staff">
      <header>
        <span className="brand">
          <span className="n">1900</span><span className="w">Retrofoto</span>
        </span>

        <nav className="tabs">
          <button
            className={view === 'sessions' ? 'on' : ''}
            onClick={() => setView('sessions')}
          >
            Phiên chụp
          </button>
          <button
            className={view === 'frames' ? 'on' : ''}
            onClick={() => setView('frames')}
          >
            Khung ảnh
          </button>
        </nav>

        <button className="ghost" onClick={() => staffLogout().then(() => setLoggedIn(false))}>
          Đăng xuất
        </button>
      </header>

      {view === 'frames' ? <FramesPanel /> : (
      <div className="cols">
      <div className="col-left">

      {/* Trạng thái từng phòng — nhìn là biết phòng nào còn trống */}
      <section className="card">
        <h2>Phòng</h2>
        <div className="rooms">
          {rooms.map((r) => (
            <div key={r.id} className={r.busy ? 'room-card busy' : 'room-card free'}>
              <div className="room-name">Phòng {r.id}</div>
              {r.busy && r.session ? (
                <>
                  <div className="room-code">{r.session.code}</div>
                  <span className={`badge ${r.session.status}`}>
                    {STATUS_LABEL[r.session.status] ?? r.session.status}
                  </span>
                  <button
                    className="btn-close"
                    disabled={busy}
                    onClick={() => onClose(r.session!.id, r.session!.code)}
                  >
                    Đóng phiên
                  </button>
                </>
              ) : (
                <div className="room-free">Trống</div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Tạo gói chụp</h2>

        {allBusy ? (
          <p className="warn-box">
            Cả {rooms.length} phòng đều đang có khách. Đóng một phiên ở trên để
            tạo mã mới.
          </p>
        ) : (
          <>
            <label className="field-label">Phòng</label>
            <div className="pkg-row">
              {rooms.map((r) => (
                <button
                  key={r.id}
                  className={r.id === room ? 'pkg on' : 'pkg'}
                  disabled={r.busy}
                  title={r.busy ? `Đang có phiên ${r.session?.code}` : ''}
                  onClick={() => setRoom(r.id)}
                >
                  Phòng {r.id}{r.busy ? ' · bận' : ''}
                </button>
              ))}
            </div>

            <label className="field-label">Số kiểu ảnh</label>
            <div className="pkg-row">
              {PACKAGES.map((n) => (
                <button
                  key={n}
                  className={n === maxPhotos ? 'pkg on' : 'pkg'}
                  onClick={() => setMaxPhotos(n)}
                >
                  {n} kiểu
                </button>
              ))}
            </div>

            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={!room || busy} onClick={onCreate}>
              {busy ? 'Đang tạo...' : room ? `Tạo mã cho phòng ${room}` : 'Chọn phòng trước'}
            </button>
          </>
        )}
      </section>

      </div>

      <div className="col-right">
      <section className="card">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Mã</th><th>Trạng thái</th><th>Phòng</th>
              <th>Ảnh</th><th>Đã ghép</th><th>Bắt đầu</th><th>Kết thúc</th><th></th>
            </tr>
          </thead>
          <tbody>
            {slice.map((s) => (
              <tr key={s.id}>
                {/* data-label dùng cho bố cục thẻ trên điện thoại (xem staff.css) */}
                <td className="mono" data-label="Mã">{s.code}</td>
                <td data-label="Trạng thái">
                  <span className={`badge ${s.status}`}>{STATUS_LABEL[s.status] ?? s.status}</span>
                </td>
                <td data-label="Phòng">{s.room ?? '—'}</td>
                <td data-label="Ảnh">{s.photos}/{s.maxPhotos}</td>
                <td data-label="Đã ghép">{s.composites}</td>
                <td data-label="Bắt đầu">
                  <span className="when">
                    <b>{fmtWhen(s.createdAt).day}</b>
                    {fmtWhen(s.createdAt).time}
                  </span>
                </td>
                <td data-label="Kết thúc">
                  {s.doneAt ? (
                    <span className="when">
                      <b>{fmtWhen(s.doneAt).day}</b>
                      {fmtWhen(s.doneAt).time}
                    </span>
                  ) : (
                    <span className="dash">—</span>
                  )}
                </td>
                <td className="right">
                  {s.photos > 0 && s.status !== 'expired' && (
                    <button
                      className="link"
                      onClick={() => staffSessionDetail(s.id).then(setDetail)}
                    >
                      Xem ảnh
                    </button>
                  )}
                  {CLOSABLE.has(s.status) && (
                    <button className="link" disabled={busy}
                      onClick={() => onClose(s.id, s.code)}>
                      Đóng
                    </button>
                  )}

                </td>
              </tr>
            ))}
          </tbody>
        </table>

      {rows.length === 0 && <p className="empty">Chưa có phiên nào</p>}
      </div>
      </section>

      {pageCount > 1 && (
        <nav className="pager" aria-label="Phân trang danh sách phiên">
          <button
            className="pg"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            ← Mới hơn
          </button>
          <span className="pg-info">
            Trang {current + 1}/{pageCount} · {rows.length} phiên
          </span>
          <button
            className="pg"
            disabled={current >= pageCount - 1}
            onClick={() => setPage(current + 1)}
          >
            Cũ hơn →
          </button>
        </nav>
      )}
      </div>
      </div>
      )}

      {/* Lấy hộ khách quên tải */}
      {detail && (
        <div className="modal" onClick={() => setDetail(null)}>
          <div className="modal-inner" onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>Phiên {detail.session.code}</h2>
              <button className="ghost" onClick={() => setDetail(null)}>Đóng</button>
            </header>

            {detail.composites.length > 0 && (
              <>
                <h3>Ảnh đã ghép khung</h3>
                <div className="grid">
                  {detail.composites.map((c) => (
                    <a
                      key={c.id}
                      href={compositeUrl(c.id, c.slug)}
                      download={`${detail.session.code}-${c.frameId}.png`}
                      className="thumb composite"
                    >
                      <img src={compositeUrl(c.id, c.slug)} alt="" />
                      <span>Tải về</span>
                    </a>
                  ))}
                </div>
              </>
            )}

            <h3>Ảnh gốc ({detail.photos.length})</h3>
            <div className="grid">
              {detail.photos.map((p) => (
                <a
                  key={p.id}
                  href={`/media/originals/${p.id}?t=${encodeURIComponent(detail.token)}`}
                  download={`${detail.session.code}-${String(p.seq).padStart(2, '0')}.jpg`}
                  className="thumb"
                >
                  <img src={photoUrl(p.id, detail.token)} alt="" />
                  <span>Tải về</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {dialog}
    </div>
  );
}
