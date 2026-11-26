import { useLot } from '../lot/LotContext';
import { formatPercent } from '../utils/format';
import { freeBadgeClass } from './LotSelector';

/**
 * Otopark kartları ızgarası (ana sayfa): ad, adres, doluluk çubuğu, boş normal yer, boş engelli yer (♿), "Krokiyi gör".
 *  onShowMap(code) : "Krokiyi gör" tıklandığında (seçili otopark ayrıca LotContext'te değiştirilir)
 */
export default function LotCards({ onShowMap }) {
  const { lots, lotCode, setLotCode, loading, error, reloadLots } = useLot();

  if (loading && lots.length === 0) {
    return (
      <div className="row g-3">
        {[0, 1, 2, 3].map((i) => (
          <div className="col-sm-6 col-xl-3" key={i}>
            <div className="card h-100 placeholder-glow">
              <div className="card-body">
                <span className="placeholder col-8 mb-2" />
                <span className="placeholder col-6 mb-3" />
                <span className="placeholder col-12" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (lots.length === 0) {
    return error ? (
      <div className="alert alert-warning d-flex align-items-center gap-2 mb-0">
        <i className="bi bi-wifi-off" />
        Otopark listesi alınamadı.
        <button type="button" className="btn btn-sm btn-outline-dark ms-auto" onClick={reloadLots}>
          Tekrar dene
        </button>
      </div>
    ) : null;
  }

  return (
    <div className="row g-3">
      {lots.map((l) => {
        const total = Number(l.totalSlots) || 0;
        const rate = l.occupancyRate ?? (total ? 1 - (Number(l.freeSlots) || 0) / total : 0);
        const pct = Math.round(rate * 100);
        const active = l.code === lotCode;
        const floorCount = Array.isArray(l.floors) ? l.floors.length : 0;
        return (
          <div className="col-sm-6 col-xl-3" key={l.code}>
            <div className={`card h-100 card-hover lot-card ${active ? 'lot-card-active' : ''}`}>
              <div className="card-body d-flex flex-column">
                <div className="d-flex align-items-start gap-3 mb-2">
                  <span className="lot-card-icon flex-shrink-0">
                    <i className={`bi ${floorCount > 1 ? 'bi-building' : 'bi-p-square'}`} />
                  </span>
                  <div className="min-w-0">
                    <div className="fw-bold lh-sm">{l.name}</div>
                    <div className="small text-secondary text-truncate" title={l.address}>
                      <i className="bi bi-geo-alt me-1" />
                      {l.address || '—'}
                    </div>
                  </div>
                  {active && (
                    <span className="badge text-bg-primary ms-auto flex-shrink-0" title="Seçili otopark">
                      <i className="bi bi-check2" />
                    </span>
                  )}
                </div>

                <div className="d-flex justify-content-between small text-secondary mt-1">
                  <span>Doluluk</span>
                  <span className="fw-semibold">{formatPercent(rate)}</span>
                </div>
                <div className="progress zone-progress mb-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className={`progress-bar ${rate >= 0.9 ? 'bg-danger' : rate >= 0.6 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${pct}%` }} />
                </div>

                <div className="row g-2 text-center mb-3">
                  <div className="col-6">
                    <div className="border rounded-3 py-2">
                      <div className="lot-stat">
                        <span className={`badge ${freeBadgeClass(l.freeSlots, total)} fs-5`}>{l.freeSlots ?? '—'}</span>
                      </div>
                      <div className="small text-secondary mt-1">boş yer</div>
                    </div>
                  </div>
                  <div className="col-6">
                    <div className="border rounded-3 py-2">
                      <div className="lot-stat lot-stat-disabled">
                        <span aria-hidden="true">♿</span> {l.disabledFree ?? 0}
                        <span className="small fw-normal text-secondary">/{l.disabledTotal ?? 0}</span>
                      </div>
                      <div className="small text-secondary mt-1">engelli yeri boş</div>
                    </div>
                  </div>
                </div>

                <div className="d-flex align-items-center gap-2 mt-auto">
                  <span className="small text-secondary">
                    {total} cep{floorCount > 1 ? ` · ${floorCount} kat` : ''}
                  </span>
                  <button
                    type="button"
                    className={`btn btn-sm ms-auto ${active ? 'btn-primary' : 'btn-outline-primary'}`}
                    onClick={() => {
                      setLotCode(l.code);
                      onShowMap?.(l.code);
                    }}
                  >
                    <i className="bi bi-map me-1" />
                    Krokiyi gör
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
