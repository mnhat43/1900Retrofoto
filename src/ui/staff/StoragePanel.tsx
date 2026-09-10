import { useCallback, useEffect, useState } from 'react';
import { staffDisk, staffCleanup, type DiskInfo, type CleanupTier } from '../../api';
import { useDialog } from './useDialog';

/**
 * Ổ đĩa và dọn dẹp ảnh cũ.
 *
 * Vì sao có màn này: ảnh gốc máy DSLR cỡ 10-25MB một tấm. Không ai theo dõi
 * dung lượng thì đến một hôm ổ đầy giữa buổi bán hàng, ảnh khách không lưu
 * được và chẳng có gì báo trước. Ở đây nhân viên thấy còn bao nhiêu, và bấm
 * một nút là dọn được — không cần mở File Explorer, không cần biết ảnh nằm ở
 * thư mục nào.
 */

const GB = 1024 ** 3;

function fmtSize(bytes: number): string {
  if (bytes <= 0) return '0 GB';
  if (bytes < GB) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}

/** Lời khuyên viết cho người không biết máy tính, không phải mã lỗi. */
const ADVICE: Record<DiskInfo['level'], string> = {
  ok: 'Ổ đĩa còn thoải mái. Không cần làm gì.',
  warn: 'Ổ đĩa sắp đầy. Nên dọn ảnh cũ trong tuần này.',
  critical: 'Ổ đĩa gần hết. DỌN NGAY, nếu không ảnh khách sẽ không lưu được.',
};

export default function StoragePanel() {
  const [disk, setDisk] = useState<DiskInfo | null>(null);
  const [tiers, setTiers] = useState<CleanupTier[]>([]);
  const [retentionDays, setRetentionDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const { ask, dialog } = useDialog();

  const load = useCallback(async () => {
    try {
      const r = await staffDisk(true);
      setDisk(r.disk);
      setTiers(r.tiers ?? []);
      setRetentionDays(r.retentionDays);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không đọc được ổ đĩa');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function onCleanup(tier: CleanupTier) {
    ask({
      title: `Xoá ảnh cũ hơn ${tier.days} ngày?`,
      message:
        `Sẽ xoá ảnh của ${tier.sessions} phiên, giải phóng khoảng ` +
        `${fmtSize(tier.bytes)}.\n\n` +
        'Ảnh đã xoá KHÔNG lấy lại được. Danh sách phiên vẫn còn để tra cứu.',
      confirmLabel: `Xoá ${tier.sessions} phiên`,
      danger: true,
      onConfirm: async () => {
        setBusy(true);
        setError('');
        setDone('');
        try {
          const r = await staffCleanup(tier.days);
          setDisk(r.disk);
          setTiers(r.tiers);
          setDone(`Đã xoá ảnh của ${r.purged} phiên. Ổ đĩa còn ${fmtSize(r.disk.freeBytes)}.`);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Không dọn được');
        } finally {
          setBusy(false);
        }
      },
    });
  }

  if (!disk) {
    return (
      <div className="storage">
        <section className="card">
          <p>{error || 'Đang đọc ổ đĩa...'}</p>
        </section>
      </div>
    );
  }

  /*
   * Ổ đĩa đọc không được (ổ rời bị rút, ký tự ổ đổi từ E: sang F:). Đây là
   * chuyện thật sẽ xảy ra, và im lặng hiện 0 GB thì nhân viên sẽ tưởng ổ đầy.
   */
  if (!disk.ok) {
    return (
      <div className="storage">
        <section className="card">
          <h2>Ổ đĩa</h2>
          <p className="warn-box">
            Không đọc được ổ <b>{disk.drive}</b>. Thư mục ảnh đang đặt ở{' '}
            <code>{disk.dataDir}</code>.
            <br />
            Nếu đây là ổ cắm ngoài, kiểm tra xem có bị rút ra hoặc đổi ký tự ổ
            không, rồi chạy lại <b>KIEM-TRA.bat</b>.
          </p>
        </section>
        {dialog}
      </div>
    );
  }

  const usedBytes = disk.totalBytes - disk.freeBytes;
  const usedPct = disk.totalBytes > 0
    ? Math.min(100, Math.round((usedBytes / disk.totalBytes) * 100))
    : 0;

  return (
    <div className="storage">
      <section className="card">
        <h2>Ổ đĩa {disk.drive}</h2>

        <div className={`disk-big ${disk.level}`}>
          <span className="disk-free">{fmtSize(disk.freeBytes)}</span>
          <span className="disk-cap">còn trống / {fmtSize(disk.totalBytes)}</span>
        </div>

        <div className={`disk-bar ${disk.level}`}>
          <div className="fill" style={{ width: `${usedPct}%` }} />
        </div>

        <p className={disk.level === 'ok' ? 'disk-advice' : 'warn-box'}>
          {ADVICE[disk.level]}
        </p>

        <dl className="disk-facts">
          <div>
            <dt>Ảnh gốc + ảnh ghép</dt>
            <dd>{fmtSize(disk.usedByPhotosBytes)}</dd>
          </div>
          <div>
            <dt>Thư mục ảnh</dt>
            <dd><code>{disk.dataDir}</code></dd>
          </div>
          <div>
            <dt>Tự xoá sau</dt>
            <dd>{retentionDays} ngày</dd>
          </div>
        </dl>
      </section>

      <section className="card">
        <h2>Dọn ảnh cũ</h2>
        <p className="hint">
          Hệ thống đã tự xoá ảnh quá {retentionDays} ngày. Các nút dưới đây để
          dọn <b>mạnh tay hơn</b> khi ổ sắp đầy — chọn mốc từ trên xuống, dừng
          lại khi đủ chỗ.
        </p>

        {error && <p className="error">{error}</p>}
        {done && <p className="ok-box">{done}</p>}

        <div className="tiers">
          {tiers.map((t) => (
            <button
              key={t.days}
              className="tier"
              disabled={busy || t.sessions === 0}
              onClick={() => onCleanup(t)}
            >
              <span className="tier-when">Cũ hơn {t.days} ngày</span>
              <span className="tier-what">
                {t.sessions === 0
                  ? 'Không có gì để xoá'
                  : `${t.sessions} phiên · ${fmtSize(t.bytes)}`}
              </span>
            </button>
          ))}
        </div>

        <p className="hint">
          Phiên đang có khách trong phòng không bao giờ bị xoá, kể cả khi đã
          quá mốc.
        </p>
      </section>

      {dialog}
    </div>
  );
}
