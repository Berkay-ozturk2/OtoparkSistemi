import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, Line } from 'react-chartjs-2';
import { CHART_COLORS } from '../../utils/chartSetup';
import useParkingLive from '../../realtime/useParkingLive';
import { generateDemoData, getAbandoned, getOccupancyReport, getPermits, getRevenueReport } from '../../api/admin';
import { getActiveSessions, getGateEvents, getReviewQueue, getViolations } from '../../api/operator';
import { getSubscriptionReport, getSubscriptions } from '../../api/subscriptions';
import BlockOccupancy from '../../components/admin/BlockOccupancy';
import PendingSubscriptions from '../../components/admin/PendingSubscriptions';
import RecentGateEvents from '../../components/admin/RecentGateEvents';
import useSubscriptionReview from '../../components/admin/useSubscriptionReview';
import LotSelector from '../../components/LotSelector';
import { useLot } from '../../lot/LotContext';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';
import LiveBadge from '../../components/LiveBadge';
import ParkingMap from '../../components/ParkingMap';
import ErrorAlert from '../../components/ErrorAlert';
import ConfirmModal from '../../components/ConfirmModal';
import { useToast } from '../../components/Toast';
import MeterBar from '../../components/MeterBar';
import { addDays, formatCurrency, formatDate, formatDuration, formatHour, formatPercent, toDateInput } from '../../utils/format';

const QUICK_LINKS = [
  { to: '/yonetim/raporlar/doluluk', icon: 'bi-bar-chart-line', label: 'Doluluk Raporu', uc: 'UC-10' },
  { to: '/yonetim/raporlar/gelir', icon: 'bi-cash-coin', label: 'Gelir Raporu', uc: 'UC-11' },
  { to: '/yonetim/tarifeler', icon: 'bi-tags', label: 'Tarifeler', uc: 'UC-12' },
  { to: '/yonetim/kullanicilar', icon: 'bi-people', label: 'Kullanıcılar', uc: 'UC-13' },
  { to: '/yonetim/terk-edilmis', icon: 'bi-exclamation-octagon', label: 'Terk Edilmiş', uc: 'UC-09' },
  { to: '/operator', icon: 'bi-broadcast', label: 'Canlı İzleme', uc: 'UC-08' },
  { to: '/yonetim/otoparklar', icon: 'bi-buildings', label: 'Otoparklar ve Kroki', uc: 'UC-14' },
  { to: '/yonetim/engelli-izinleri', icon: 'bi-person-wheelchair', label: 'Engelli İzinleri', uc: 'UC-15' },
  { to: '/yonetim/abonelikler', icon: 'bi-person-vcard', label: 'Abonelikler ve Raporlar', uc: 'UC-17' },
  { to: '/operator/ihlaller', icon: 'bi-exclamation-diamond', label: 'Engelli Yeri İhlalleri', uc: 'UC-16' },
];

