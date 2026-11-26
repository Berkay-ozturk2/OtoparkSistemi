import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cashPayment, getActiveSessions, manualExit } from '../../api/operator';
import useParkingHub from '../../realtime/useParkingHub';
import PageHeader from '../../components/PageHeader';
import PlateBadge from '../../components/PlateBadge';
import LiveBadge from '../../components/LiveBadge';
import Loading from '../../components/Loading';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import ConfirmModal from '../../components/ConfirmModal';
import LotSelector from '../../components/LotSelector';
import { useLot } from '../../lot/LotContext';
import { useToast } from '../../components/Toast';
import { normalizePlate } from '../../utils/plate';
import { decisionInfo, formatCurrency, formatDateTime, formatDuration, minutesSince } from '../../utils/format';

/** Aktif oturumlar: arama, nakit ödeme (UC-03 gişe), manuel çıkış */
export default function AktifAraclar() {
  const toast = useToast();
  const { lotCode: ctxLot, lotName } = useLot();
  const [lot, setLot] = useState(ctxLot); // '' = tüm otoparklar
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all'); // all | unpaid | paid
  const [sort, setSort] = useState('entryDesc');
  const [cashFor, setCashFor] = useState(null);
  const [exitFor, setExitFor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const reloadTimer = useRef(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await getActiveSessions(lot || undefined);
      setSessions(Array.isArray(s) ? s : []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [lot]);

  useEffect(() => {
    load();
    const poll = setInterval(load, 60000);
    const tick = setInterval(() => setTick((x) => x + 1), 30000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    };
  }, [load]);

  // Giriş/çıkış olduğunda listeyi kısa gecikmeyle tazele
  const { status } = useParkingHub(
    {
      onGateEvent: () => {
        if (reloadTimer.current) clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(load, 700);
      },
      onReconnected: () => load(),
    },
    { withAuth: true },
  );

  const rows = useMemo(() => {
    const q = normalizePlate(query);
    let list = sessions.filter((s) => !q || normalizePlate(s.plate).includes(q));
    if (filter === 'unpaid') list = list.filter((s) => !s.isPaid);
    if (filter === 'paid') list = list.filter((s) => s.isPaid);
    if (filter === 'disabled') list = list.filter((s) => s.isDisabledPermit);
    const sorted = [...list];
    if (sort === 'entryDesc') sorted.sort((a, b) => new Date(b.entryTime) - new Date(a.entryTime));
    if (sort === 'entryAsc') sorted.sort((a, b) => new Date(a.entryTime) - new Date(b.entryTime));
    if (sort === 'feeDesc') sorted.sort((a, b) => (Number(b.fee) || 0) - (Number(a.fee) || 0));
    return sorted;
  }, [sessions, query, filter, sort]);

  const unpaidTotal = sessions.filter((s) => !s.isPaid).reduce((sum, s) => sum + Math.max(0, (Number(s.fee) || 0) - (Number(s.paidAmount) || 0)), 0);

  const doCash = async () => {
    setBusy(true);
    try {
      const res = await cashPayment(cashFor.id);
      if (res?.status === 'Success' || res?.status === undefined) {
        toast.success(res?.message || `${formatCurrency(res?.amount ?? cashFor.fee)} nakit ödeme alındı.`);
      } else {
        toast.warning(res?.message || 'Ödeme kaydedilemedi.');
      }
      setCashFor(null);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const doExit = async () => {
    setBusy(true);
    try {
      const res = await manualExit(normalizePlate(exitFor.plate), exitFor.lotCode || lot || undefined);
      const info = decisionInfo(res?.decision);
      const msg = res?.message || info.label;
      if (res?.decision === 'Allowed') toast.success(`Çıkış yapıldı: ${msg}`);
      else toast.warning(`${info.label}: ${msg}`);
      setExitFor(null);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const due = (s) => Math.max(0, (Number(s.fee) || 0) - (Number(s.paidAmount) || 0));

  return (
    <div>
      <PageHeader
        icon="bi-car-front"
        title="Aktif Araçlar"
        badge={<span className="badge rounded-pill text-bg-primary fs-6">{sessions.length}</span>}
        subtitle="Otoparkta bulunan araçlar. Gişede nakit ödeme alabilir veya manuel çıkış yapabilirsiniz."
        actions={
          <>
            <LotSelector value={lot} onChange={setLot} allowAll />
            <LiveBadge status={status} />
            <button type="button" className="btn btn-outline-primary" onClick={load}>
              <i className="bi bi-arrow-clockwise me-1" />
              Yenile
            </button>
          </>
        }
      />

      <div className="card mb-3">
        <div className="card-body">
          <div className="row g-2 align-items-center">
            <div className="col-md-5">
              <div className="input-group">
                <span className="input-group-text">
                  <i className="bi bi-search" />
                </span>
                <input
                  className="form-control text-uppercase"
                  placeholder="Plaka ara…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Plaka ara"
                />
                {query && (
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setQuery('')} aria-label="Temizle">
                    <i className="bi bi-x" />
                  </button>
                )}
              </div>
            </div>
            <div className="col-6 col-md-3">
              <select className="form-select" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Ödeme filtresi">
                <option value="all">Tümü</option>
                <option value="unpaid">Ödenmemiş</option>
                <option value="paid">Ödenmiş</option>
                <option value="disabled">♿ Engelli izinli</option>
              </select>
            </div>
            <div className="col-6 col-md-2">
              <select className="form-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sıralama">
                <option value="entryDesc">En yeni giriş</option>
                <option value="entryAsc">En eski giriş</option>
                <option value="feeDesc">En yüksek ücret</option>
              </select>
            </div>
            <div className="col-md-2 text-md-end small">
              <div className="text-secondary">Tahsil edilecek</div>
              <div className="fw-bold">{formatCurrency(unpaidTotal)}</div>
            </div>
          </div>
        </div>
      </div>

      <ErrorAlert error={error} onRetry={load} className="mb-3" />

      <div className="card">
        <div className="card-body p-0">
          {loading ? (
            <Loading />
          ) : rows.length === 0 ? (
            <EmptyState icon="bi-car-front" title={sessions.length === 0 ? 'Otoparkta araç yok' : 'Aramaya uyan araç yok'}>
              {sessions.length === 0 ? 'Yeni giriş olduğunda liste otomatik güncellenir.' : 'Arama veya filtre ölçütlerini değiştirin.'}
            </EmptyState>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>Plaka</th>
                    {!lot && <th>Otopark</th>}
                    <th>Bölge</th>
                    <th>Giriş</th>
                    <th>Süre</th>
                    <th className="text-end">Ücret</th>
                    <th className="text-end">Ödenen</th>
                    <th>Durum</th>
                    <th className="text-end">İşlemler</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td className="text-nowrap">
                        <PlateBadge plate={s.plate} />
                        {s.isDisabledPermit && (
                          <span className="badge badge-disabled ms-1" title="Engelli izinli araç">
                            <span aria-hidden="true">♿</span>
                          </span>
                        )}
                      </td>
                      {!lot && <td className="small">{s.lotName || lotName(s.lotCode)}</td>}
                      <td>{s.zoneCode ? <span className="badge text-bg-primary">{s.zoneCode}</span> : '—'}</td>
                      <td className="text-nowrap small">{formatDateTime(s.entryTime)}</td>
                      <td className="text-nowrap">{formatDuration(minutesSince(s.entryTime))}</td>
                      <td className="text-end fw-semibold">{formatCurrency(s.fee)}</td>
                      <td className="text-end">{formatCurrency(s.paidAmount)}</td>
                      <td>
                        {s.isPaid ? (
                          <span className="badge text-bg-success">Ödendi</span>
                        ) : (
                          <span className="badge text-bg-warning">Ödenmedi</span>
                        )}
                      </td>
                      <td className="text-end text-nowrap">
                        {!s.isPaid && due(s) > 0 && (
                          <button type="button" className="btn btn-sm btn-success me-1" onClick={() => setCashFor(s)}>
                            <i className="bi bi-cash-coin me-1" />
                            Nakit Al
                          </button>
                        )}
                        <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setExitFor(s)}>
                          <i className="bi bi-box-arrow-right me-1" />
                          Çıkış
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        show={!!cashFor}
        title="Nakit ödeme al"
        icon="bi-cash-coin"
        variant="success"
        confirmText="Ödemeyi kaydet"
        busy={busy}
        onConfirm={doCash}
        onCancel={() => setCashFor(null)}
      >
        {cashFor && (
          <div className="text-center">
            <PlateBadge plate={cashFor.plate} size="lg" />
            <div className="mt-3 text-secondary">
              Giriş: {formatDateTime(cashFor.entryTime)} · {formatDuration(minutesSince(cashFor.entryTime))}
            </div>
            <div className="display-6 fw-bold mt-2">{formatCurrency(due(cashFor))}</div>
            <div className="small text-secondary">Gişede nakit tahsil edildiğini onaylıyor musunuz?</div>
          </div>
        )}
      </ConfirmModal>

      <ConfirmModal
        show={!!exitFor}
        title="Manuel çıkış"
        icon="bi-box-arrow-right"
        variant="primary"
        confirmText="Çıkış yap"
        busy={busy}
        onConfirm={doExit}
        onCancel={() => setExitFor(null)}
      >
        {exitFor && (
          <>
            <p>
              <PlateBadge plate={exitFor.plate} size="sm" /> plakalı araç için manuel çıkış işlemi yapılacak.
            </p>
            {!exitFor.isPaid && due(exitFor) > 0 && (
              <div className="alert alert-warning small mb-0">
                <i className="bi bi-exclamation-triangle me-1" />
                Bu aracın {formatCurrency(due(exitFor))} ödenmemiş ücreti var; sistem çıkışı reddedebilir. Önce nakit
                ödeme alın.
              </div>
            )}
          </>
        )}
      </ConfirmModal>
    </div>
  );
}
