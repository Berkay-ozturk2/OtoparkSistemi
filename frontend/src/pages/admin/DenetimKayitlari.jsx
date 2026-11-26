import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAuditLogs } from '../../api/admin';
import PageHeader from '../../components/PageHeader';
import Loading from '../../components/Loading';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import { downloadCsv } from '../../utils/csv';
import { formatDateTime } from '../../utils/format';

function actionVariant(action) {
  const a = String(action || '').toLowerCase();
  if (a.includes('delete') || a.includes('sil') || a.includes('reject') || a.includes('fail')) return 'danger';
  if (a.includes('login') || a.includes('giris')) return 'info';
  if (a.includes('create') || a.includes('add') || a.includes('ekle')) return 'success';
  if (a.includes('update') || a.includes('override') || a.includes('manual') || a.includes('setting')) return 'warning';
  return 'secondary';
}

/** Denetim (audit) kayıtları */
export default function DenetimKayitlari() {
  const [logs, setLogs] = useState([]);
  const [limit, setLimit] = useState(100);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (lim) => {
    setLoading(true);
    setError(null);
    try {
      const l = await getAuditLogs(lim);
      setLogs(Array.isArray(l) ? l : []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(limit);
  }, [load, limit]);

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr-TR');
    if (!q) return logs;
    return logs.filter((l) =>
      [l.userEmail, l.action, l.details, l.ipAddress].some((v) => String(v || '').toLocaleLowerCase('tr-TR').includes(q)),
    );
  }, [logs, query]);

  const exportCsv = () => {
    downloadCsv(
      `denetim-kayitlari-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Zaman', 'Kullanıcı', 'İşlem', 'Ayrıntı', 'IP'],
      rows.map((l) => [formatDateTime(l.createdAt), l.userEmail || '', l.action || '', l.details || '', l.ipAddress || '']),
    );
  };

  return (
    <div>
      <PageHeader
        icon="bi-journal-text"
        title="Denetim Kayıtları"
        subtitle="Sistemde yapılan kritik işlemlerin (giriş, ayar değişikliği, manuel geçiş, silme vb.) kaydı."
        actions={
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={exportCsv} disabled={rows.length === 0}>
              <i className="bi bi-filetype-csv me-1" />
              CSV
            </button>
            <button type="button" className="btn btn-outline-primary" onClick={() => load(limit)}>
              <i className="bi bi-arrow-clockwise me-1" />
              Yenile
            </button>
          </>
        }
      />

      <div className="card mb-3">
        <div className="card-body">
          <div className="row g-2">
            <div className="col-md-8">
              <div className="input-group">
                <span className="input-group-text">
                  <i className="bi bi-search" />
                </span>
                <input className="form-control" placeholder="Kullanıcı, işlem, ayrıntı veya IP ara…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            </div>
            <div className="col-md-4">
              <select className="form-select" value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Kayıt sayısı">
                {[50, 100, 250, 500].map((n) => (
                  <option key={n} value={n}>
                    Son {n} kayıt
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <ErrorAlert error={error} onRetry={() => load(limit)} className="mb-3" />

      <div className="card">
        <div className="card-body p-0">
          {loading ? (
            <Loading />
          ) : rows.length === 0 ? (
            <EmptyState icon="bi-journal" title="Kayıt bulunamadı" />
          ) : (
            <div className="table-responsive">
              <table className="table table-hover table-sm">
                <thead>
                  <tr>
                    <th>Zaman</th>
                    <th>Kullanıcı</th>
                    <th>İşlem</th>
                    <th>Ayrıntı</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id}>
                      <td className="small text-nowrap">{formatDateTime(l.createdAt)}</td>
                      <td className="small">{l.userEmail || <span className="text-secondary">sistem</span>}</td>
                      <td>
                        <span className={`badge text-bg-${actionVariant(l.action)}`}>{l.action}</span>
                      </td>
                      <td className="small" style={{ maxWidth: 480 }}>
                        <span className="d-inline-block text-truncate" style={{ maxWidth: '100%' }} title={l.details}>
                          {l.details}
                        </span>
                      </td>
                      <td className="small font-monospace text-secondary">{l.ipAddress || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
