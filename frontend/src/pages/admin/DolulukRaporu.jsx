import { useCallback, useEffect, useRef, useState } from 'react';
import { Chart } from 'react-chartjs-2';
import { CHART_COLORS } from '../../utils/chartSetup';
import { getOccupancyReport } from '../../api/admin';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';
import DateRangeBar, { presetRange } from '../../components/DateRangeBar';
import Loading from '../../components/Loading';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import LotSelector from '../../components/LotSelector';
import { useLot } from '../../lot/LotContext';
import { downloadCsv, csvNumber } from '../../utils/csv';
import { formatDate, formatDuration, formatHour, formatNumber, formatPercent } from '../../utils/format';

/** UC-10: Doluluk raporunu al */
export default function DolulukRaporu() {
  const { lotName } = useLot();
  const [range, setRange] = useState(() => presetRange(6));
  const [lot, setLot] = useState(''); // '' = tüm otoparklar
  const lotRef = useRef(lot);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(
    async (r) => {
      const { from, to } = r || range;
      setLoading(true);
      setError(null);
      try {
        setReport(await getOccupancyReport({ from, to, lot: lotRef.current || undefined }));
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [range],
  );

  useEffect(() => {
    load();
    // yalnızca ilk açılışta otomatik
    // eslint-disable-next-line
  }, []);

  // 0–23 saatlerinin tamamını göster (eksik saatleri sıfırla)
  const hourlyMap = new Map((report?.hourly || []).map((h) => [h.hour, h]));
  const hourly = Array.from({ length: 24 }, (_, h) => hourlyMap.get(h) || { hour: h, entries: 0, averageOccupancyRate: 0 });
  const daily = report?.daily || [];
  const hasData = (report?.totalEntries || 0) > 0 || daily.length > 0;
  const peak = hourly.reduce((best, h) => (h.entries > (best?.entries ?? -1) ? h : best), null);
  const occValues = (report?.hourly || []).map((h) => Number(h.averageOccupancyRate) || 0);
  const avgOcc = occValues.length ? occValues.reduce((a, b) => a + b, 0) / occValues.length : null;
  const busiestDay = daily.reduce((best, d) => (!best || d.entries > best.entries ? d : best), null);

  const chartData = {
    labels: hourly.map((h) => formatHour(h.hour)),
    datasets: [
      {
        type: 'bar',
        label: 'Giriş sayısı',
        data: hourly.map((h) => h.entries),
        backgroundColor: hourly.map((h) => (peak && h.hour === peak.hour && h.entries > 0 ? CHART_COLORS.orange : CHART_COLORS.navySoft)),
        borderRadius: 5,
        yAxisID: 'y',
        order: 2,
      },
      {
        type: 'line',
        label: 'Ortalama doluluk (%)',
        data: hourly.map((h) => Math.round((Number(h.averageOccupancyRate) || 0) * 1000) / 10),
        borderColor: CHART_COLORS.teal,
        backgroundColor: CHART_COLORS.tealSoft,
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        yAxisID: 'y1',
        order: 1,
      },
    ],
  };

  const chartOptions = {
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom' },
      tooltip: {
        callbacks: {
          label: (c) => (c.dataset.yAxisID === 'y1' ? `Doluluk: %${c.parsed.y}` : `Giriş: ${c.parsed.y}`),
        },
      },
    },
    scales: {
      y: { beginAtZero: true, position: 'left', title: { display: true, text: 'Giriş' }, ticks: { precision: 0 } },
      y1: {
        beginAtZero: true,
        max: 100,
        position: 'right',
        title: { display: true, text: 'Doluluk %' },
        grid: { drawOnChartArea: false },
      },
    },
  };

  const exportCsv = () => {
    const rows = [
      ['GÜNLÜK ÖZET', '', '', ''],
      ['Tarih', 'Giriş sayısı', 'Ortalama kalış (dk)', 'Pik saat'],
      ...daily.map((d) => [formatDate(d.date), d.entries, csvNumber(d.averageDurationMinutes, 1), formatHour(d.peakHour)]),
      ['', '', '', ''],
      ['SAATLİK DAĞILIM', '', '', ''],
      ['Saat', 'Giriş sayısı', 'Ortalama doluluk (%)', ''],
      ...hourly.map((h) => [formatHour(h.hour), h.entries, csvNumber((Number(h.averageOccupancyRate) || 0) * 100, 1), '']),
      ['', '', '', ''],
      ['Toplam giriş', report?.totalEntries ?? 0, '', ''],
      ['Ortalama kalış (dk)', csvNumber(report?.averageDurationMinutes, 1), '', ''],
    ];
    downloadCsv(
      `doluluk-raporu_${lot || 'tum'}_${range.from}_${range.to}.csv`,
      ['Doluluk Raporu', `${formatDate(range.from)} - ${formatDate(range.to)}`, lot ? lotName(lot) : 'Tüm otoparklar', ''],
      rows,
    );
  };

  return (
    <div>
      <PageHeader
        icon="bi-bar-chart-line"
        title="Doluluk Raporu"
        subtitle={`${lot ? lotName(lot) : 'Tüm otoparklar'} · seçilen tarih aralığında saatlik giriş yoğunluğu, ortalama doluluk ve günlük özet (UC-10).`}
        actions={
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={exportCsv} disabled={!hasData}>
              <i aria-hidden="true" className="bi bi-filetype-csv me-1" />
              CSV indir
            </button>
            <button type="button" className="btn btn-outline-secondary no-print" onClick={() => window.print()} disabled={!hasData} aria-label="Raporu yazdır" title="Raporu yazdır">
              <i aria-hidden="true" className="bi bi-printer" />
            </button>
          </>
        }
      />

      <DateRangeBar from={range.from} to={range.to} onChange={setRange} onSubmit={(r) => load(r)} busy={loading}>
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
          <EmptyState icon="bi-bar-chart" title="Bu aralıkta veri yok">
            Seçilen tarihlerde giriş kaydı yok. Başka bir aralık seçin ya da Yönetim Paneli&apos;nden demo verisi üretin.
          </EmptyState>
        </div>
      ) : report ? (
        <>
          <div className="row g-3 mb-4">
            <div className="col-6 col-xl-3">
              <StatCard icon="bi-box-arrow-in-right" label="Toplam giriş" value={formatNumber(report.totalEntries, 0)} variant="primary" />
            </div>
            <div className="col-6 col-xl-3">
              <StatCard icon="bi-hourglass-split" label="Ortalama kalış" value={formatDuration(report.averageDurationMinutes)} variant="teal" />
            </div>
            <div className="col-6 col-xl-3">
              <StatCard
                icon="bi-graph-up-arrow"
                label="Pik saat"
                value={peak && peak.entries > 0 ? `${formatHour(peak.hour)}` : '—'}
                sub={peak && peak.entries > 0 ? `${peak.entries} giriş` : null}
                variant="warning"
              />
            </div>
            <div className="col-6 col-xl-3">
              <StatCard
                icon="bi-pie-chart"
                label="Ort. doluluk"
                value={avgOcc != null ? formatPercent(avgOcc, 1) : '—'}
                sub={busiestDay ? `En yoğun gün: ${formatDate(busiestDay.date)}` : null}
                variant="info"
              />
            </div>
          </div>

          <div className="card mb-4">
            <div className="card-header">
              <i aria-hidden="true" className="bi bi-clock me-2 text-accent" />
              Saatlik giriş ve ortalama doluluk
            </div>
            <div className="card-body">
              <div className="chart-box lg">
                <Chart type="bar" data={chartData} options={chartOptions} />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <i aria-hidden="true" className="bi bi-table me-2 text-accent" />
              Günlük özet
            </div>
            <div className="card-body p-0">
              {daily.length === 0 ? (
                <EmptyState icon="bi-table" title="Günlük veri yok">Bu aralıkta gün bazında kayıt oluşmamış.</EmptyState>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover">
                    <thead>
                      <tr>
                        <th>Tarih</th>
                        <th className="text-end">Giriş</th>
                        <th className="text-end">Ortalama kalış</th>
                        <th className="text-end">Pik saat</th>
                        <th style={{ width: '30%' }}>Yoğunluk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {daily.map((d) => {
                        const max = busiestDay?.entries || 1;
                        return (
                          <tr key={d.date}>
                            <td className="fw-semibold">{formatDate(d.date)}</td>
                            <td className="text-end">{d.entries}</td>
                            <td className="text-end">{formatDuration(d.averageDurationMinutes)}</td>
                            <td className="text-end">{d.peakHour != null ? formatHour(d.peakHour) : '—'}</td>
                            <td>
                              <div className="progress" style={{ height: 8 }}>
                                <div className="progress-bar" style={{ width: `${Math.round((d.entries / max) * 100)}%` }} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
