import { useCallback, useEffect, useState } from 'react';
import { getAbandoned, getSettings } from '../../api/admin';
import { manualExit } from '../../api/operator';
import PageHeader from '../../components/PageHeader';
import PlateBadge from '../../components/PlateBadge';
import Loading from '../../components/Loading';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import ConfirmModal from '../../components/ConfirmModal';
import LotSelector from '../../components/LotSelector';
import { useLot } from '../../lot/LotContext';
import { useToast } from '../../components/Toast';
import { downloadCsv, csvNumber } from '../../utils/csv';
import { normalizePlate } from '../../utils/plate';
import { decisionInfo, formatCurrency, formatDateTime, formatDuration, formatNumber, minutesSince } from '../../utils/format';

function severity(hours) {
  if (hours >= 72) return { variant: 'danger', label: 'Kritik' };
  if (hours >= 24) return { variant: 'warning', label: 'Yüksek' };
  return { variant: 'info', label: 'Dikkat' };
}

/** UC-09: Terk edilmiş araçları görüntüle */
export default function TerkEdilmis() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const { lotName } = useLot();
  const [lot, setLot] = useState(''); // '' = tüm otoparklar
  const [threshold, setThreshold] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exitFor, setExitFor] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [a, s] = await Promise.all([getAbandoned(lot || undefined), getSettings().catch(() => null)]);
      const arr = Array.isArray(a) ? a : [];
      setList([...arr].sort((x, y) => (Number(y.overdueHours) || 0) - (Number(x.overdueHours) || 0)));
      setThreshold(s?.abandonedThresholdHours ?? null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [lot]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = () => {
    downloadCsv(
      `terk-edilmis-araclar-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Plaka', 'Bölge', 'Giriş', 'Süre (dk)', 'Gecikme (saat)', 'Ücret (TL)', 'Ödendi'],
      list.map((s) => [
        normalizePlate(s.plate),
        s.zoneCode || '',
        formatDateTime(s.entryTime),
        minutesSince(s.entryTime),
        csvNumber(s.overdueHours, 1),
        csvNumber(s.fee),
        s.isPaid ? 'Evet' : 'Hayır',
      ]),
    );
  };

  const doExit = async () => {
    setBusy(true);
    try {
      const res = await manualExit(normalizePlate(exitFor.plate), exitFor.lotCode || lot || undefined);
      const info = decisionInfo(res?.decision);
      if (res?.decision === 'Allowed') toast.success(res?.message || 'Çıkış yapıldı.');
      else toast.warning(`${info.label}: ${res?.message || ''}`);
      setExitFor(null);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        icon="bi-exclamation-octagon"
        title="Terk Edilmiş Araçlar"
        badge={list.length > 0 ? <span className="badge rounded-pill text-bg-danger fs-6">{list.length}</span> : null}
        subtitle={
          threshold != null
            ? `Otoparkta ${threshold} saatten uzun süredir bulunan (azami süreyi aşan) açık oturumlar.`
            : 'Azami park süresini aşan açık oturumlar.'
        }
        actions={
          <>
            <LotSelector value={lot} onChange={setLot} allowAll />
            <button type="button" className="btn btn-outline-secondary" onClick={exportCsv} disabled={list.length === 0}>
              <i aria-hidden="true" className="bi bi-filetype-csv me-1" />
              CSV
            </button>
            <button type="button" className="btn btn-outline-primary" onClick={load}>
              <i aria-hidden="true" className="bi bi-arrow-clockwise me-1" />
              Yenile
            </button>
          </>
        }
      />

      <ErrorAlert error={error} onRetry={load} className="mb-3" />

      <div className="card">
        <div className="card-body p-0">
          {loading ? (
            <Loading />
          ) : list.length === 0 ? (
            <EmptyState icon="bi-emoji-smile" title="Terk edilmiş araç yok">
              Azami süreyi aşan açık park oturumu bulunmuyor.
            </EmptyState>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>Plaka</th>
                    <th>Otopark</th>
                    <th>Bölge</th>
                    <th>Giriş</th>
                    <th>Toplam süre</th>
                    <th>Gecikme</th>
                    <th className="text-end">Biriken ücret</th>
                    <th>Ödeme</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => {
                    const sev = severity(Number(s.overdueHours) || 0);
                    return (
                      <tr key={s.id}>
                        <td>
                          <PlateBadge plate={s.plate} />
                        </td>
                        <td className="small">{s.lotName || lotName(s.lotCode)}</td>
                        <td>{s.zoneCode ? <span className="badge text-bg-primary">{s.zoneCode}</span> : '—'}</td>
                        <td className="small text-nowrap">{formatDateTime(s.entryTime)}</td>
                        <td className="text-nowrap">{formatDuration(s.durationMinutes ?? minutesSince(s.entryTime))}</td>
                        <td>
                          <span className={`badge text-bg-${sev.variant}`}>
                            +{formatNumber(s.overdueHours)} sa · {sev.label}
                          </span>
                        </td>
                        <td className="text-end fw-semibold">{formatCurrency(s.fee)}</td>
                        <td>{s.isPaid ? <span className="badge text-bg-success">Ödendi</span> : <span className="badge text-bg-warning">Ödenmedi</span>}</td>
                        <td className="text-end">
                          <button type="button" className="btn btn-sm btn-outline-primary text-nowrap" onClick={() => setExitFor(s)}>
                            <i aria-hidden="true" className="bi bi-box-arrow-right me-1" />
                            Çıkış
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="small text-secondary mt-3">
        <i aria-hidden="true" className="bi bi-info-circle me-1" />
        Eşik değeri <strong>Tarifeler ve Ayarlar</strong> sayfasındaki &quot;Terk edilmiş araç eşiği&quot; alanından değiştirilebilir.
      </div>

      <ConfirmModal
        show={!!exitFor}
        title="Manuel çıkış"
        icon="bi-box-arrow-right"
        confirmText="Çıkış yap"
        busy={busy}
        onConfirm={doExit}
        onCancel={() => setExitFor(null)}
      >
        {exitFor && (
          <p className="mb-0">
            <PlateBadge plate={exitFor.plate} size="sm" /> plakalı araç (çekici vb. ile) otoparktan çıkarıldıysa oturumu
            manuel çıkışla kapatabilirsiniz. Ödenmemiş ücret varsa sistem çıkışı reddedebilir.
          </p>
        )}
      </ConfirmModal>
    </div>
  );
}
