import { useCallback, useEffect, useState } from 'react';
import { getReviewQueue, resolveReview } from '../../api/operator';
import useParkingHub from '../../realtime/useParkingHub';
import PageHeader from '../../components/PageHeader';
import PlateBadge from '../../components/PlateBadge';
import LiveBadge from '../../components/LiveBadge';
import Loading from '../../components/Loading';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import { useToast } from '../../components/Toast';
import LotSelector from '../../components/LotSelector';
import { useLot } from '../../lot/LotContext';
import { isValidPlate, normalizePlate } from '../../utils/plate';
import { decisionInfo, formatDateTime, formatPercent, gateLabel, timeAgo, toImageSrc } from '../../utils/format';

function ReviewCard({ item, onResolved, lotLabel }) {
  const toast = useToast();
  const [plate, setPlate] = useState(normalizePlate(item.plateRead));
  const [busy, setBusy] = useState(null); // 'approve' | 'reject'
  const conf = Number(item.confidence) || 0;
  const confVariant = conf >= 0.7 ? 'success' : conf >= 0.4 ? 'warning' : 'danger';
  const valid = isValidPlate(plate);
  const img = toImageSrc(item.imageBase64);

  const resolve = async (approve) => {
    if (approve && !valid) {
      toast.warning('Onaylamak için geçerli bir plaka giriniz.');
      return;
    }
    setBusy(approve ? 'approve' : 'reject');
    try {
      const res = await resolveReview(item.id, { correctedPlate: normalizePlate(plate), approve });
      const info = decisionInfo(res?.decision);
      const msg = `${normalizePlate(plate) || item.plateRead}: ${res?.message || info.label}`;
      if (res?.decision === 'Allowed') toast.success(msg);
      else if (res?.decision === 'Denied') toast.warning(msg);
      else toast.info(msg);
      onResolved(item.id);
    } catch (err) {
      toast.error(err);
      setBusy(null);
    }
  };

  return (
    <div className="card h-100">
      <div className="card-body d-flex flex-column">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <span className={`badge text-bg-${item.gate === 'Exit' ? 'dark' : 'primary'}`}>
            <i className={`bi ${item.gate === 'Exit' ? 'bi-box-arrow-right' : 'bi-box-arrow-in-right'} me-1`} />
            {gateLabel(item.gate)}
          </span>
          <span className="small text-secondary" title={formatDateTime(item.createdAt)}>
            <i className="bi bi-clock me-1" />
            {timeAgo(item.createdAt)}
          </span>
        </div>
        {lotLabel && (
          <div className="small text-secondary mb-2 text-truncate" title={lotLabel}>
            <i className="bi bi-buildings me-1" />
            {lotLabel}
          </div>
        )}

        {img ? (
          <img src={img} alt={`Plaka kırpıntısı: ${item.plateRead || 'okunamadı'}`} className="plate-crop mb-2" />
        ) : (
          <div className="plate-crop-empty mb-2">
            <span>
              <i className="bi bi-image me-1" />
              Görüntü yok
            </span>
          </div>
        )}

        <div className="d-flex align-items-center justify-content-between small mb-1">
          <span className="text-secondary">
            Okunan: <strong className="text-body font-monospace">{item.plateRead || '—'}</strong>
          </span>
          <span className="text-secondary">{item.cameraId}</span>
        </div>
        <div className="d-flex align-items-center gap-2 mb-3">
          <div className="progress flex-grow-1" style={{ height: 8 }}>
            <div className={`progress-bar bg-${confVariant}`} style={{ width: `${Math.round(conf * 100)}%` }} />
          </div>
          <span className={`small fw-semibold text-${confVariant}`}>{formatPercent(conf)}</span>
        </div>

        <label className="form-label small fw-semibold" htmlFor={`rv-${item.id}`}>
          Doğru plaka
        </label>
        <input
          id={`rv-${item.id}`}
          className={`form-control plate-input mb-1 ${plate && !valid ? 'is-invalid' : ''} ${valid ? 'is-valid' : ''}`}
          value={plate}
          maxLength={12}
          onChange={(e) => setPlate(normalizePlate(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') resolve(true);
          }}
        />
        <div className="text-center mb-3" style={{ minHeight: 30 }}>
          {plate && <PlateBadge plate={plate} size="sm" />}
        </div>

        <div className="d-flex gap-2 mt-auto">
          <button type="button" className="btn btn-success flex-grow-1" disabled={!!busy || !valid} onClick={() => resolve(true)}>
            {busy === 'approve' ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-check-lg me-1" />}
            Onayla
          </button>
          <button type="button" className="btn btn-outline-danger flex-grow-1" disabled={!!busy} onClick={() => resolve(false)}>
            {busy === 'reject' ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-x-lg me-1" />}
            Reddet
          </button>
        </div>
      </div>
    </div>
  );
}

/** UC-07: Plaka okumasını manuel düzelt */
export default function OnayKuyrugu() {
  const { lotCode: ctxLot, lotName } = useLot();
  const [lot, setLot] = useState(ctxLot); // '' = tüm otoparklar
  const [items, setItems] = useState([]);
  const [totalAll, setTotalAll] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [q, all] = await Promise.all([getReviewQueue(lot || undefined), lot ? getReviewQueue().catch(() => null) : null]);
      const list = Array.isArray(q) ? [...q].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)) : [];
      setItems(list);
      setTotalAll(Array.isArray(all) ? all.length : list.length);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [lot]);

  useEffect(() => {
    load();
  }, [load]);

  const { status } = useParkingHub(
    {
      onReviewQueueChanged: () => load(),
      onReconnected: () => load(),
    },
    { withAuth: true },
  );

  const onResolved = (id) => setItems((list) => list.filter((i) => i.id !== id));

  return (
    <div>
      <PageHeader
        icon="bi-ui-checks"
        title="Onay Kuyruğu"
        badge={items.length > 0 ? <span className="badge rounded-pill text-bg-warning fs-6">{items.length}</span> : null}
        subtitle="Güven eşiğinin altında kalan veya TR plaka biçimine uymayan okumalar. Plakayı kontrol edip onaylayın ya da reddedin."
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

      <ErrorAlert error={error} onRetry={load} className="mb-4" />

      {lot && totalAll != null && totalAll > items.length && (
        <div className="alert alert-warning d-flex align-items-center gap-2 py-2">
          <i className="bi bi-info-circle" />
          Diğer otoparklarda {totalAll - items.length} okuma daha onay bekliyor.
          <button type="button" className="btn btn-sm btn-warning ms-auto" onClick={() => setLot('')}>
            Tümünü göster
          </button>
        </div>
      )}

      {loading ? (
        <Loading text="Kuyruk yükleniyor…" />
      ) : items.length === 0 && !error ? (
        <div className="card">
          <EmptyState icon="bi-check2-all" title="Bekleyen okuma yok">
            Tüm plaka okumaları otomatik olarak işlendi. Yeni bir düşük güvenli okuma geldiğinde liste kendiliğinden
            güncellenir.
          </EmptyState>
        </div>
      ) : (
        <div className="row g-3">
          {items.map((item) => (
            <div className="col-sm-6 col-lg-4 col-xxl-3" key={item.id}>
              <ReviewCard item={item} onResolved={onResolved} lotLabel={!lot && item.lotCode ? lotName(item.lotCode) : null} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
