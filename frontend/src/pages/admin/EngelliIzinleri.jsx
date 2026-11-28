import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPermit, getPermits, updatePermit } from '../../api/admin';
import useParkingHub from '../../realtime/useParkingHub';
import PageHeader from '../../components/PageHeader';
import PlateBadge from '../../components/PlateBadge';
import LiveBadge from '../../components/LiveBadge';
import Loading from '../../components/Loading';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { downloadCsv } from '../../utils/csv';
import { normalizePlate, plateError } from '../../utils/plate';
import { addDays, formatDate, formatDateTime, isPermitValid, permitStatus, toDateInput } from '../../utils/format';

const TABS = [
  { value: 'Pending', label: 'Bekleyen', icon: 'bi-hourglass-split' },
  { value: 'Approved', label: 'Onaylı', icon: 'bi-patch-check' },
  { value: 'Rejected', label: 'Reddedilen', icon: 'bi-x-circle' },
  { value: 'Revoked', label: 'İptal edilen', icon: 'bi-slash-circle' },
  { value: '', label: 'Tümü', icon: 'bi-list-ul' },
];

/** date input (yyyy-mm-dd) → gün sonu ISO (UTC); boşsa null (süresiz) */
function dateToIso(d) {
  if (!d) return null;
  const dt = new Date(`${d}T23:59:59`);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}
function isoToDate(v) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : toDateInput(d);
}

const ACTION_INFO = {
  Approved: { title: 'İzni onayla', btn: 'Onayla', variant: 'success', icon: 'bi-patch-check' },
  Rejected: { title: 'Başvuruyu reddet', btn: 'Reddet', variant: 'danger', icon: 'bi-x-circle' },
  Revoked: { title: 'İzni iptal et', btn: 'İptal et', variant: 'dark', icon: 'bi-slash-circle' },
  Edit: { title: 'Geçerlilik tarihini düzenle', btn: 'Kaydet', variant: 'primary', icon: 'bi-calendar-event' },
};

