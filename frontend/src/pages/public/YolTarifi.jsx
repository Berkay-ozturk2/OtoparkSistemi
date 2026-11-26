import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import CityMap from '../../components/CityMap';
import { useLot } from '../../lot/LotContext';
import { useAuth } from '../../auth/AuthContext';
import { ROLES } from '../../auth/roles';
import { getMyReservations } from '../../api/driver';
import { formatDateTime } from '../../utils/format';
import {
  DEMO_STARTS,
  fetchRoute,
  formatDistance,
  formatTravelTime,
  getCurrentPosition,
  googleMapsDirectionsUrl,
  haversineMeters,
} from '../../utils/routing';

const ACTIVE_RES = ['PendingPayment', 'Confirmed', 'CheckedIn'];

function hasLocation(l) {
  return l && Number.isFinite(l.latitude) && Number.isFinite(l.longitude);
}

/**
 * Yol tarifi: Ankara'daki otoparkları haritada gösterir; bulunduğunuz konumdan seçilen
 * (ya da rezervasyon yaptığınız) otoparka araç rotası, süre ve Türkçe adım adım tarif verir.
 */
export default function YolTarifi() {
  const [params, setParams] = useSearchParams();
  const { lots, setLotCode } = useLot();
  const { hasRole } = useAuth();
  const isDriver = hasRole(ROLES.Driver);

  const [selected, setSelected] = useState(params.get('lot')?.toUpperCase() || null);
  const [origin, setOrigin] = useState(null);
  const [originLabel, setOriginLabel] = useState('');
  const [pickMode, setPickMode] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState(null);
  const [route, setRoute] = useState(null);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState(null);
  const [showSteps, setShowSteps] = useState(true);
  const [reservations, setReservations] = useState([]);

  const located = useMemo(() => lots.filter(hasLocation), [lots]);
  const target = located.find((l) => l.code === selected) || null;

  // Sürücünün aktif rezervasyonları (rezervasyon yaptığı otoparka yol tarifi)
  useEffect(() => {
    if (!isDriver) return;
    getMyReservations()
      .then((list) => {
        const now = Date.now();
        const active = (Array.isArray(list) ? list : [])
          .filter((r) => ACTIVE_RES.includes(r.status) && new Date(r.endTime).getTime() > now)
          .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
        setReservations(active);
        if (!params.get('lot') && active[0]?.lotCode) setSelected(active[0].lotCode);
      })
      .catch(() => {});
  }, [isDriver]);

  const selectLot = useCallback(
    (code) => {
      setSelected(code);
      setLotCode(code);
      const next = new URLSearchParams(params);
      next.set('lot', code);
      setParams(next, { replace: true });
    },
    [params, setParams, setLotCode],
  );

  const useMyLocation = useCallback(async () => {
    setLocating(true);
    setLocError(null);
    try {
      const pos = await getCurrentPosition();
      setOrigin(pos);
      setOriginLabel(pos.accuracy ? `Konumunuz (±${Math.round(pos.accuracy)} m)` : 'Konumunuz');
      setPickMode(false);
    } catch (e) {
      setLocError(e.message);
      setPickMode(true);
    } finally {
      setLocating(false);
    }
  }, []);

  // Sayfa açılınca konumu bir kez iste
  useEffect(() => {
    useMyLocation();
  }, [useMyLocation]);

  // Başlangıç ve hedef hazır olunca rotayı hesapla
  useEffect(() => {
    if (!origin || !target) {
      setRoute(null);
      return undefined;
    }
    const ctrl = new AbortController();
    setRouting(true);
    setRouteError(null);
    fetchRoute(origin, { lat: target.latitude, lng: target.longitude }, { destinationName: target.name, signal: ctrl.signal })
      .then((r) => setRoute(r))
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setRoute(null);
        setRouteError(e.message || 'Rota hesaplanamadı.');
      })
      .finally(() => setRouting(false));
    return () => ctrl.abort();
  }, [origin, target?.code, target?.latitude, target?.longitude]);

  const distances = useMemo(() => {
    const d = {};
    if (origin) located.forEach((l) => { d[l.code] = haversineMeters(origin, { lat: l.latitude, lng: l.longitude }); });
    return d;
  }, [origin, located]);

  const nearestFree = useMemo(() => {
    if (!origin) return null;
    return [...located].filter((l) => Number(l.freeSlots) > 0)
      .sort((a, b) => (distances[a.code] ?? Infinity) - (distances[b.code] ?? Infinity))[0] || null;
  }, [origin, located, distances]);

  const sortedLots = useMemo(
    () => (origin ? [...located].sort((a, b) => (distances[a.code] ?? 0) - (distances[b.code] ?? 0)) : located),
    [origin, located, distances],
  );

  const eta = route ? new Date(Date.now() + route.duration * 1000) : null;
  const straight = origin && target ? haversineMeters(origin, { lat: target.latitude, lng: target.longitude }) : null;

  return (
    <div>
      <PageHeader
        icon="bi-signpost-split"
        title="Yol Tarifi"
        subtitle="Otoparkları haritada görün; bulunduğunuz yerden seçtiğiniz ya da rezervasyon yaptığınız otoparka rota alın."
      />

      {reservations.length > 0 && (
        <div className="card shadow-sm mb-3 border-primary">
          <div className="card-body py-2">
            <div className="fw-semibold mb-1">
              <i className="bi bi-calendar-check me-2 text-primary" />
              Rezervasyonlarınız
            </div>
            <div className="d-flex flex-wrap gap-2">
              {reservations.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`btn btn-sm ${r.lotCode === selected ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => selectLot(r.lotCode)}
                >
                  <i className="bi bi-signpost me-1" />
                  {r.lotName || r.lotCode} · {r.zoneCode} · {formatDateTime(r.startTime)}
                  {r.slotType === 'Disabled' ? ' · ♿' : ''}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="row g-3">
        <div className="col-lg-4">
          {/* Başlangıç */}
          <div className="card shadow-sm mb-3">
            <div className="card-header fw-semibold">
              <i className="bi bi-geo me-2 text-accent" />
              Başlangıç noktası
            </div>
            <div className="card-body">
              <div className="small mb-2">
                {origin ? (
                  <>
                    <i className="bi bi-record-circle text-primary me-1" />
                    {originLabel}
                  </>
                ) : (
                  <span className="text-secondary">Henüz seçilmedi</span>
                )}
              </div>
              <div className="d-flex flex-wrap gap-2">
                <button type="button" className="btn btn-sm btn-primary" onClick={useMyLocation} disabled={locating}>
                  {locating ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-crosshair me-1" />}
                  Konumumu kullan
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${pickMode ? 'btn-warning' : 'btn-outline-secondary'}`}
                  onClick={() => setPickMode((v) => !v)}
                >
                  <i className="bi bi-hand-index me-1" />
                  {pickMode ? 'Haritaya tıklayın…' : 'Haritadan seç'}
                </button>
                <select
                  className="form-select form-select-sm w-auto"
                  aria-label="Hazır başlangıç noktası"
                  value=""
                  onChange={(e) => {
                    const s = DEMO_STARTS.find((x) => x.key === e.target.value);
                    if (!s) return;
                    setOrigin({ lat: s.lat, lng: s.lng });
                    setOriginLabel(s.name);
                    setPickMode(false);
                    setLocError(null);
                  }}
                >
                  <option value="">Hazır nokta…</option>
                  {DEMO_STARTS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              {locError && <div className="alert alert-warning small py-2 mt-2 mb-0">{locError}</div>}
            </div>
          </div>

          {/* Otoparklar */}
          <div className="card shadow-sm">
            <div className="card-header fw-semibold d-flex align-items-center">
              <i className="bi bi-p-square me-2 text-accent" />
              Otoparklar
              {nearestFree && (
                <button type="button" className="btn btn-sm btn-success ms-auto" onClick={() => selectLot(nearestFree.code)}>
                  <i className="bi bi-lightning-charge me-1" />
                  En yakın boş
                </button>
              )}
            </div>
            <div className="list-group list-group-flush">
              {sortedLots.length === 0 && (
                <div className="list-group-item small text-secondary">Konumu tanımlı otopark yok.</div>
              )}
              {sortedLots.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  className={`list-group-item list-group-item-action ${l.code === selected ? 'active' : ''}`}
                  onClick={() => selectLot(l.code)}
                >
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <div className="min-w-0">
                      <div className="fw-semibold text-truncate">{l.name}</div>
                      <div className={`small ${l.code === selected ? '' : 'text-secondary'} text-truncate`}>{l.address}</div>
                    </div>
                    <div className="text-end flex-shrink-0">
                      <span className={`badge ${Number(l.freeSlots) > 0 ? 'text-bg-success' : 'text-bg-danger'}`}>
                        {l.freeSlots} boş
                      </span>
                      {Number(l.disabledTotal) > 0 && (
                        <div className="small mt-1">♿ {l.disabledFree}</div>
                      )}
                      {origin && distances[l.code] != null && (
                        <div className="small mt-1">{formatDistance(distances[l.code])}</div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="col-lg-8">
          {pickMode && (
            <div className="alert alert-info py-2 small mb-2">
              <i className="bi bi-hand-index me-1" />
              Başlangıç noktası için haritada bir yere tıklayın.
            </div>
          )}
          <CityMap
            lots={located}
            selectedCode={selected}
            origin={origin}
            route={route?.coordinates}
            onSelectLot={selectLot}
            onMapClick={
              pickMode
                ? (p) => {
                  setOrigin(p);
                  setOriginLabel(`Seçilen nokta (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})`);
                  setPickMode(false);
                  setLocError(null);
                }
                : undefined
            }
          />

          {/* Rota özeti */}
          {target && (
            <div className="card shadow-sm mt-3">
              <div className="card-body">
                <div className="d-flex flex-wrap align-items-center gap-3">
                  <div className="min-w-0">
                    <div className="small text-secondary">Hedef</div>
                    <div className="fw-bold">{target.name}</div>
                    <div className="small text-secondary">{target.address}</div>
                  </div>
                  {routing && (
                    <div className="text-secondary small">
                      <span className="spinner-border spinner-border-sm me-1" />
                      Rota hesaplanıyor…
                    </div>
                  )}
                  {route && !routing && (
                    <div className="d-flex gap-4 ms-lg-auto">
                      <div>
                        <div className="small text-secondary">Mesafe</div>
                        <div className="fs-5 fw-bold">{formatDistance(route.distance)}</div>
                      </div>
                      <div>
                        <div className="small text-secondary">Süre</div>
                        <div className="fs-5 fw-bold">{formatTravelTime(route.duration)}</div>
                      </div>
                      <div>
                        <div className="small text-secondary">Varış</div>
                        <div className="fs-5 fw-bold">
                          {eta.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <div>
                        <div className="small text-secondary">Boş yer</div>
                        <div className={`fs-5 fw-bold ${Number(target.freeSlots) > 0 ? 'text-success' : 'text-danger'}`}>
                          {target.freeSlots}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {!origin && (
                  <div className="alert alert-light border small py-2 mt-3 mb-0">
                    Rota için bir başlangıç noktası seçin: <strong>Konumumu kullan</strong>, haritadan seçin ya da hazır bir nokta seçin.
                  </div>
                )}
                {routeError && (
                  <div className="alert alert-warning small py-2 mt-3 mb-0">
                    {routeError} Kuş uçuşu mesafe: <strong>{formatDistance(straight)}</strong>. Aşağıdaki Google Haritalar
                    bağlantısını kullanabilirsiniz.
                  </div>
                )}
                {Number(target.freeSlots) <= 0 && (
                  <div className="alert alert-danger small py-2 mt-3 mb-0">
                    Bu otopark şu an dolu.
                    {nearestFree && nearestFree.code !== target.code && (
                      <>
                        {' '}
                        Size en yakın boş otopark:{' '}
                        <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => selectLot(nearestFree.code)}>
                          {nearestFree.name}
                        </button>
                      </>
                    )}
                  </div>
                )}

                <div className="d-flex flex-wrap gap-2 mt-3">
                  <a
                    className="btn btn-outline-primary btn-sm"
                    href={googleMapsDirectionsUrl(origin, { lat: target.latitude, lng: target.longitude })}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <i className="bi bi-google me-1" />
                    Google Haritalar&apos;da aç
                  </a>
                  {isDriver && (
                    <Link className="btn btn-outline-secondary btn-sm" to="/surucu/rezervasyon" onClick={() => setLotCode(target.code)}>
                      <i className="bi bi-calendar-plus me-1" />
                      Bu otoparkta rezervasyon yap
                    </Link>
                  )}
                  {route && route.steps.length > 0 && (
                    <button type="button" className="btn btn-light btn-sm ms-auto" onClick={() => setShowSteps((v) => !v)}>
                      <i className={`bi ${showSteps ? 'bi-chevron-up' : 'bi-chevron-down'} me-1`} />
                      Adım adım tarif ({route.steps.length})
                    </button>
                  )}
                </div>

                {route && showSteps && route.steps.length > 0 && (
                  <ol className="list-group list-group-numbered list-group-flush mt-3 small">
                    {route.steps.map((s, i) => (
                      <li key={i} className="list-group-item d-flex justify-content-between align-items-start">
                        <div className="ms-2 me-auto">{s.text}</div>
                        {s.distance > 0 && <span className="text-secondary text-nowrap">{formatDistance(s.distance)}</span>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
          {!target && (
            <div className="alert alert-light border mt-3 small">
              <i className="bi bi-info-circle me-1" />
              Rota için soldaki listeden ya da haritadaki <strong>P</strong> işaretlerinden bir otopark seçin.
            </div>
          )}
          <div className="small text-secondary mt-2">
            Harita: © OpenStreetMap katkıda bulunanlar · Rota: OSRM (araç rotası, trafik durumu içermez).
          </div>
        </div>
      </div>
    </div>
  );
}
