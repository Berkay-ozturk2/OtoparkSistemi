import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getViolations } from '../../api/operator';
import useParkingHub from '../../realtime/useParkingHub';
import PageHeader from '../../components/PageHeader';
import LotSelector from '../../components/LotSelector';
import LiveBadge from '../../components/LiveBadge';
import Loading from '../../components/Loading';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import StatCard from '../../components/StatCard';
import ViolationResolveModal from '../../components/ViolationResolveModal';
import { useToast } from '../../components/Toast';
import { useLot } from '../../lot/LotContext';
import { playAlert } from '../../utils/sound';
import { downloadCsv } from '../../utils/csv';
import { VIOLATION_STATUS, formatDateTime, timeAgo, violationStatus } from '../../utils/format';

const STATUS_OPTIONS = [
  { value: 'Open', label: 'Açık' },
  { value: 'Resolved', label: 'Çözüldü' },
  { value: 'FalseAlarm', label: 'Yanlış alarm' },
  { value: '', label: 'Tümü' },
];

/** Engelli park yeri ihlalleri (sözleşme 11.2 madde 5) — operatör/yönetici */
export default function Ihlaller() {
  const toast = useToast();
  const navigate = useNavigate();
  const { lotCode: ctxLot, setLotCode, lotName } = useLot();
  const [lot, setLot] = useState(ctxLot);
  const [status, setStatus] = useState('Open');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toResolve, setToResolve] = useState(null);
  const [resolveAs, setResolveAs] = useState('Resolved');
  const filterRef = useRef({ lot, status });
  filterRef.current = { lot, status };

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await getViolations({ lot: lot || undefined, status: status || undefined });
      setList(Array.isArray(res) ? res : []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [lot, status]);

  useEffect(() => {
    load();
  }, [load]);

  const matches = (v) => {
    const f = filterRef.current;
    return (!f.lot || (v.lotCode || 'GAZI') === f.lot) && (!f.status || v.status === f.status);
  };

  const { status: hubStatus } = useParkingHub(
    {
      onViolationDetected: (v) => {
        if (!v) return;
        playAlert('Violation');
        toast.show(`♿ Yeni ihlal: ${v.lotName || v.lotCode || ''} · ${v.slotCode}`, 'danger', 9000);
        const item = { status: 'Open', ...v, _new: true };
        if (matches(item)) setList((cur) => [item, ...cur.filter((x) => x.id !== v.id)]);
      },
      onViolationResolved: (v) => {
        if (!v) return;
        setList((cur) =>
          cur
            .map((x) => (x.id === v.id ? { ...x, status: v.status || 'Resolved', resolvedAt: x.resolvedAt || new Date().toISOString() } : x))
            .filter((x) => x.id !== v.id || matches(x)),
        );
      },
      onReconnected: load,
    },
    { withAuth: true },
  );

  const openCount = list.filter((v) => v.status === 'Open').length;

  const exportCsv = () => {
    downloadCsv(
      `ihlaller-${lot || 'tum'}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['No', 'Otopark', 'Cep', 'Bölge', 'Kat', 'Tespit', 'Kapanış', 'Durum', 'Not', 'Kapatan'],
      list.map((v) => [
        v.id,
        v.lotName || v.lotCode,
        v.slotCode,
        v.zoneCode,
        v.floor,
        formatDateTime(v.detectedAt),
        v.resolvedAt ? formatDateTime(v.resolvedAt) : '',
        violationStatus(v.status).label,
        v.note || '',
        v.resolvedBy || '',
      ]),
    );
  };

  return (
    <div>
      <PageHeader
        icon="bi-exclamation-diamond"
        title="Engelli Yeri İhlalleri"
        subtitle="Kamera, izinsiz bir aracın engelli cebine park ettiğini tespit ettiğinde ihlal açılır. Araç ayrılınca otomatik kapanır."
        badge={<LiveBadge status={hubStatus} />}
        actions={
          <>
            <button type="button" className="btn btn-outline-primary" onClick={exportCsv} disabled={list.length === 0}>
              <i aria-hidden="true" className="bi bi-download me-1" />
              CSV
            </button>
            <button type="button" className="btn btn-outline-primary" onClick={load} title="Yenile" aria-label="Yenile">
              <i aria-hidden="true" className="bi bi-arrow-clockwise" />
            </button>
          </>
        }
      />

      <div className="card mb-3">
        <div className="card-body d-flex flex-wrap align-items-end gap-3">
          <div>
            <div className="form-label small fw-semibold mb-1">Otopark</div>
            <LotSelector value={lot} onChange={setLot} allowAll align="start" />
          </div>
          <div>
            <div className="form-label small fw-semibold mb-1">Durum</div>
            <div className="btn-group btn-group-sm" role="group" aria-label="Durum filtresi">
              {STATUS_OPTIONS.map((o) => (
                <button
                  key={o.value || 'all'}
                  type="button"
                  className={`btn ${status === o.value ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => setStatus(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="ms-auto" style={{ minWidth: 220 }}>
            <StatCard
              icon="bi-exclamation-triangle"
              label="Listede açık ihlal"
              value={openCount}
              variant={openCount ? 'danger' : 'success'}
              size="sm"
            />
          </div>
        </div>
      </div>

      <ErrorAlert error={error} onRetry={load} className="mb-3" />

      <div className="card">
        <div className="card-body p-0">
          {loading && list.length === 0 ? (
            <Loading text="İhlaller yükleniyor…" />
          ) : list.length === 0 ? (
            <EmptyState icon="bi-shield-check" title={status === 'Open' ? 'Açık ihlal yok' : 'Bu filtrede ihlal yok'}>
              {status === 'Open' ? 'Engelli park yerleri kurala uygun kullanılıyor.' : 'Başka bir durum seçin.'}
            </EmptyState>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Otopark</th>
                    <th>Cep</th>
                    <th>Tespit</th>
                    <th>Durum</th>
                    <th>Not / Kapatan</th>
                    <th className="text-end">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((v) => {
                    const st = violationStatus(v.status);
                    return (
                      <tr key={v.id} className={v._new ? 'table-danger' : ''}>
                        <td className="text-secondary">{v.id}</td>
                        <td className="small">{v.lotName || lotName(v.lotCode)}</td>
                        <td>
                          <span className="badge badge-disabled">
                            <span aria-hidden="true">♿</span> {v.slotCode}
                          </span>
                          <div className="small text-secondary">
                            {v.zoneCode && <>{v.zoneCode} bölgesi</>}
                            {v.floor != null && <> · Kat {v.floor}</>}
                          </div>
                        </td>
                        <td className="small text-nowrap">
                          {formatDateTime(v.detectedAt)}
                          <div className="text-secondary">{timeAgo(v.detectedAt)}</div>
                        </td>
                        <td>
                          <span className={`badge text-bg-${st.variant}`}>
                            <i aria-hidden="true" className={`bi ${st.icon} me-1`} />
                            {st.label}
                          </span>
                          {v.resolvedAt && <div className="small text-secondary">{formatDateTime(v.resolvedAt)}</div>}
                        </td>
                        <td className="small">
                          {v.note || <span className="text-secondary">—</span>}
                          {v.resolvedBy && <div className="text-secondary">{v.resolvedBy}</div>}
                        </td>
                        <td className="text-end text-nowrap">
                          <button
                            type="button"
                            className="btn btn-sm btn-light me-1"
                            title="Canlı izlemede krokide göster" aria-label="Canlı izlemede krokide göster"
                            onClick={() => {
                              setLotCode(v.lotCode || 'GAZI');
                              navigate('/operator');
                            }}
                          >
                            <i aria-hidden="true" className="bi bi-map" />
                          </button>
                          {v.status === 'Open' && (
                            <>
                              <button
                                type="button"
                                className="btn btn-sm btn-success me-1"
                                onClick={() => {
                                  setResolveAs('Resolved');
                                  setToResolve(v);
                                }}
                              >
                                Çözüldü
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary"
                                onClick={() => {
                                  setResolveAs('FalseAlarm');
                                  setToResolve(v);
                                }}
                              >
                                Yanlış alarm
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card-footer small text-secondary">
          <i aria-hidden="true" className="bi bi-info-circle me-1" />
          Durumlar: {Object.values(VIOLATION_STATUS).map((x) => x.label).join(' · ')}. Yanlış alarm: araç izinli olduğu hâlde oturumla
          eşleşmediyse (ör. plaka okunamadı).
        </div>
      </div>

      <ViolationResolveModal
        violation={toResolve}
        initialStatus={resolveAs}
        onClose={() => setToResolve(null)}
        onResolved={(v, newStatus) => {
          setList((cur) =>
            cur
              .map((x) => (x.id === v.id ? { ...x, status: newStatus, resolvedAt: new Date().toISOString() } : x))
              .filter((x) => x.id !== v.id || !status || x.status === status),
          );
        }}
      />
    </div>
  );
}
