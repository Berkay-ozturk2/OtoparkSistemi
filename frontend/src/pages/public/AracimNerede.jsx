import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getLotLayout, getSlots, getZones, locateVehicle } from '../../api/parking';
import PageHeader from '../../components/PageHeader';
import PlateBadge from '../../components/PlateBadge';
import ParkingMap from '../../components/ParkingMap';
import ErrorAlert from '../../components/ErrorAlert';
import { normalizePlate, plateError } from '../../utils/plate';
import { formatCurrency, formatDateTime, formatDuration } from '../../utils/format';

/** UC-06: Araç park konumunu sorgula */
export default function AracimNerede() {
  const [params, setParams] = useSearchParams();
  const [plate, setPlate] = useState(params.get('plaka') || '');
  const [result, setResult] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState(null);
  const [slots, setSlots] = useState([]);
  const [zones, setZones] = useState([]);
  const [lot, setLot] = useState(null);

  const search = async (value) => {
    const n = normalizePlate(value);
    const v = plateError(n);
    setValidation(v);
    if (v) return;
    setBusy(true);
    setError(null);
    setNotFound(false);
    setResult(null);
    try {
      const res = await locateVehicle(n);
      setResult(res);
      setParams({ plaka: n }, { replace: true });
      // Krokide göstermek için aracın bulunduğu otoparkın düzenini yükle
      const code = res?.lotCode || 'GAZI';
      Promise.all([
        getLotLayout(code).catch(async () => ({ lot: null, zones: [], slots: await getSlots(code) })),
        getZones(code).catch(() => []),
      ])
        .then(([layout, z]) => {
          const lz = Array.isArray(layout?.zones) ? layout.zones : [];
          const zl = Array.isArray(z) ? z : [];
          setLot(layout?.lot || null);
          setSlots(Array.isArray(layout?.slots) ? layout.slots : []);
          setZones(zl.length ? zl.map((zz) => ({ ...(lz.find((x) => x.code === zz.code) || {}), ...zz })) : lz);
        })
        .catch(() => {});
    } catch (err) {
      if (err.status === 404) setNotFound(true);
      else setError(err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const initial = params.get('plaka');
    if (initial) search(initial);
    // yalnızca ilk açılışta
  }, []);

  const onSubmit = (e) => {
    e.preventDefault();
    search(plate);
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 980 }}>
      <PageHeader
        icon="bi-geo-alt"
        title="Aracım Nerede?"
        subtitle="Plakanızı girerek aracınızın park ettiği bölgeyi, giriş saatini ve güncel ücretini öğrenin."
      />

      <div className="card mb-4">
        <div className="card-body p-4">
          <form onSubmit={onSubmit} className="row g-3 align-items-end" noValidate>
            <div className="col-md-8">
              <label htmlFor="plate" className="form-label fw-semibold">
                Plaka
              </label>
              <input
                id="plate"
                className={`form-control form-control-lg plate-input ${validation ? 'is-invalid' : ''}`}
                placeholder="34 ABC 123"
                value={plate}
                onChange={(e) => setPlate(e.target.value.toUpperCase())}
                maxLength={12}
                autoFocus
              />
              <div className="invalid-feedback">{validation}</div>
            </div>
            <div className="col-md-4 d-grid">
              <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
                {busy ? <span className="spinner-border spinner-border-sm me-2" /> : <i aria-hidden="true" className="bi bi-search me-2" />}
                Sorgula
              </button>
            </div>
          </form>
        </div>
      </div>

      <ErrorAlert error={error} onRetry={() => search(plate)} className="mb-4" />

      {notFound && (
        <div className="card mb-4">
          <div className="card-body text-center py-5">
            <i aria-hidden="true" className="bi bi-car-front display-5 text-secondary" />
            <h2 className="h5 mt-3">Araç içeride bulunamadı</h2>
            <p className="text-secondary mb-0">
              <PlateBadge plate={plate} size="sm" className="me-1" /> plakalı araç için açık bir park kaydı yok. Plakayı doğru
              yazdığınızdan emin olun.
            </p>
          </div>
        </div>
      )}

      {result && (
        <>
          <div className="card mb-4">
            <div className="card-body p-4">
              <div className="row g-4 align-items-center">
                <div className="col-md-5 text-center">
                  <PlateBadge plate={result.plate} size="xl" />
                  <div className="mt-3">
                    {result.isPaid ? (
                      <span className="badge text-bg-success fs-6">
                        <i aria-hidden="true" className="bi bi-check-circle me-1" />
                        Ödendi
                      </span>
                    ) : (
                      <span className="badge text-bg-warning fs-6">
                        <i aria-hidden="true" className="bi bi-hourglass-split me-1" />
                        Ödeme bekleniyor
                      </span>
                    )}
                  </div>
                </div>
                <div className="col-md-7">
                  <div className="d-flex align-items-center gap-3 mb-3">
                    <div className="rec-zone-letter">{result.zoneCode}</div>
                    <div>
                      {result.lotName && (
                        <div className="fw-semibold text-accent">
                          <i aria-hidden="true" className="bi bi-buildings me-1" />
                          {result.lotName}
                        </div>
                      )}
                      <div className="text-secondary small text-uppercase fw-semibold">Aracınızın bölgesi</div>
                      <div className="fs-4 fw-bold">{result.zoneName}</div>
                      <div className="text-secondary">
                        {lot?.floors?.find((f) => Number(f.floor) === Number(result.floor))?.name || `Kat ${result.floor}`}
                      </div>
                    </div>
                  </div>
                  <div className="row g-3">
                    <div className="col-sm-4">
                      <div className="text-secondary small">Giriş</div>
                      <div className="fw-semibold">{formatDateTime(result.entryTime)}</div>
                    </div>
                    <div className="col-sm-4">
                      <div className="text-secondary small">Süre</div>
                      <div className="fw-semibold">{formatDuration(result.durationMinutes)}</div>
                    </div>
                    <div className="col-sm-4">
                      <div className="text-secondary small">Güncel ücret</div>
                      <div className="fw-bold fs-5">{formatCurrency(result.currentFee)}</div>
                    </div>
                  </div>
                  {result.lotCode && (
                    <Link to={`/yol-tarifi?lot=${result.lotCode}`} className="btn btn-outline-primary mt-3 me-2">
                      <i aria-hidden="true" className="bi bi-signpost-split me-1" />
                      Otoparka yol tarifi
                    </Link>
                  )}
                  {!result.isPaid && Number(result.currentFee) > 0 && (
                    <Link to={`/ucret-ode?plaka=${normalizePlate(result.plate)}`} className="btn btn-accent mt-3">
                      <i aria-hidden="true" className="bi bi-credit-card me-2" />
                      Şimdi öde
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>

          {slots.length > 0 && (
            <div className="card">
              <div className="card-header">
                <i aria-hidden="true" className="bi bi-map me-2 text-accent" />
                Krokide konum{result.lotName ? ` — ${result.lotName}` : ''}
              </div>
              <div className="card-body">
                <ParkingMap lot={lot} slots={slots} zones={zones} highlightZone={result.zoneCode} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
