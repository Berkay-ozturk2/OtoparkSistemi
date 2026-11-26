import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPrivacyRequests, updatePrivacyRequest } from '../../api/admin';
import PageHeader from '../../components/PageHeader';
import PlateBadge from '../../components/PlateBadge';
import Loading from '../../components/Loading';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { PRIVACY_STATUS, formatDateTime, minutesSince, privacyStatus, privacyTypeLabel } from '../../utils/format';

const LEGAL_DAYS = 30; // KVKK md. 13: en geç 30 gün

/** KVKK ilgili kişi başvuruları */
export default function KvkkTalepleri() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('Open');
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await getPrivacyRequests();
      setItems(Array.isArray(r) ? r : []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(
    () =>
      items
        .filter((i) => !statusFilter || (i.status || 'Open') === statusFilter)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [items, statusFilter],
  );
  const counts = items.reduce((acc, i) => ({ ...acc, [i.status || 'Open']: (acc[i.status || 'Open'] || 0) + 1 }), {});

  const save = async () => {
    setSaving(true);
    try {
      await updatePrivacyRequest(editing.id, { status: editing.status, note: editing.note || '' });
      setItems((list) => list.map((i) => (i.id === editing.id ? { ...i, status: editing.status, note: editing.note } : i)));
      toast.success('Talep güncellendi.');
      setEditing(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        icon="bi-shield-lock"
        title="KVKK Talepleri"
        subtitle="İlgili kişi başvuruları (KVKK md. 11). Başvurular en geç 30 gün içinde sonuçlandırılmalıdır."
        actions={
          <button type="button" className="btn btn-outline-primary" onClick={load}>
            <i className="bi bi-arrow-clockwise me-1" />
            Yenile
          </button>
        }
      />

      <ul className="nav nav-pills mb-3 gap-1">
        {[['', 'Tümü'], ...Object.entries(PRIVACY_STATUS).map(([k, v]) => [k, v.label])].map(([k, label]) => (
          <li className="nav-item" key={k || 'all'}>
            <button type="button" className={`nav-link ${statusFilter === k ? 'active' : ''}`} onClick={() => setStatusFilter(k)}>
              {label}{' '}
              <span className="badge rounded-pill text-bg-light border ms-1">{k ? counts[k] || 0 : items.length}</span>
            </button>
          </li>
        ))}
      </ul>

      <ErrorAlert error={error} onRetry={load} className="mb-3" />

      <div className="card">
        <div className="card-body p-0">
          {loading ? (
            <Loading />
          ) : rows.length === 0 ? (
            <EmptyState icon="bi-shield-check" title="Talep bulunamadı">
              {statusFilter === 'Open' ? 'Bekleyen KVKK başvurusu yok.' : null}
            </EmptyState>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>Tarih</th>
                    <th>Başvuran</th>
                    <th>Plaka</th>
                    <th>Tür</th>
                    <th>Mesaj</th>
                    <th>Durum</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const st = privacyStatus(r.status || 'Open');
                    const daysOpen = Math.floor(minutesSince(r.createdAt) / 1440);
                    const overdue = (r.status || 'Open') === 'Open' && daysOpen >= LEGAL_DAYS - 5;
                    return (
                      <tr key={r.id}>
                        <td className="small text-nowrap">
                          {formatDateTime(r.createdAt)}
                          {overdue && (
                            <div className="text-danger small fw-semibold">
                              <i className="bi bi-alarm me-1" />
                              {daysOpen} gündür açık
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="fw-semibold">{r.fullName}</div>
                          <div className="small text-secondary">{r.email}</div>
                        </td>
                        <td>{r.plate ? <PlateBadge plate={r.plate} size="sm" /> : '—'}</td>
                        <td>
                          <span className="badge text-bg-light border">{privacyTypeLabel(r.type)}</span>
                        </td>
                        <td className="small" style={{ maxWidth: 360 }}>
                          <span className="d-inline-block text-truncate" style={{ maxWidth: '100%' }} title={r.message}>
                            {r.message}
                          </span>
                          {r.note && <div className="text-secondary fst-italic text-truncate">Not: {r.note}</div>}
                        </td>
                        <td>
                          <span className={`badge text-bg-${st.variant}`}>{st.label}</span>
                        </td>
                        <td className="text-end">
                          <button type="button" className="btn btn-sm btn-outline-primary text-nowrap" onClick={() => setEditing({ ...r, status: r.status || 'Open', note: r.note || '' })}>
                            <i className="bi bi-pencil-square me-1" />
                            İşle
                          </button>
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

      <Modal
        show={!!editing}
        title="KVKK talebini işle"
        icon="bi-shield-lock"
        size="lg"
        onClose={saving ? undefined : () => setEditing(null)}
        footer={
          <>
            <button type="button" className="btn btn-light" onClick={() => setEditing(null)} disabled={saving}>
              Vazgeç
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
              {saving && <span className="spinner-border spinner-border-sm me-2" />}
              Kaydet
            </button>
          </>
        }
      >
        {editing && (
          <>
            <dl className="row small">
              <dt className="col-sm-3">Başvuran</dt>
              <dd className="col-sm-9">
                {editing.fullName} &lt;{editing.email}&gt;
              </dd>
              <dt className="col-sm-3">Tür</dt>
              <dd className="col-sm-9">{privacyTypeLabel(editing.type)}</dd>
              <dt className="col-sm-3">Plaka</dt>
              <dd className="col-sm-9">{editing.plate ? <PlateBadge plate={editing.plate} size="sm" /> : '—'}</dd>
              <dt className="col-sm-3">Tarih</dt>
              <dd className="col-sm-9">{formatDateTime(editing.createdAt)}</dd>
              <dt className="col-sm-3">Mesaj</dt>
              <dd className="col-sm-9" style={{ whiteSpace: 'pre-wrap' }}>
                {editing.message}
              </dd>
            </dl>
            {editing.type === 'Delete' && (
              <div className="alert alert-info small">
                <i className="bi bi-info-circle me-1" />
                Silme talebinde plakaya ait giriş-çıkış kayıtları, yasal saklama yükümlülüğü olmayanlar için anonimleştirilmelidir.
              </div>
            )}
            <div className="mb-3">
              <label className="form-label fw-semibold" htmlFor="kv-status">
                Durum
              </label>
              <select id="kv-status" className="form-select" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                {Object.entries(PRIVACY_STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label fw-semibold" htmlFor="kv-note">
                Not / yanıt
              </label>
              <textarea
                id="kv-note"
                className="form-control"
                rows={3}
                value={editing.note}
                onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                placeholder="Başvurana iletilecek açıklama veya iç not"
              />
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
