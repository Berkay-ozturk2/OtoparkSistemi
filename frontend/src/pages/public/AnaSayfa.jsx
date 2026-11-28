import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import useParkingLive from '../../realtime/useParkingLive';
import { getPublicTariffs } from '../../api/parking';
import ParkingView from '../../components/ParkingView';
import MeterBar from '../../components/MeterBar';
import AnimatedNumber from '../../components/AnimatedNumber';
import StatCard from '../../components/StatCard';
import LiveBadge from '../../components/LiveBadge';
import Loading from '../../components/Loading';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import LotCards from '../../components/LotCards';
import LotSelector from '../../components/LotSelector';
import { useAuth } from '../../auth/AuthContext';
import { useLot } from '../../lot/LotContext';
import { formatCurrency, formatDuration, formatPercent, formatTime } from '../../utils/format';

/** UC-05: Boş park yeri durumunu görüntüle (herkese açık, SignalR ile anlık) */
export default function AnaSayfa() {
  const { lot, summary, zones, slots, recommendation, loading, error, lastUpdate, hubStatus, reload } = useParkingLive();
  const { currentLot } = useLot();
  const mapRef = useRef(null);
  const lotName = lot?.name || currentLot?.name;
  const floorName = (f) => lot?.floors?.find((x) => Number(x.floor) === Number(f))?.name || `Kat ${f}`;
  const { user } = useAuth();
  const isStaff = user?.role === 'Operator' || user?.role === 'Admin';
  const [tariffs, setTariffs] = useState([]);
  const [tariffError, setTariffError] = useState(null);

  useEffect(() => {
    getPublicTariffs()
      .then((t) => setTariffs(Array.isArray(t) ? [...t].sort((a, b) => a.minMinutes - b.minMinutes) : []))
      .catch(setTariffError);
  }, []);

  const rate = summary?.occupancyRate ?? (summary && summary.total ? summary.occupied / summary.total : 0);
  const isFull = summary && summary.free === 0;

  return (
    <div>
      {/* Üst bölüm */}
      <section className="hero mb-4">
        <div className="row g-4 align-items-center">
          <div className="col-lg-6">
            <div className="d-flex align-items-center gap-2 mb-2">
              <LiveBadge status={hubStatus} />
              {lastUpdate && <span className="small text-white-50">Son güncelleme: {formatTime(lastUpdate, true)}</span>}
            </div>
            <h1 className="display-6 mb-2">Görüntü İşleme Destekli Akıllı Otopark</h1>
            <p className="lead mb-4">
              Plakanız kameralarla otomatik okunur, bariyer kendiliğinden açılır. Boş yerleri anlık görün,
              aracınızı bulun, ücretinizi çevrimiçi ödeyin.
            </p>
            <div className="d-flex flex-wrap gap-2">
              <Link to="/aracim-nerede" className="btn btn-accent btn-lg">
                <i aria-hidden="true" className="bi bi-geo-alt me-2" />
                Aracım Nerede?
              </Link>
              <Link to="/ucret-ode" className="btn btn-outline-light btn-lg">
                <i aria-hidden="true" className="bi bi-credit-card me-2" />
                Ücret Öde
              </Link>
              <Link to={user?.role === 'Driver' ? '/surucu/rezervasyon' : '/giris'} className="btn btn-outline-light btn-lg">
                <i aria-hidden="true" className="bi bi-calendar-check me-2" />
                Rezervasyon
              </Link>
            </div>
          </div>
          <div className="col-lg-6">
            <div className="row g-3 text-center text-lg-start">
              <div className="col-6">
                <div className="small text-uppercase text-white-50 fw-semibold text-truncate" title={lotName}>
                  Boş yer{lotName ? ` · ${lotName}` : ''}
                </div>
                <div className="hero-free-count">{summary ? summary.free : '—'}</div>
                <div className="small text-white-50">
                  toplam {summary?.total ?? '—'} cep
                  {summary?.disabledTotal > 0 && (
                    <>
                      {' · '}
                      <span aria-hidden="true">♿</span> {summary.disabledFree ?? 0}/{summary.disabledTotal} engelli yeri boş
                    </>
                  )}
                </div>
              </div>
              <div className="col-6">
                <div className="small text-uppercase text-white-50 fw-semibold">Doluluk</div>
                <div className="hero-occupancy">{summary ? <AnimatedNumber value={rate * 100} format={(v) => `%${Math.round(v)}`} /> : '—'}</div>
                <MeterBar className="mt-3" value={rate} label="Genel doluluk" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Otoparklar */}
      <section className="mb-4">
        <div className="d-flex align-items-center justify-content-between mb-3">
          <h2 className="h5 mb-0">
            <i aria-hidden="true" className="bi bi-buildings me-2 text-accent" />
            Otoparklar
          </h2>
          <span className="small text-secondary">Boş yer sayıları normal araçlar içindir; ♿ engelli park yerleri ayrıca gösterilir.</span>
        </div>
        <LotCards onShowMap={() => setTimeout(() => mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)} />
      </section>

      <ErrorAlert error={error} onRetry={reload} className="mb-4" />

      {/* Özet kartları (seçili otopark) */}
      <div className="row g-3 mb-4">
        <div className="col-6 col-md-4 col-xl">
          <StatCard icon="bi-grid-3x3-gap" label="Toplam Cep" value={summary?.total ?? '—'} variant="primary" loading={loading} />
        </div>
        <div className="col-6 col-md-4 col-xl">
          <StatCard icon="bi-check2-circle" label="Boş" value={summary?.free ?? '—'} sub="normal araçlar için" variant="success" loading={loading} />
        </div>
        <div className="col-6 col-md-4 col-xl">
          <StatCard
            icon="bi-person-wheelchair"
            label="Engelli yeri boş"
            value={summary ? `${summary.disabledFree ?? 0}/${summary.disabledTotal ?? 0}` : '—'}
            sub="yalnızca izinli araçlar"
            variant="info"
            loading={loading}
          />
        </div>
        <div className="col-6 col-md-6 col-xl">
          <StatCard icon="bi-car-front-fill" label="Dolu" value={summary?.occupied ?? '—'} variant="danger" loading={loading} />
        </div>
        <div className="col-12 col-md-6 col-xl">
          <StatCard icon="bi-bookmark-star" label="Rezerve" value={summary?.reserved ?? '—'} variant="warning" loading={loading} />
        </div>
      </div>

      <div className="row g-4">
        {/* Kroki */}
        <div className="col-xl-8" ref={mapRef} style={{ scrollMarginTop: 80 }}>
          <div className="card h-100">
            <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
              <span>
                <i aria-hidden="true" className="bi bi-map me-2 text-accent" />
                Otopark Krokisi
              </span>
              <div className="d-flex align-items-center gap-2">
                <LotSelector />
                <LiveBadge status={hubStatus} />
              </div>
            </div>
            <div className="card-body">
              {loading ? (
                <Loading text="Kroki yükleniyor…" />
              ) : slots.length === 0 && !error ? (
                <EmptyState icon="bi-map" title="Kroki verisi yok">
                  Cep bilgileri henüz tanımlanmamış.
                </EmptyState>
              ) : (
                <ParkingView
                  lot={lot}
                  canManage={isStaff}
                  slots={slots}
                  zones={zones}
                  recommendedZone={recommendation?.zoneCode}
                  highlightSlot={recommendation?.slotCode}
                />
              )}
            </div>
          </div>
        </div>

        {/* Öneri + bölgeler */}
        <div className="col-xl-4 d-flex flex-column gap-4">
          <div className="card rec-card">
            <div className="card-body">
              <div className="text-secondary small fw-semibold text-uppercase mb-2">
                <i aria-hidden="true" className="bi bi-stars me-1 text-accent" />
                Önerilen bölge
              </div>
              {recommendation ? (
                <div className="d-flex align-items-center gap-3">
                  <div className="rec-zone-letter">{recommendation.zoneCode}</div>
                  <div>
                    <div className="fw-bold fs-5">{recommendation.zoneName}</div>
                    <div className="text-secondary">
                      {lot?.floors?.length > 1 && recommendation.floor != null && <>{floorName(recommendation.floor)} · </>}
                      {recommendation.freeSlots} boş yer
                      {recommendation.slotCode && (
                        <>
                          {' · '}ilk boş cep <strong>{recommendation.slotCode}</strong>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : isFull ? (
                <div className="text-danger fw-semibold">
                  <i aria-hidden="true" className="bi bi-x-octagon me-2" />
                  Otopark şu anda dolu.
                  {summary?.disabledFree > 0 && (
                    <div className="small text-secondary fw-normal mt-1">
                      Kalan <span aria-hidden="true">♿</span> {summary.disabledFree} yer engelli araçlara ayrılmıştır.
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-secondary">{loading ? 'Hesaplanıyor…' : 'Şu an öneri bulunmuyor.'}</div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <i aria-hidden="true" className="bi bi-layers me-2 text-accent" />
              Bölgeler
            </div>
            <ul className="list-group list-group-flush">
              {zones.length === 0 && <li className="list-group-item text-secondary">{loading ? 'Yükleniyor…' : 'Bölge bilgisi yok.'}</li>}
              {zones.map((z) => {
                const occ = z.totalSlots ? (z.totalSlots - z.freeSlots) / z.totalSlots : 0;
                const variant = occ >= 0.9 ? 'bg-danger' : occ >= 0.6 ? 'bg-warning' : 'bg-success';
                return (
                  <li key={z.id ?? z.code} className="list-group-item py-3">
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <span className="fw-semibold">
                        <span className="badge text-bg-primary me-2">{z.code}</span>
                        {z.name}
                      </span>
                      <span className="small text-secondary">{floorName(z.floor)}</span>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <MeterBar className="zone-progress flex-grow-1" value={occ} label={`${z.name} doluluk`} barClassName={variant} />
                      <span className="small fw-semibold text-nowrap">
                        {z.freeSlots}/{z.totalSlots} boş
                      </span>
                      {z.disabledTotal > 0 && (
                        <span className="badge badge-disabled-soft" title="Boş engelli yeri / toplam">
                          <span aria-hidden="true">♿</span> {z.disabledFree ?? 0}/{z.disabledTotal}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      {/* Tarifeler */}
      <div className="row g-4 mt-1">
        <div className="col-lg-7">
          <div className="card h-100">
            <div className="card-header">
              <i aria-hidden="true" className="bi bi-tags me-2 text-accent" />
              Ücret Tarifesi
            </div>
            <div className="card-body p-0">
              <ErrorAlert error={tariffError} className="m-3" />
              {tariffs.length === 0 && !tariffError ? (
                <EmptyState icon="bi-tags" title="Tarife bilgisi yok" />
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover">
                    <thead>
                      <tr>
                        <th>Dilim</th>
                        <th>Süre</th>
                        <th className="text-end">Ücret</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tariffs.map((t) => (
                        <tr key={t.id}>
                          <td className="fw-semibold">{t.name}</td>
                          <td>
                            {formatDuration(t.minMinutes)} – {formatDuration(t.maxMinutes)}
                          </td>
                          <td className="text-end fw-bold">{formatCurrency(t.price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="small text-secondary px-3 py-2 border-top">
                <i aria-hidden="true" className="bi bi-info-circle me-1" />
                İlk 15 dakika ücretsizdir; 24 saati aşan sürelerde günlük tavan ücret uygulanır.
              </div>
            </div>
          </div>
        </div>
        <div className="col-lg-5">
          <div className="row g-3">
            {[
              { to: '/aracim-nerede', icon: 'bi-geo-alt', title: 'Aracım Nerede?', text: 'Plakanızla aracınızın bölgesini ve güncel ücretini öğrenin.' },
              { to: '/ucret-ode', icon: 'bi-credit-card-2-front', title: 'Çevrimiçi Ödeme', text: 'Gişeye uğramadan kartla ödeyin, çıkışta bariyer otomatik açılsın.' },
              { to: '/kvkk', icon: 'bi-shield-check', title: 'KVKK', text: 'Plaka verileriniz nasıl işleniyor? Aydınlatma metni ve başvuru formu.' },
            ].map((q) => (
              <div className="col-12" key={q.to}>
                <Link to={q.to} className="card card-hover quick-link-card">
                  <div className="card-body d-flex gap-3 align-items-center">
                    <span className="qi">
                      <i aria-hidden="true" className={`bi ${q.icon}`} />
                    </span>
                    <div>
                      <div className="fw-semibold">{q.title}</div>
                      <div className="small text-secondary">{q.text}</div>
                    </div>
                    <i aria-hidden="true" className="bi bi-chevron-right ms-auto text-secondary" />
                  </div>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