/** Engelli park izinleri (sözleşme 11.3): başvuru onay/ret/iptal + gişede doğrudan izin ekleme */
export default function EngelliIzinleri() {
  const toast = useToast();
  const [status, setStatus] = useState('Pending');
  const [list, setList] = useState([]);
  const [pendingCount, setPendingCount] = useState(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // İşlem penceresi
  const [action, setAction] = useState(null); // { permit, kind }
  const [actValidUntil, setActValidUntil] = useState('');
  const [actNote, setActNote] = useState('');
  const [actBusy, setActBusy] = useState(false);

  // Yeni izin
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ plate: '', holderName: '', documentNo: '', validUntil: '' });
  const [formErr, setFormErr] = useState(null);
  const [formBusy, setFormBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [res, pend] = await Promise.all([
        getPermits(status || undefined),
        status === 'Pending' ? null : getPermits('Pending').catch(() => null),
      ]);
      const arr = Array.isArray(res) ? res : [];
      setList([...arr].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
      if (status === 'Pending') setPendingCount(arr.length);
      else if (Array.isArray(pend)) setPendingCount(pend.length);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const { status: hubStatus } = useParkingHub(
    {
      onPermitsChanged: (data) => {
        if (data && typeof data.pendingCount === 'number') setPendingCount(data.pendingCount);
        load();
      },
      onReconnected: load,
    },
    { withAuth: true },
  );

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr-TR');
    if (!q) return list;
    const qp = normalizePlate(query);
    return list.filter(
      (p) =>
        (qp && normalizePlate(p.plate).includes(qp)) ||
        (p.holderName || '').toLocaleLowerCase('tr-TR').includes(q) ||
        (p.userEmail || '').toLocaleLowerCase('tr-TR').includes(q) ||
        (p.documentNo || '').toLocaleLowerCase('tr-TR').includes(q),
    );
  }, [list, query]);

  const openAction = (permit, kind) => {
    setAction({ permit, kind });
    setActNote(kind === 'Edit' ? permit.note || '' : '');
    setActValidUntil(
      kind === 'Approved' ? isoToDate(permit.validUntil) || toDateInput(addDays(new Date(), 365)) : isoToDate(permit.validUntil),
    );
  };

  const submitAction = async () => {
    const { permit, kind } = action;
    const nextStatus = kind === 'Edit' ? permit.status : kind;
    if ((kind === 'Rejected' || kind === 'Revoked') && actNote.trim().length < 3) {
      toast.warning('Reddetmek ya da iptal etmek için gerekçeyi not alanına yazın.');
      return;
    }
    setActBusy(true);
    try {
      const updated = await updatePermit(permit.id, {
        status: nextStatus,
        validUntil: nextStatus === 'Approved' ? dateToIso(actValidUntil) : permit.validUntil ?? null,
        note: actNote.trim() || null,
      });
      toast.success(
        kind === 'Approved' ? 'İzin onaylandı.' : kind === 'Rejected' ? 'Başvuru reddedildi.' : kind === 'Revoked' ? 'İzin iptal edildi.' : 'İzin güncellendi.',
      );
      setList((cur) =>
        cur
          .map((x) => (x.id === permit.id ? { ...x, ...(updated && updated.id ? updated : { status: nextStatus, note: actNote.trim() || null }) } : x))
          .filter((x) => !status || x.status === status),
      );
      setAction(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setActBusy(false);
    }
  };

  const submitNew = async (e) => {
    e.preventDefault();
    const plate = normalizePlate(form.plate);
    const pe = plateError(plate);
    if (pe) return setFormErr(pe);
    if (form.holderName.trim().length < 3) return setFormErr('İzin sahibinin adını ve soyadını yazın.');
    if (form.documentNo.trim().length < 3) return setFormErr('Belge numarasını yazın.');
    if (form.validUntil && form.validUntil < toDateInput(new Date())) return setFormErr('Geçerlilik tarihi geçmişte olamaz.');
    setFormErr(null);
    setFormBusy(true);
    try {
      await createPermit({
        plate,
        holderName: form.holderName.trim(),
        documentNo: form.documentNo.trim(),
        validUntil: dateToIso(form.validUntil),
      });
      toast.success('Onaylı engelli izni eklendi.');
      setShowNew(false);
      setForm({ plate: '', holderName: '', documentNo: '', validUntil: '' });
      if (status === 'Approved' || status === '') load();
      else setStatus('Approved');
    } catch (err) {
      setFormErr(err.message);
    } finally {
      setFormBusy(false);
    }
  };

  const exportCsv = () => {
    downloadCsv(
      `engelli-izinleri-${status || 'tum'}.csv`,
      ['No', 'Plaka', 'İzin sahibi', 'Kullanıcı', 'Belge no', 'Durum', 'Geçerlilik', 'Başvuru', 'İnceleme', 'İnceleyen', 'Not'],
      rows.map((p) => [
        p.id,
        p.plate,
        p.holderName,
        p.userEmail || '',
        p.documentNo,
        permitStatus(p.status).label,
        p.validUntil ? formatDate(p.validUntil) : p.status === 'Approved' ? 'Süresiz' : '',
        formatDateTime(p.createdAt),
        p.reviewedAt ? formatDateTime(p.reviewedAt) : '',
        p.reviewedBy || '',
        p.note || '',
      ]),
    );
  };

  const info = action ? ACTION_INFO[action.kind] : null;

  return (
    <div>
      <PageHeader
        icon="bi-person-wheelchair"
        title="Engelli İzinleri"
        badge={pendingCount > 0 ? <span className="badge rounded-pill text-bg-warning fs-6">{pendingCount} bekleyen</span> : null}
        subtitle="Sürücülerin engelli park izni başvurularını onaylayın veya reddedin. Onaylı ve süresi dolmamış izinli araçlar ♿ cepleri kullanabilir."
        actions={
          <>
            <LiveBadge status={hubStatus} />
            <button type="button" className="btn btn-accent" onClick={() => setShowNew(true)}>
              <i aria-hidden="true" className="bi bi-plus-lg me-1" />
              Yeni izin ekle
            </button>
            <button type="button" className="btn btn-outline-secondary" onClick={exportCsv} disabled={rows.length === 0}>
              <i aria-hidden="true" className="bi bi-filetype-csv me-1" />
              CSV
            </button>
            <button type="button" className="btn btn-outline-primary" onClick={load} title="Yenile" aria-label="Yenile">
              <i aria-hidden="true" className="bi bi-arrow-clockwise" />
            </button>
          </>
        }
      />

      <div className="card mb-3">
        <div className="card-body d-flex flex-wrap gap-2 align-items-center">
          <ul className="nav nav-pills flex-wrap">
            {TABS.map((t) => (
              <li className="nav-item" key={t.value || 'all'}>
                <button type="button" className={`nav-link py-1 ${status === t.value ? 'active' : ''}`} onClick={() => setStatus(t.value)}>
                  <i aria-hidden="true" className={`bi ${t.icon} me-1`} />
                  {t.label}
                  {t.value === 'Pending' && pendingCount > 0 && <span className="badge rounded-pill text-bg-warning ms-1">{pendingCount}</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="input-group ms-auto" style={{ maxWidth: 320 }}>
            <span className="input-group-text">
              <i aria-hidden="true" className="bi bi-search" />
            </span>
            <input className="form-control" type="search" aria-label="İzinlerde ara" placeholder="Plaka, ad, e-posta, belge no…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
      </div>

      <ErrorAlert error={error} onRetry={load} className="mb-3" />

      <div className="card">
        <div className="card-body p-0">
          {loading && list.length === 0 ? (
            <Loading text="İzinler yükleniyor…" />
          ) : rows.length === 0 ? (
            <EmptyState icon="bi-person-wheelchair" title={status === 'Pending' ? 'Bekleyen başvuru yok' : 'Bu filtrede izin yok'}>
              {status === 'Pending' ? 'Yeni başvurular geldiğinde burada listelenir.' : 'Başka bir durum seçin ya da aramayı temizleyin.'}
            </EmptyState>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th>Plaka</th>
                    <th>İzin sahibi</th>
                    <th>Belge no</th>
                    <th>Durum</th>
                    <th>Geçerlilik</th>
                    <th>Başvuru</th>
                    <th className="text-end">İşlemler</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const st = permitStatus(p.status);
                    const expired = p.status === 'Approved' && !isPermitValid(p);
                    return (
                      <tr key={p.id}>
                        <td>
                          <PlateBadge plate={p.plate} size="sm" />
                        </td>
                        <td>
                          <div className="fw-semibold">{p.holderName}</div>
                          {p.userEmail ? (
                            <div className="small text-secondary">{p.userEmail}</div>
                          ) : (
                            <div className="small text-secondary">Gişeden eklendi</div>
                          )}
                        </td>
                        <td className="small">{p.documentNo || '—'}</td>
                        <td>
                          <span className={`badge text-bg-${expired ? 'secondary' : st.variant}`}>
                            <i aria-hidden="true" className={`bi ${st.icon} me-1`} />
                            {expired ? 'Süresi doldu' : st.label}
                          </span>
                          {p.note && (
                            <div className="small text-secondary mt-1 text-truncate" style={{ maxWidth: 220 }} title={p.note}>
                              <i aria-hidden="true" className="bi bi-chat-left-text me-1" />
                              {p.note}
                            </div>
                          )}
                          {p.reviewedBy && (
                            <div className="small text-secondary">
                              {p.reviewedBy} · {formatDateTime(p.reviewedAt)}
                            </div>
                          )}
                        </td>
                        <td className="small text-nowrap">
                          {p.status === 'Approved' ? (p.validUntil ? formatDate(p.validUntil) : 'Süresiz') : p.validUntil ? formatDate(p.validUntil) : '—'}
                        </td>
                        <td className="small text-nowrap">{formatDateTime(p.createdAt)}</td>
                        <td className="text-end text-nowrap">
                          {p.status !== 'Approved' && (
                            <button type="button" className="btn btn-sm btn-success me-1" onClick={() => openAction(p, 'Approved')}>
                              <i aria-hidden="true" className="bi bi-check2 me-1" />
                              Onayla
                            </button>
                          )}
                          {p.status === 'Pending' && (
                            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => openAction(p, 'Rejected')}>
                              Reddet
                            </button>
                          )}
                          {p.status === 'Approved' && (
                            <>
                              <button type="button" className="btn btn-sm btn-light border me-1" onClick={() => openAction(p, 'Edit')} title="Geçerlilik tarihini düzenle" aria-label="Geçerlilik tarihini düzenle">
                                <i aria-hidden="true" className="bi bi-calendar-event" />
                              </button>
                              <button type="button" className="btn btn-sm btn-outline-dark" onClick={() => openAction(p, 'Revoked')}>
                                İptal et
                              </button>
                            </>
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
      </div>

      {/* Onay / ret / iptal / düzenleme */}
      <Modal
        show={!!action}
        title={info?.title}
        icon={info?.icon}
        onClose={actBusy ? undefined : () => setAction(null)}
        staticBackdrop={actBusy}
        footer={
          <>
            <button type="button" className="btn btn-light" onClick={() => setAction(null)} disabled={actBusy}>
              Vazgeç
            </button>
            <button type="button" className={`btn btn-${info?.variant}`} onClick={submitAction} disabled={actBusy}>
              {actBusy && <span className="spinner-border spinner-border-sm me-2" />}
              {info?.btn}
            </button>
          </>
        }
      >
        {action && (
          <>
            <div className="d-flex align-items-center gap-2 mb-3">
              <PlateBadge plate={action.permit.plate} />
              <div>
                <div className="fw-semibold">{action.permit.holderName}</div>
                <div className="small text-secondary">Belge no: {action.permit.documentNo || '—'}</div>
              </div>
            </div>
            {(action.kind === 'Approved' || action.kind === 'Edit') && (
              <div className="mb-3">
                <label htmlFor="pa-valid" className="form-label fw-semibold">
                  Geçerlilik tarihi
                </label>
                <div className="input-group">
                  <input
                    id="pa-valid"
                    type="date"
                    className="form-control"
                    value={actValidUntil}
                    min={toDateInput(new Date())}
                    onChange={(e) => setActValidUntil(e.target.value)}
                  />
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setActValidUntil('')}>
                    Süresiz
                  </button>
                </div>
                <div className="form-text">Boş bırakılırsa izin süresiz geçerli olur. Belgenin (rapor/kart) geçerlilik tarihini girin.</div>
              </div>
            )}
            <label htmlFor="pa-note" className="form-label fw-semibold">
              Not{' '}
              <span className="text-secondary fw-normal">
                {action.kind === 'Rejected' || action.kind === 'Revoked' ? '(gerekçe — sürücü görür)' : '(isteğe bağlı)'}
              </span>
            </label>
            <textarea id="pa-note" className="form-control" rows={3} maxLength={500} value={actNote} onChange={(e) => setActNote(e.target.value)} />
          </>
        )}
      </Modal>

      {/* Yeni izin (gişede belge görülerek) */}
      <Modal
        show={showNew}
        title="Yeni engelli izni ekle"
        icon="bi-person-wheelchair"
        onClose={formBusy ? undefined : () => setShowNew(false)}
        staticBackdrop={formBusy}
        footer={
          <>
            <button type="button" className="btn btn-light" onClick={() => setShowNew(false)} disabled={formBusy}>
              Vazgeç
            </button>
            <button type="submit" form="permit-new" className="btn btn-success" disabled={formBusy}>
              {formBusy && <span className="spinner-border spinner-border-sm me-2" />}
              Onaylı izin olarak ekle
            </button>
          </>
        }
      >
        <form id="permit-new" onSubmit={submitNew} noValidate>
          <div className="alert alert-info small py-2">
            <i aria-hidden="true" className="bi bi-info-circle me-1" />
            Gişede engelli kimlik kartı / sağlık kurulu raporu görüldüğünde kullanılır; izin doğrudan <strong>onaylı</strong> olarak
            kaydedilir.
          </div>
          <div className="row g-2">
            <div className="col-sm-6">
              <label htmlFor="pn-plate" className="form-label small fw-semibold">
                Plaka
              </label>
              <input
                id="pn-plate"
                className="form-control text-uppercase"
                placeholder="06 ABC 123"
                maxLength={12}
                value={form.plate}
                onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value.toUpperCase() }))}
              />
            </div>
            <div className="col-sm-6">
              <label htmlFor="pn-valid" className="form-label small fw-semibold">
                Geçerlilik <span className="text-secondary fw-normal">(boş = süresiz)</span>
              </label>
              <input
                id="pn-valid"
                type="date"
                className="form-control"
                min={toDateInput(new Date())}
                value={form.validUntil}
                onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
              />
            </div>
            <div className="col-sm-6">
              <label htmlFor="pn-holder" className="form-label small fw-semibold">
                İzin sahibi (ad soyad)
              </label>
              <input id="pn-holder" className="form-control" maxLength={100} value={form.holderName} onChange={(e) => setForm((f) => ({ ...f, holderName: e.target.value }))} />
            </div>
            <div className="col-sm-6">
              <label htmlFor="pn-doc" className="form-label small fw-semibold">
                Belge no
              </label>
              <input id="pn-doc" className="form-control" maxLength={50} value={form.documentNo} onChange={(e) => setForm((f) => ({ ...f, documentNo: e.target.value }))} />
            </div>
          </div>
          {formErr && <div className="alert alert-danger py-2 small mt-3 mb-0">{formErr}</div>}
        </form>
      </Modal>
    </div>
  );
}
