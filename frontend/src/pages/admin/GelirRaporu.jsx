import { useCallback, useEffect, useRef, useState } from 'react';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { CHART_COLORS } from '../../utils/chartSetup';
import { getRevenueReport } from '../../api/admin';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';
import DateRangeBar, { presetRange } from '../../components/DateRangeBar';
import LotSelector from '../../components/LotSelector';
import { useLot } from '../../lot/LotContext';
import Loading from '../../components/Loading';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import { downloadCsv, csvNumber } from '../../utils/csv';
import { formatCurrency, formatDate, formatNumber, formatPercent, paymentMethodLabel } from '../../utils/format';

const GROUPS = [
  { value: 'day', label: 'Günlük' },
  { value: 'week', label: 'Haftalık' },
  { value: 'month', label: 'Aylık' },
];

/** "2026-11-20" → "20.11.2026", "2026-W47" / "2026-11" gibi dönemler olduğu gibi */
function periodLabel(p, groupBy) {
  if (typeof p !== 'string') return String(p ?? '');
  if (/^\d{4}-\d{2}-\d{2}/.test(p)) {
    const d = formatDate(p.slice(0, 10));
    return groupBy === 'week' ? `${d} haftası` : d;
  }
  if (/^\d{4}-\d{2}$/.test(p)) {
    const [y, m] = p.split('-');
    const name = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
    return name;
  }
  return p;
}

