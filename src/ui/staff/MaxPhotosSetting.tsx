import { useEffect, useState } from 'react';
import { staffSettings, saveStaffSettings, type StaffSettings } from '../../api';

/**
 * Trần ảnh cho MỌI phiên tạo mới.
 *
 * Đây là thiết lập của quán, không phải lựa chọn từng lượt khách — nên nó nằm
 * lặng lẽ dưới đáy thẻ "Tạo phiên chụp", chữ nhỏ và xám, phải bấm "Đổi" mới
 * sửa được. Nút nhân viên bấm cả trăm lần mỗi ngày là "Tạo mã"; thứ vài tháng
 * mới đụng tới một lần thì không được tranh chỗ với nó.
 *
 * Vì sao vẫn cần một cái trần: nếu thư mục chụp bị trỏ nhầm vào kho ảnh cũ,
 * "Đã chụp xong" sẽ nạp sạch kho đó vào phiên của khách. Có trần thì thiệt
 * hại dừng ở một con số, không phải cả ổ đĩa.
 */
export default function MaxPhotosSetting() {
  const [cfg, setCfg] = useState<StaffSettings | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    staffSettings()
      .then((r) => { if (alive) setCfg(r); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!cfg) return null;

  function open() {
    setDraft(String(cfg!.maxPhotosPerSession));
    setError('');
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      // Server trả về giá trị nó thực sự lưu -> hiện đúng cái đó, không đoán
      const r = await saveStaffSettings(Number(draft));
      setCfg({ ...cfg!, maxPhotosPerSession: r.maxPhotosPerSession });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <p className="setting-row">
        <span>Tối đa <b>{cfg.maxPhotosPerSession}</b> ảnh mỗi phiên</span>
        <button className="link" onClick={open}>Đổi</button>
      </p>
    );
  }

  return (
    <div className="setting-edit">
      <label htmlFor="max-photos">Số ảnh tối đa mỗi phiên</label>
      <div className="setting-edit-row">
        <input
          id="max-photos"
          type="number"
          min={cfg.maxPhotosMin}
          max={cfg.maxPhotosMax}
          value={draft}
          disabled={busy}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <button className="primary small" disabled={busy} onClick={save}>
          {busy ? '...' : 'Lưu'}
        </button>
        <button className="link" disabled={busy} onClick={() => setEditing(false)}>
          Huỷ
        </button>
      </div>
      <span className="dim">
        Từ {cfg.maxPhotosMin} đến {cfg.maxPhotosMax}. Chỉ áp cho phiên tạo sau
        khi đổi — phiên đang mở giữ nguyên trần cũ.
      </span>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
