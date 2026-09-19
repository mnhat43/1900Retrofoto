import { useCallback, useEffect, useState } from 'react';
import {
  staffStats, staffPrices, createPrice, updatePrice, deletePrice, setSessionPrice,
  type DayStats, type PriceInfo,
} from '../../api';
import { useDialog } from './useDialog';

/**
 * Doanh thu theo ngày, và bảng giá của quán.
 *
 * Tách khỏi tab "Phiên chụp" vì hai thứ phục vụ hai người khác nhau: nhân viên
 * nhìn bảng phiên để THAO TÁC (hiện QR, đóng phiên), còn chủ quán mở doanh thu
 * để XEM SỔ. Gộp làm một thì cột nào cũng thừa với một nửa số người dùng.
 */

/** 100000 -> "100.000đ". Dấu chấm phân nhóm như cách viết ở Việt Nam. */
const tien = (n: number) => n.toLocaleString('vi-VN') + 'đ';

function homNayStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "2026-09-19" -> "19/09", hoặc "Hôm nay" nếu trùng. */
function nhanNgay(day: string, homNay: string): string {
  if (day === homNay) return 'Hôm nay';
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
}

export default function RevenuePanel() {
  const [stats, setStats] = useState<DayStats | null>(null);
  const [prices, setPrices] = useState<PriceInfo[]>([]);
  const [day, setDay] = useState(homNayStamp());
  const [suaGia, setSuaGia] = useState<string | null>(null);
  const [moBangGia, setMoBangGia] = useState(false);
  const [busy, setBusy] = useState(false);
  const homNay = homNayStamp();

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([staffStats(day), staffPrices()]);
      setStats(s);
      setPrices(p.prices);
    } catch { /* mất mạng tạm thì lần sau tải lại */ }
  }, [day]);

  useEffect(() => { load(); }, [load]);

  async function doiGia(id: string, priceId: string | null) {
    setBusy(true);
    try {
      await setSessionPrice(id, priceId);
      setSuaGia(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!stats) return <p className="empty">Đang tải...</p>;
  const dangBat = prices.filter((p) => p.enabled);

  return (
    <>
      <section className="card">
        <div className="rev-head">
          <div className="rev-days">
            {/*
              Chỉ hiện ngày CÓ phiên, không phải lịch đầy đủ — nhân viên nhớ
              "hôm qua, hôm kia" chứ không nhớ ngày tháng cụ thể.
            */}
            {!stats.days.includes(homNay) && (
              <button
                className={day === homNay ? 'pkg on' : 'pkg'}
                onClick={() => setDay(homNay)}
              >
                Hôm nay
              </button>
            )}
            {stats.days.slice(0, 10).map((d) => (
              <button
                key={d}
                className={d === day ? 'pkg on' : 'pkg'}
                onClick={() => setDay(d)}
              >
                {nhanNgay(d, homNay)}
              </button>
            ))}
          </div>

          <div className="rev-total">
            <span className="dim">Tổng {nhanNgay(day, homNay).toLowerCase()}</span>
            <b>{tien(stats.total)}</b>
            <span className="dim">{stats.counted} lượt</span>
          </div>
        </div>

        {/*
          Nói rõ khi có phiên chưa gắn giá. Không im lặng bỏ qua: tổng thiếu
          tiền mà không ai biết vì sao là kiểu sai sổ tệ nhất.
        */}
        {stats.missing > 0 && (
          <p className="rev-warn">
            {stats.missing} phiên chưa có giá, không tính vào tổng.
          </p>
        )}

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Mã</th><th>Phòng</th><th>Ảnh</th>
                <th>Giá</th><th>Lúc</th><th></th>
              </tr>
            </thead>
            <tbody>
              {stats.sessions.map((s) => (
                <tr key={s.id}>
                  <td className="mono" data-label="Mã">{s.code}</td>
                  <td data-label="Phòng">{s.room ?? '—'}</td>
                  <td data-label="Ảnh">{s.photos}</td>
                  <td data-label="Giá">
                    {s.priceAmount == null ? (
                      <span className="dash">—</span>
                    ) : (
                      <span className="rev-amount">
                        {tien(s.priceAmount)}
                        {s.priceLabel && <em>{s.priceLabel}</em>}
                      </span>
                    )}
                  </td>
                  <td data-label="Lúc">
                    {new Date(s.createdAt).toLocaleTimeString('vi-VN', {
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td className="right">
                    {suaGia === s.id ? (
                      <span className="rev-pick">
                        {dangBat.map((p) => (
                          <button key={p.id} className="link" disabled={busy}
                            onClick={() => doiGia(s.id, p.id)}>
                            {tien(p.amount)}
                          </button>
                        ))}
                        <button className="link" disabled={busy}
                          onClick={() => doiGia(s.id, null)}>
                          Gỡ
                        </button>
                        <button className="link" onClick={() => setSuaGia(null)}>
                          Thôi
                        </button>
                      </span>
                    ) : (
                      <button className="link" onClick={() => setSuaGia(s.id)}>
                        {s.priceAmount == null ? 'Đặt giá' : 'Đổi giá'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {stats.sessions.length === 0 && (
          <p className="empty">Ngày này chưa có phiên nào</p>
        )}
      </section>

      <section className="card">
        <p className="setting-row">
          <span>Bảng giá của quán — <b>{prices.length}</b> gói</span>
          <button className="link" onClick={() => setMoBangGia((v) => !v)}>
            {moBangGia ? 'Thu lại' : 'Mở'}
          </button>
        </p>
        {moBangGia && <BangGia prices={prices} onChange={load} />}
      </section>
    </>
  );
}

/** Thêm, bật/tắt, xoá gói giá. */
function BangGia({ prices, onChange }: { prices: PriceInfo[]; onChange: () => void }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { ask, dialog } = useDialog();

  async function them() {
    setBusy(true);
    setError('');
    try {
      await createPrice(label, Number(amount));
      setLabel('');
      setAmount('');
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="price-list">
      {dialog}

      {prices.map((p) => (
        <div key={p.id} className={p.enabled ? 'price-row' : 'price-row off'}>
          <span className="price-label">{p.label}</span>
          <span className="price-amount">{tien(p.amount)}</span>
          <button className="link" onClick={async () => {
            await updatePrice(p.id, { enabled: !p.enabled });
            onChange();
          }}>
            {p.enabled ? 'Tắt' : 'Bật'}
          </button>
          <button className="link danger" onClick={() => ask({
            title: `Xoá gói "${p.label}"?`,
            message: 'Doanh thu đã ghi của những ngày trước KHÔNG đổi — mỗi phiên'
              + ' lưu số tiền riêng, không tra ngược về gói.',
            danger: true,
            confirmLabel: 'Xoá',
            onConfirm: () => { deletePrice(p.id).then(onChange); },
          })}>
            Xoá
          </button>
        </div>
      ))}

      <div className="price-add">
        <input
          placeholder="Tên gói"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          placeholder="Giá (đồng)"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
        />
        <button
          className="primary"
          disabled={busy || !label.trim() || !amount}
          onClick={them}
        >
          Thêm
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