/** UC-11: Gelir raporunu al */
export default function GelirRaporu() {
  const { lotName } = useLot();
  const [range, setRange] = useState(() => presetRange(29));
  const [lot, setLot] = useState(''); // '' = tüm otoparklar
  const lotRef = useRef(lot);
  const [groupBy, setGroupBy] = useState('day');
  const [chartType, setChartType] = useState('bar');
  const [report, setReport] = useState(null);
  const [loadedGroup, setLoadedGroup] = useState('day');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(
    async (r, g) => {
      const { from, to } = r || range;
      const grp = g || groupBy;
      setLoading(true);
      setError(null);
      try {
        setReport(await getRevenueReport({ from, to, groupBy: grp, lot: lotRef.current || undefined }));
        setLoadedGroup(grp);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [range, groupBy],
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, []);

  const series = report?.series || [];
  const byMethod = report?.byMethod || [];
  const hasData = (report?.count || 0) > 0 || series.some((s) => Number(s.amount) > 0);
  const best = series.reduce((b, s) => (!b || Number(s.amount) > Number(b.amount) ? s : b), null);
  const methodTotal = byMethod.reduce((sum, m) => sum + (Number(m.amount) || 0), 0);

  const labels = series.map((s) => periodLabel(s.period, loadedGroup));
  const seriesData = {
    labels,
    datasets: [
      {
        label: 'Gelir (TL)',
        data: series.map((s) => Number(s.amount) || 0),
        backgroundColor: chartType === 'bar' ? CHART_COLORS.teal : CHART_COLORS.tealSoft,
        borderColor: CHART_COLORS.teal,
        borderRadius: 6,
        maxBarThickness: 42,
        fill: chartType === 'line',
        tension: 0.3,
        yAxisID: 'y',
      },
      {
        label: 'İşlem sayısı',
        data: series.map((s) => Number(s.count) || 0),
        type: 'line',
        borderColor: CHART_COLORS.navy,
        backgroundColor: CHART_COLORS.navy,
        pointRadius: 3,
        tension: 0.3,
        yAxisID: 'y1',
      },
    ],
  };
  const seriesOptions = {
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom' },
      tooltip: {
        callbacks: {
          label: (c) => (c.dataset.yAxisID === 'y' ? `Gelir: ${formatCurrency(c.parsed.y)}` : `İşlem: ${c.parsed.y}`),
        },
      },
    },
    scales: {
      y: { beginAtZero: true, ticks: { callback: (v) => `${formatNumber(v, 0)} ₺` } },
      y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { precision: 0 } },
    },
  };

  const doughnutData = {
    labels: byMethod.map((m) => paymentMethodLabel(m.method)),
    datasets: [
      {
        data: byMethod.map((m) => Number(m.amount) || 0),
        backgroundColor: CHART_COLORS.palette,
        borderWidth: 2,
        borderColor: '#fff',
      },
    ],
  };
  const doughnutOptions = {
    cutout: '62%',
    plugins: {
      legend: { position: 'bottom' },
      tooltip: {
        callbacks: {
          label: (c) => `${c.label}: ${formatCurrency(c.parsed)} (${formatPercent(methodTotal ? c.parsed / methodTotal : 0, 1)})`,
        },
      },
    },
  };

  const exportCsv = () => {
    const rows = [
      ['Dönem', 'Gelir (TL)', 'İşlem sayısı'],
      ...series.map((s) => [periodLabel(s.period, loadedGroup), csvNumber(s.amount), s.count]),
      ['', '', ''],
      ['Ödeme yöntemi', 'Gelir (TL)', 'Pay (%)'],
      ...byMethod.map((m) => [paymentMethodLabel(m.method), csvNumber(m.amount), csvNumber(methodTotal ? (m.amount / methodTotal) * 100 : 0, 1)]),
      ['', '', ''],
      ['Toplam gelir', csvNumber(report?.total), ''],
      ['İşlem sayısı', report?.count ?? 0, ''],
      ['Oturum başına ortalama', csvNumber(report?.averagePerSession), ''],
    ];
    downloadCsv(`gelir-raporu_${lot || 'tum'}_${range.from}_${range.to}_${loadedGroup}.csv`, ['Gelir Raporu', `${formatDate(range.from)} - ${formatDate(range.to)}`, lot ? lotName(lot) : 'Tüm otoparklar'], rows);
  };

  const SeriesChart = chartType === 'line' ? Line : Bar;

  return (
    <div>
      <PageHeader
        icon="bi-cash-coin"
        title="Gelir Raporu"
        subtitle={`${lot ? lotName(lot) : 'Tüm otoparklar'} · seçilen aralıktaki tahsilatlar: dönemsel seri, ödeme yöntemine göre dağılım ve toplamlar (UC-11).`}
        actions={
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={exportCsv} disabled={!hasData}>
              <i className="bi bi-filetype-csv me-1" />
              CSV indir
            </button>
            <button type="button" className="btn btn-outline-secondary no-print" onClick={() => window.print()} disabled={!hasData}>
              <i className="bi bi-printer" />
            </button>
          </>
        }
      />

      <DateRangeBar from={range.from} to={range.to} onChange={setRange} onSubmit={(r) => load(r)} busy={loading}>
        <div className="col-6 col-md-3 col-xl-2">
          <label className="form-label small fw-semibold mb-1" htmlFor="gr-group">
            Gruplama
          </label>
          <select
            id="gr-group"
            className="form-select"
            value={groupBy}
            onChange={(e) => {
              setGroupBy(e.target.value);
              load(null, e.target.value);
            }}
          >
            {GROUPS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <div className="col-12 col-md-4 col-xl-3">
          <div className="form-label small fw-semibold mb-1">Otopark</div>
          <LotSelector
            value={lot}
            onChange={(c) => {
              setLot(c);
              lotRef.current = c;
              load();
            }}
            allowAll
            align="start"
            size=""
            className="w-100"
          />
        </div>
      </DateRangeBar>

      <ErrorAlert error={error} onRetry={() => load()} className="mb-4" />

      {loading && !report ? (
        <Loading text="Rapor hazırlanıyor…" />
      ) : report && !hasData ? (
        <div className="card">
          <EmptyState icon="bi-cash" title="Bu aralıkta gelir yok">
            Farklı bir tarih aralığı seçin veya Yönetim Paneli&apos;ndeki &quot;Demo verisi üret&quot; ile örnek veri oluşturun.
          </EmptyState>
        </div>
      ) : report ? (
        <>
          <div className="row g-3 mb-4">
            <div className="col-6 col-xl-3">
              <StatCard icon="bi-cash-stack" label="Toplam gelir" value={formatCurrency(report.total)} variant="teal" />
            </div>
            <div className="col-6 col-xl-3">
              <StatCard icon="bi-receipt" label="İşlem sayısı" value={formatNumber(report.count, 0)} variant="primary" />
            </div>
            <div className="col-6 col-xl-3">
              <StatCard icon="bi-calculator" label="Oturum başına ort." value={formatCurrency(report.averagePerSession)} variant="info" />
            </div>
            <div className="col-6 col-xl-3">
              <StatCard
                icon="bi-trophy"
                label="En yüksek dönem"
                value={best ? formatCurrency(best.amount) : '—'}
                sub={best ? periodLabel(best.period, loadedGroup) : null}
                variant="warning"
              />
            </div>
          </div>

          <div className="row g-4 mb-4">
            <div className="col-xl-8">
              <div className="card h-100">
                <div className="card-header d-flex justify-content-between align-items-center">
                  <span>
                    <i className="bi bi-graph-up me-2 text-accent" />
                    {GROUPS.find((g) => g.value === loadedGroup)?.label} gelir serisi
                  </span>
                  <div className="btn-group btn-group-sm" role="group" aria-label="Grafik türü">
                    <button type="button" className={`btn ${chartType === 'bar' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setChartType('bar')}>
                      <i className="bi bi-bar-chart" />
                    </button>
                    <button type="button" className={`btn ${chartType === 'line' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setChartType('line')}>
                      <i className="bi bi-graph-up" />
                    </button>
                  </div>
                </div>
                <div className="card-body">
                  <div className="chart-box">
                    <SeriesChart key={chartType} data={seriesData} options={seriesOptions} />
                  </div>
                </div>
              </div>
            </div>
            <div className="col-xl-4">
              <div className="card h-100">
                <div className="card-header">
                  <i className="bi bi-pie-chart me-2 text-accent" />
                  Ödeme yöntemine göre
                </div>
                <div className="card-body">
                  {byMethod.length === 0 ? (
                    <EmptyState icon="bi-pie-chart" title="Yöntem verisi yok" />
                  ) : (
                    <>
                      <div className="chart-box sm">
                        <Doughnut data={doughnutData} options={doughnutOptions} />
                      </div>
                      <ul className="list-unstyled small mt-3 mb-0">
                        {byMethod.map((m, i) => (
                          <li key={m.method} className="d-flex justify-content-between py-1 border-bottom">
                            <span>
                              <span className="legend-dot" style={{ background: CHART_COLORS.palette[i % CHART_COLORS.palette.length] }} />
                              {paymentMethodLabel(m.method)}
                            </span>
                            <span className="fw-semibold">
                              {formatCurrency(m.amount)}{' '}
                              <span className="text-secondary fw-normal">({formatPercent(methodTotal ? m.amount / methodTotal : 0, 1)})</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <i className="bi bi-table me-2 text-accent" />
              Dönem tablosu
            </div>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    <tr>
                      <th>Dönem</th>
                      <th className="text-end">İşlem</th>
                      <th className="text-end">Gelir</th>
                      <th className="text-end">İşlem başına</th>
                    </tr>
                  </thead>
                  <tbody>
                    {series.map((s) => (
                      <tr key={s.period}>
                        <td className="fw-semibold">{periodLabel(s.period, loadedGroup)}</td>
                        <td className="text-end">{s.count}</td>
                        <td className="text-end">{formatCurrency(s.amount)}</td>
                        <td className="text-end text-secondary">{s.count ? formatCurrency(s.amount / s.count) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="fw-bold">
                      <td>Toplam</td>
                      <td className="text-end">{report.count}</td>
                      <td className="text-end">{formatCurrency(report.total)}</td>
                      <td className="text-end">{formatCurrency(report.averagePerSession)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