/** Yönetici özet paneli */
export default function Dashboard() {
  const toast = useToast();
  const { lots, lotCode: ctxLot, lotName } = useLot();
  const [dashLot, setDashLot] = useState(''); // '' = tüm otoparklar
  const [gateEvents, setGateEvents] = useState([]);
  const [pendingSubs, setPendingSubs] = useState([]);
  const [subReport, setSubReport] = useState(null);
  const [focusBlock, setFocusBlock] = useState(null);
  const mapRef = useRef(null);
  const gateTimer = useRef(null);

  const loadGate = useCallback(() => {
    getGateEvents(8, dashLot || undefined)
      .then((list) => setGateEvents(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [dashLot]);

  const loadSubs = useCallback(() => {
    const lot = dashLot || undefined;
    getSubscriptions({ status: 'Pending', lot })
      .then((list) => setPendingSubs(Array.isArray(list) ? list : []))
      .catch(() => {});
    getSubscriptionReport({ lot })
      .then(setSubReport)
      .catch(() => {});
  }, [dashLot]);

  const live = useParkingLive(
    {
      // Yeni geçişte liste kısa gecikmeyle yeniden çekilir (blok bilgisi sunucuda eklenir)
      onGateEvent: () => {
        if (gateTimer.current) clearTimeout(gateTimer.current);
        gateTimer.current = setTimeout(loadGate, 500);
      },
    },
    { lotCode: dashLot || ctxLot },
  );
  const review = useSubscriptionReview(() => loadSubs());

  useEffect(() => {
    loadGate();
    loadSubs();
    setFocusBlock(null);
    const t = gateTimer;
    return () => t.current && clearTimeout(t.current);
  }, [loadGate, loadSubs]);

  const showBlockOnMap = (code) => {
    setFocusBlock(code);
    if (code) mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const [stats, setStats] = useState({});
  const [weekRevenue, setWeekRevenue] = useState(null);
  const [weekOccupancy, setWeekOccupancy] = useState(null);
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const today = toDateInput(new Date());
    const weekAgo = toDateInput(addDays(new Date(), -6));
    const lot = dashLot || undefined;
    const [todayRev, weekRev, weekOcc, abandoned, active, queue, viol, permits] = await Promise.allSettled([
      getRevenueReport({ from: today, to: today, groupBy: 'day', lot }),
      getRevenueReport({ from: weekAgo, to: today, groupBy: 'day', lot }),
      getOccupancyReport({ from: weekAgo, to: today, lot }),
      getAbandoned(lot),
      getActiveSessions(lot),
      getReviewQueue(lot),
      getViolations({ lot, status: 'Open' }),
      getPermits('Pending'),
    ]);
    const val = (r) => (r.status === 'fulfilled' ? r.value : null);
    setStats({
      todayRevenue: val(todayRev)?.total ?? null,
      todayCount: val(todayRev)?.count ?? null,
      abandoned: Array.isArray(val(abandoned)) ? val(abandoned).length : null,
      active: Array.isArray(val(active)) ? val(active).length : null,
      pending: Array.isArray(val(queue)) ? val(queue).length : null,
      violations: Array.isArray(val(viol)) ? val(viol).length : null,
      permits: Array.isArray(val(permits)) ? val(permits).length : null,
    });
    setWeekRevenue(val(weekRev));
    setWeekOccupancy(val(weekOcc));
    const errs = [todayRev, weekRev, weekOcc, abandoned, active, queue]
      .filter((r) => r.status === 'rejected')
      .map((r) => r.reason);
    setErrors(errs);
    setLoading(false);
  }, [dashLot]);

  useEffect(() => {
    load();
  }, [load]);

  const runDemo = async () => {
    setDemoBusy(true);
    try {
      const res = await generateDemoData();
      toast.success(res?.message || 'Son 30 güne ait demo verisi üretildi.');
      setConfirmDemo(false);
      load();
      live.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setDemoBusy(false);
    }
  };

  const { lot, slots, zones, recommendation, hubStatus } = live;
  // "Tüm otoparklar" seçiliyken özet, otopark listesinden toplanır
  const summary = dashLot
    ? live.summary
    : lots.length
      ? (() => {
          const total = lots.reduce((a, l) => a + (Number(l.totalSlots) || 0), 0);
          const occ = lots.reduce((a, l) => a + (Number(l.occupancyRate) || 0) * (Number(l.totalSlots) || 0), 0);
          return {
            total,
            occupied: Math.round(occ),
            free: lots.reduce((a, l) => a + (Number(l.freeSlots) || 0), 0),
            reserved: null,
            occupancyRate: total ? occ / total : 0,
            disabledTotal: lots.reduce((a, l) => a + (Number(l.disabledTotal) || 0), 0),
            disabledFree: lots.reduce((a, l) => a + (Number(l.disabledFree) || 0), 0),
          };
        })()
      : live.summary;
  const series = weekRevenue?.series || [];
  const hourly = weekOccupancy?.hourly || [];
  const peak = hourly.reduce((best, h) => (!best || h.entries > best.entries ? h : best), null);
  const firstError = errors.find(Boolean);

  const revenueChart = {
    labels: series.map((s) => formatDate(s.period)),
    datasets: [
      {
        label: 'Gelir (TL)',
        data: series.map((s) => s.amount),
        backgroundColor: CHART_COLORS.teal,
        borderRadius: 6,
        maxBarThickness: 36,
      },
    ],
  };

  const hourlyChart = {
    labels: hourly.map((h) => formatHour(h.hour)),
    datasets: [
      {
        label: 'Giriş sayısı',
        data: hourly.map((h) => h.entries),
        borderColor: CHART_COLORS.navy,
        backgroundColor: CHART_COLORS.navyFaint,
        fill: true,
        tension: 0.35,
        pointRadius: 2,
      },
    ],
  };

  return (
    <div>
      <PageHeader
        icon="bi-grid-1x2"
        title="Yönetim Paneli"
        subtitle={`${dashLot ? lotName(dashLot) : 'Tüm otoparklar'} · anlık durum, bugünkü gelir ve son 7 günün özeti.`}
        actions={
          <>
            <LotSelector value={dashLot} onChange={setDashLot} allowAll label="Panel filtresi" />
            <LiveBadge status={hubStatus} />
            <button type="button" className="btn btn-outline-accent" onClick={() => setConfirmDemo(true)}>
              <i aria-hidden="true" className="bi bi-magic me-1" />
              Demo verisi üret
            </button>
            <button type="button" className="btn btn-outline-primary" onClick={load} disabled={loading} aria-label="Yenile" title="Yenile">
              <i aria-hidden="true" className="bi bi-arrow-clockwise" />
            </button>
          </>
        }
      />

      <ErrorAlert error={live.error || firstError} onRetry={load} className="mb-4" />

      <div className="row g-3 mb-3">
        <div className="col-6 col-xl-3">
          <StatCard icon="bi-pie-chart" label="Doluluk" value={summary ? formatPercent(summary.occupancyRate) : '—'} sub={summary ? `${summary.occupied}/${summary.total} cep${dashLot ? '' : `, ${lots.length} otopark`}` : null} variant="primary" loading={live.loading} />
        </div>
        <div className="col-6 col-xl-3">
          <StatCard
            icon="bi-check2-circle"
            label="Boş yer"
            value={summary?.free ?? '—'}
            sub={summary ? `${summary.disabledFree ?? 0}/${summary.disabledTotal ?? 0} engelli cebi boş` : null}
            variant="success"
            loading={live.loading}
          />
        </div>
        <div className="col-6 col-xl-3">
          <StatCard icon="bi-car-front" label="Aktif oturum" value={stats.active ?? '—'} sub="şu an içeride" variant="teal" loading={loading} />
        </div>
        <div className="col-6 col-xl-3">
          <StatCard
            icon="bi-cash-stack"
            label="Bugünkü gelir"
            value={stats.todayRevenue != null ? formatCurrency(stats.todayRevenue) : '—'}
            sub={stats.todayCount != null ? `${stats.todayCount} ödeme` : null}
            variant="info"
            loading={loading}
          />
        </div>
      </div>

      {/* İşlem bekleyen işler: sıfır olanlar sönük, olanlar vurgulu */}
      <nav className="attention-strip mb-4" aria-label="İşlem bekleyen işler">
        {[
          { to: '/yonetim/abonelikler', icon: 'bi-person-vcard', label: 'abonelik başvurusu', count: pendingSubs.length },
          { to: '/yonetim/engelli-izinleri', icon: 'bi-person-wheelchair', label: 'engelli izni başvurusu', count: stats.permits },
          { to: '/operator/onay-kuyrugu', icon: 'bi-ui-checks', label: 'plaka okuması onay bekliyor', count: stats.pending },
          { to: '/operator/ihlaller', icon: 'bi-exclamation-diamond', label: 'açık ihlal', count: stats.violations, danger: true },
          { to: '/yonetim/terk-edilmis', icon: 'bi-exclamation-octagon', label: 'terk edilmiş araç', count: stats.abandoned, danger: true },
        ].map((a) => (
          <Link key={a.to} to={a.to} className={`attention-item ${a.count > 0 ? (a.danger ? 'is-danger' : 'is-due') : 'is-clear'}`}>
            <i className={`bi ${a.icon}`} aria-hidden="true" />
            <strong>{loading && a.count == null ? '…' : (a.count ?? '—')}</strong>
            <span>{a.label}</span>
          </Link>
        ))}
      </nav>

      <section className="card mb-4" aria-labelledby="blocks-title">
        <div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
          <h2 id="blocks-title" className="section-title">
            <i className="bi bi-grid-3x3-gap me-2 text-accent" aria-hidden="true" />
            Blok doluluğu
            <span className="section-sub">{lot?.name || lotName(dashLot || ctxLot)}</span>
          </h2>
          <div className="d-flex align-items-center gap-2">
            <span className="block-legend d-none d-md-inline-flex" aria-hidden="true">
              <span className="bay bay-occupied" /> dolu
              <span className="bay bay-free" /> boş
              <span className="bay bay-reserved" /> rezerve
            </span>
            {!dashLot && <LotSelector />}
          </div>
        </div>
        <div className="card-body">
          <BlockOccupancy
            slots={slots}
            zones={zones}
            loading={live.loading}
            selected={focusBlock}
            onSelect={showBlockOnMap}
            floorName={(f) => {
              const fl = (lot?.floors || []).find((x) => Number(x.floor) === Number(f));
              return (lot?.floors || []).length > 1 ? fl?.name || `Kat ${f}` : null;
            }}
          />
          <p className="block-hint">Bir bloğu seçince krokide vurgulanır.</p>
        </div>
      </section>

      <div className="row g-4 mb-4">
        <div className="col-xl-7">
          <section className="card h-100" aria-labelledby="subs-title">
            <div className="card-header d-flex justify-content-between align-items-center gap-2">
              <h2 id="subs-title" className="section-title">
                <i className="bi bi-person-vcard me-2 text-accent" aria-hidden="true" />
                Abonelik başvuruları
                {pendingSubs.length > 0 && <span className="count-pill">{pendingSubs.length} bekliyor</span>}
              </h2>
              <Link to="/yonetim/abonelikler" className="btn btn-sm btn-link section-link">
                Tümü ve raporlar
              </Link>
            </div>
            {subReport && (
              <dl className="sub-summary">
                <div>
                  <dt>Aktif abone</dt>
                  <dd>
                    {subReport.activeNow}
                    <small>
                      {subReport.activeMonthly} aylık, {subReport.activeYearly} yıllık
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>{subReport.year} geliri</dt>
                  <dd>{formatCurrency(subReport.revenue)}</dd>
                </div>
                <div className={subReport.expiringSoon > 0 ? 'is-due' : ''}>
                  <dt>14 gün içinde bitecek</dt>
                  <dd>{subReport.expiringSoon}</dd>
                </div>
              </dl>
            )}
            <div className="card-body pt-2">
              <PendingSubscriptions
                items={pendingSubs.slice(0, 5)}
                busyId={review.busyId}
                onApprove={review.approve}
                onReject={review.startReject}
                emptyText="Bekleyen başvuru yok. Yeni başvurular burada görünür."
              />
              {pendingSubs.length > 5 && (
                <Link to="/yonetim/abonelikler" className="d-inline-block mt-2 small">
                  {pendingSubs.length - 5} başvuru daha var
                </Link>
              )}
            </div>
          </section>
        </div>
        <div className="col-xl-5">
          <section className="card h-100" aria-labelledby="gate-title">
            <div className="card-header d-flex justify-content-between align-items-center gap-2">
              <h2 id="gate-title" className="section-title">
                <i className="bi bi-arrow-left-right me-2 text-accent" aria-hidden="true" />
                Son giriş-çıkışlar
              </h2>
              <Link to="/operator" className="btn btn-sm btn-link section-link">
                Canlı izleme
              </Link>
            </div>
            <div className="card-body pt-1">
              <RecentGateEvents events={gateEvents} showLot={!dashLot} />
            </div>
          </section>
        </div>
      </div>

      <div className="row g-4 mb-4">
        <div className="col-xl-6">
          <div className="card h-100">
            <div className="card-header d-flex justify-content-between">
              <span>
                <i aria-hidden="true" className="bi bi-cash-coin me-2 text-accent" />
                Son 7 gün gelir
              </span>
              <span className="fw-bold">{weekRevenue ? formatCurrency(weekRevenue.total) : ''}</span>
            </div>
            <div className="card-body">
              {series.length === 0 ? (
                <div className="text-center text-secondary py-5">
                  <i aria-hidden="true" className="bi bi-bar-chart fs-1 d-block mb-2" />
                  Bu dönem için gelir verisi yok. Rapor demosu için &quot;Demo verisi üret&quot; düğmesini kullanabilirsiniz.
                </div>
              ) : (
                <div className="chart-box sm">
                  <Bar
                    data={revenueChart}
                    options={{
                      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatCurrency(c.parsed.y) } } },
                      scales: { y: { beginAtZero: true, ticks: { callback: (v) => `${v} ₺` } } },
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="col-xl-6">
          <div className="card h-100">
            <div className="card-header d-flex justify-content-between">
              <span>
                <i aria-hidden="true" className="bi bi-clock me-2 text-accent" />
                Saatlik giriş dağılımı (7 gün)
              </span>
              <span className="small text-secondary fw-normal">
                {peak ? `Pik saat ${formatHour(peak.hour)}` : ''}
                {weekOccupancy?.averageDurationMinutes != null ? ` · Ort. kalış ${formatDuration(weekOccupancy.averageDurationMinutes)}` : ''}
              </span>
            </div>
            <div className="card-body">
              {hourly.length === 0 ? (
                <div className="text-center text-secondary py-5">
                  <i aria-hidden="true" className="bi bi-graph-up fs-1 d-block mb-2" />
                  Giriş verisi yok.
                </div>
              ) : (
                <div className="chart-box sm">
                  <Line
                    data={hourlyChart}
                    options={{ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="row g-4">
        <div className="col-xl-8">
          <div className="card h-100" ref={mapRef}>
            <div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
              <span>
                <i aria-hidden="true" className="bi bi-map me-2 text-accent" />
                Anlık kroki — {lot?.name || lotName(dashLot || ctxLot)}
              </span>
              {!dashLot && <LotSelector />}
            </div>
            <div className="card-body">
              <ParkingMap lot={lot} slots={slots} zones={zones} recommendedZone={focusBlock ? undefined : recommendation?.zoneCode} highlightZone={focusBlock || undefined} />
              {!dashLot && lots.length > 1 && (
                <div className="table-responsive mt-3">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Otopark</th>
                        <th>Doluluk</th>
                        <th className="text-end">Boş</th>
                        <th className="text-end">♿ Boş</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lots.map((l) => (
                        <tr key={l.code}>
                          <td className="small fw-semibold">{l.name}</td>
                          <td style={{ minWidth: 140 }}>
                            <div className="d-flex align-items-center gap-2">
                              <MeterBar
                                className="zone-progress flex-grow-1"
                                value={l.occupancyRate || 0}
                                label={`${l.name} doluluk`}
                                barClassName={l.occupancyRate >= 0.9 ? "bg-danger" : l.occupancyRate >= 0.6 ? "bg-warning" : "bg-success"}
                              />
                              <span className="small">{formatPercent(l.occupancyRate || 0)}</span>
                            </div>
                          </td>
                          <td className="text-end fw-semibold">{l.freeSlots}</td>
                          <td className="text-end">
                            {l.disabledFree ?? 0}/{l.disabledTotal ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="col-xl-4">
          <div className="card h-100">
            <div className="card-header">
              <i aria-hidden="true" className="bi bi-lightning me-2 text-accent" />
              Hızlı erişim
            </div>
            <div className="list-group list-group-flush">
              {QUICK_LINKS.map((q) => (
                <Link key={q.to} to={q.to} className="list-group-item list-group-item-action d-flex align-items-center gap-3 py-3">
                  <span className="quick-link-card">
                    <span className="qi">
                      <i aria-hidden="true" className={`bi ${q.icon}`} />
                    </span>
                  </span>
                  <span className="flex-grow-1 fw-semibold">{q.label}</span>
                  <span className="badge text-bg-light border">{q.uc}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {review.modal}

      <ConfirmModal
        show={confirmDemo}
        title="Demo verisi üret"
        icon="bi-magic"
        variant="primary"
        confirmText="Demo verisi üret"
        busy={demoBusy}
        onConfirm={runDemo}
        onCancel={() => setConfirmDemo(false)}
      >
        <p className="mb-0">
          Son 30 güne ait örnek park oturumları ve ödemeler üretilecek. Bu işlem rapor ekranlarını (UC-10, UC-11) göstermek
          içindir; gerçek kayıtlarla karışabilir. Devam edilsin mi?
        </p>
      </ConfirmModal>
    </div>
  );
}
