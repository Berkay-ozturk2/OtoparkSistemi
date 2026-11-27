import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { CHART_COLORS } from '../../utils/chartSetup';
import { getSubscriptionReport, getSubscriptions, updateSubscription } from '../../api/subscriptions';
import PageHeader from '../../components/PageHeader';
import LotSelector from '../../components/LotSelector';
import ErrorAlert from '../../components/ErrorAlert';
import PlateBadge from '../../components/PlateBadge';
import ConfirmModal from '../../components/ConfirmModal';
import PendingSubscriptions from '../../components/admin/PendingSubscriptions';
import useSubscriptionReview from '../../components/admin/useSubscriptionReview';
import { useToast } from '../../components/Toast';
import { daysUntil, formatCurrency, formatDate, planLabel, subscriptionStatus } from '../../utils/format';
import { formatPlate, normalizePlate } from '../../utils/plate';

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const MONTHS_LONG = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const FILTERS = [
  { key: 'current', label: 'Aktif' },
  { key: 'ended', label: 'Sona eren ve iptal' },
  { key: 'rejected', label: 'Reddedilen' },
  { key: 'all', label: 'Tümü' },
];

function matchesFilter(s, key) {
  switch (key) {
    case 'current':
      return s.status === 'Active' && !s.isExpired;
    case 'ended':
      return (s.status === 'Active' && s.isExpired) || s.status === 'Cancelled';
    case 'rejected':
      return s.status === 'Rejected';
    default:
      return s.status !== 'Pending';
  }
}

function Delta({ now, before }) {
  if (before == null || !Number(before)) return null;
  const pct = Math.round(((now - before) / before) * 100);
  if (!Number.isFinite(pct) || pct === 0) return <span className="kpi-delta">geçen yılla aynı</span>;
  return (
    <span className={`kpi-delta ${pct > 0 ? 'is-up' : 'is-down'}`}>
      <i className={`bi ${pct > 0 ? 'bi-arrow-up-right' : 'bi-arrow-down-right'}`} aria-hidden="true" />
      geçen yıla göre %{Math.abs(pct)}
    </span>
  );
}

/** Yönetici: abonelik başvuruları, aboneler ve aylık / yıllık raporlar. */
export default function Abonelikler() {
  const toast = useToast();
  const thisYear = new Date().getFullYear();
  const [lot, setLot] = useState('');
  const [year, setYear] = useState(thisYear);
  const [view, setView] = useState('monthly'); // monthly | yearly
  const [list, setList] = useState([]);
  const [report, setReport] = useState(null);
  const [prevReport, setPrevReport] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('current');
  const [query, setQuery] = useState('');
  const [cancelling, setCancelling] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [all, rep, prev] = await Promise.all([
        getSubscriptions({ lot: lot || undefined }),
        getSubscriptionReport({ year, lot: lot || undefined }),
        getSubscriptionReport({ year: year - 1, lot: lot || undefined }).catch(() => null),
      ]);
      setList(Array.isArray(all) ? all : []);
      setReport(rep);
      setPrevReport(prev);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [lot, year]);

  useEffect(() => {
    load();
  }, [load]);

  const review = useSubscriptionReview(() => load());
  const pending = list.filter((s) => s.status === 'Pending');

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr-TR');
    const qPlate = normalizePlate(query);
    return list
      .filter((s) => matchesFilter(s, filter))
      .filter((s) => !q || s.holderName.toLocaleLowerCase('tr-TR').includes(q) || (qPlate && s.plate.includes(qPlate)));
  }, [list, filter, query]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, list.filter((s) => matchesFilter(s, f.key)).length])),
    [list],
  );

  const cancelSub = async () => {
    setCancelBusy(true);
    try {
      await updateSubscription(cancelling.id, { status: 'Cancelled', note: 'Yönetici tarafından iptal edildi.' });
      toast.success(`${formatPlate(cancelling.plate)} aboneliği iptal edildi.`);
      setCancelling(null);
      load();
    } catch (err) {
      toast.error(err);
    } finally {
      setCancelBusy(false);
    }
  };

  const months = report?.months || [];
  const chart = {
    labels: MONTHS,
    datasets: [
      { label: 'Aylık paket', data: months.map((m) => m.newMonthly), backgroundColor: CHART_COLORS.navy, borderRadius: 4, stack: 'n', maxBarThickness: 28 },
      { label: 'Yıllık paket', data: months.map((m) => m.newYearly), backgroundColor: CHART_COLORS.teal, borderRadius: 4, stack: 'n', maxBarThickness: 28 },
    ],
  };
  const yearsWithData = [thisYear, thisYear - 1, thisYear - 2];
  const newTotal = report ? report.newMonthly + report.newYearly : 0;
  const prevTotal = prevReport ? prevReport.newMonthly + prevReport.newYearly : null;

  return (
    <div>
      <PageHeader
        icon="bi-person-vcard"
        title="Abonelikler"
        subtitle="Başvuruları değerlendirin, aboneleri yönetin ve aylık-yıllık abone hareketini izleyin."
        actions={
          <>
            <LotSelector value={lot} onChange={setLot} allowAll label="Otopark" />
            <button type="button" className="btn btn-outline-primary" onClick={load} disabled={loading} aria-label="Yenile">
              <i className="bi bi-arrow-clockwise" />
            </button>
          </>
        }
      />

      <ErrorAlert error={error} onRetry={load} className="mb-4" />

      {/* 1) Bekleyen başvurular: sayfanın ilk işi */}
      <section className="card mb-4" aria-labelledby="pending-title">
        <div className="card-header d-flex justify-content-between align-items-center">
          <h2 id="pending-title" className="section-title">
            <i className="bi bi-hourglass-split me-2 text-accent" aria-hidden="true" />
            Değerlendirme bekleyen başvurular
            {pending.length > 0 && <span className="count-pill">{pending.length}</span>}
          </h2>
        </div>
        <div className="card-body pt-2">
          <PendingSubscriptions
            items={pending}
            busyId={review.busyId}
            onApprove={review.approve}
            onReject={review.startReject}
            emptyText="Bekleyen başvuru yok. Sürücüler Abonelik ekranından başvurduğunda burada görünür."
          />
        </div>
      </section>

      {/* 2) Rapor */}
      <section className="card mb-4" aria-labelledby="report-title">
        <div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
          <h2 id="report-title" className="section-title">
            <i className="bi bi-bar-chart-line me-2 text-accent" aria-hidden="true" />
            Abone raporu
          </h2>
          <div className="d-flex flex-wrap gap-2 align-items-center">
            <div className="seg" role="group" aria-label="Rapor görünümü">
              <button type="button" className={view === 'monthly' ? 'is-on' : ''} aria-pressed={view === 'monthly'} onClick={() => setView('monthly')}>
                Aylık
              </button>
              <button type="button" className={view === 'yearly' ? 'is-on' : ''} aria-pressed={view === 'yearly'} onClick={() => setView('yearly')}>
                Yıllık
              </button>
            </div>
            <label className="visually-hidden" htmlFor="report-year">
              Yıl
            </label>
            <select id="report-year" className="form-select form-select-sm w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {yearsWithData.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        {report && (
          <dl className="kpi-band">
            <div>
              <dt>Şu an aktif</dt>
              <dd>
                {report.activeNow}
                <small>
                  {report.activeMonthly} aylık, {report.activeYearly} yıllık
                </small>
              </dd>
            </div>
            <div>
              <dt>{year} yeni abone</dt>
              <dd>
                {newTotal}
                <Delta now={newTotal} before={prevTotal} />
              </dd>
            </div>
            <div>
              <dt>{year} abonelik geliri</dt>
              <dd>
                {formatCurrency(report.revenue)}
                <Delta now={report.revenue} before={prevReport?.revenue} />
              </dd>
            </div>
            <div className={report.expiringSoon > 0 ? 'is-due' : ''}>
              <dt>14 gün içinde bitecek</dt>
              <dd>
                {report.expiringSoon}
                {report.expiringSoon > 0 && <small>Aktif listesinde kalan güne bakın</small>}
              </dd>
            </div>
          </dl>
        )}

        <div className="card-body">
          {view === 'monthly' ? (
            newTotal === 0 ? (
              <p className="text-secondary mb-0">{year} yılında onaylanan abonelik yok. Başvuru onaylandıkça aylık dağılım burada görünür.</p>
            ) : (
              <div className="row g-4 align-items-start">
                <div className="col-lg-7">
                  <div className="chart-box sm">
                    <Bar
                      data={chart}
                      options={{
                        plugins: { legend: { position: 'bottom' } },
                        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
                      }}
                    />
                  </div>
                </div>
                <div className="col-lg-5">
                  <div className="table-responsive">
                    <table className="table table-sm report-table mb-0">
                      <caption className="visually-hidden">{year} aylık abone sayıları ve gelir</caption>
                      <thead>
                        <tr>
                          <th scope="col">Ay</th>
                          <th scope="col" className="text-end">Aylık</th>
                          <th scope="col" className="text-end">Yıllık</th>
                          <th scope="col" className="text-end">Gelir</th>
                        </tr>
                      </thead>
                      <tbody>
                        {months
                          .filter((m) => m.newMonthly + m.newYearly > 0)
                          .map((m) => (
                            <tr key={m.month}>
                              <th scope="row">{MONTHS_LONG[m.month - 1]}</th>
                              <td className="text-end">{m.newMonthly}</td>
                              <td className="text-end">{m.newYearly}</td>
                              <td className="text-end">{formatCurrency(m.revenue)}</td>
                            </tr>
                          ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th scope="row">Toplam</th>
                          <td className="text-end">{report?.newMonthly}</td>
                          <td className="text-end">{report?.newYearly}</td>
                          <td className="text-end">{formatCurrency(report?.revenue)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            )
          ) : (
            <div className="plan-split">
              {[
                { key: 'Monthly', label: 'Aylık paket', count: report?.newMonthly ?? 0, prev: prevReport?.newMonthly, active: report?.activeMonthly ?? 0 },
                { key: 'Yearly', label: 'Yıllık paket', count: report?.newYearly ?? 0, prev: prevReport?.newYearly, active: report?.activeYearly ?? 0 },
              ].map((p) => {
                const share = newTotal ? p.count / newTotal : 0;
                return (
                  <div key={p.key} className={`plan-split-row plan-${p.key === 'Yearly' ? 'yearly' : 'monthly'}`}>
                    <div className="plan-split-head">
                      <span className="fw-semibold">{p.label}</span>
                      <span className="plan-split-num">{p.count}</span>
                    </div>
                    <div className="plan-split-bar" role="img" aria-label={`${p.label}: yeni aboneliklerin yüzde ${Math.round(share * 100)}`}>
                      <span style={{ width: `${Math.round(share * 100)}%` }} />
                    </div>
                    <div className="plan-split-foot">
                      <span>Yeni abonelerin %{Math.round(share * 100)}</span>
                      <span>Şu an {p.active} aktif</span>
                      <Delta now={p.count} before={p.prev} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 3) Aboneler listesi */}
      <section className="card" aria-labelledby="list-title">
        <div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
          <h2 id="list-title" className="section-title">
            <i className="bi bi-people me-2 text-accent" aria-hidden="true" />
            Aboneler
          </h2>
          <div className="input-group input-group-sm sub-search">
            <span className="input-group-text">
              <i className="bi bi-search" aria-hidden="true" />
            </span>
            <input
              type="search"
              className="form-control"
              placeholder="Plaka veya ad ara"
              aria-label="Plaka veya ad ara"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="card-body">
          <div className="seg seg-scroll mb-3" role="group" aria-label="Abone durumu">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" className={filter === f.key ? 'is-on' : ''} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}
                <span className="seg-count">{counts[f.key] ?? 0}</span>
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="text-secondary mb-0">{query ? 'Aramanızla eşleşen abone yok.' : 'Bu grupta abone yok.'}</p>
          ) : (
            <div className="table-responsive">
              <table className="table align-middle sub-table mb-0">
                <thead>
                  <tr>
                    <th scope="col">Abone</th>
                    <th scope="col">Paket</th>
                    <th scope="col">Otopark</th>
                    <th scope="col">Süre</th>
                    <th scope="col">Durum</th>
                    <th scope="col">
                      <span className="visually-hidden">İşlemler</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const st = subscriptionStatus(s);
                    const left = s.status === 'Active' && s.isCurrent ? daysUntil(s.endDate) : null;
                    return (
                      <tr key={s.id}>
                        <td data-label="Abone">
                          <div className="d-flex align-items-center gap-2">
                            <PlateBadge plate={s.plate} size="sm" />
                            <div className="min-w-0">
                              <div className="fw-semibold text-truncate">{s.holderName}</div>
                              {s.phone && <div className="small text-secondary">{s.phone}</div>}
                            </div>
                          </div>
                        </td>
                        <td data-label="Paket">
                          <span className={`plan-tag plan-${s.plan === 'Yearly' ? 'yearly' : 'monthly'}`}>{planLabel(s.plan)}</span>
                          <div className="small text-secondary">{formatCurrency(s.price)}</div>
                        </td>
                        <td data-label="Otopark" className="small">
                          {s.lotName}
                        </td>
                        <td data-label="Süre" className="small">
                          {formatDate(s.startDate)}
                          {s.endDate ? ` – ${formatDate(s.endDate)}` : ''}
                          {left != null && <div className={left <= 14 ? 'text-warning-emphasis fw-semibold' : 'text-secondary'}>{left} gün kaldı</div>}
                        </td>
                        <td data-label="Durum">
                          <span className={`badge rounded-pill text-bg-${st.variant}`}>
                            <i className={`bi ${st.icon} me-1`} aria-hidden="true" />
                            {st.label}
                          </span>
                          {s.status === 'Rejected' && s.note && <div className="small text-secondary mt-1">{s.note}</div>}
                        </td>
                        <td className="text-end">
                          {s.status === 'Active' && !s.isExpired && (
                            <button type="button" className="btn btn-sm btn-light" onClick={() => setCancelling(s)}>
                              İptal et
                            </button>
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
      </section>

      {review.modal}

      <ConfirmModal
        show={!!cancelling}
        title="Aboneliği iptal et"
        icon="bi-slash-circle"
        variant="danger"
        confirmText="Aboneliği iptal et"
        busy={cancelBusy}
        onConfirm={cancelSub}
        onCancel={() => setCancelling(null)}
      >
        {cancelling && (
          <p className="mb-0">
            <strong>{cancelling.plate}</strong> plakalı aracın {planLabel(cancelling.plan).toLocaleLowerCase('tr-TR')} aboneliği hemen sona erer. Ücret iadesi bu
            ekrandan yapılmaz.
          </p>
        )}
      </ConfirmModal>
    </div>
  );
}
