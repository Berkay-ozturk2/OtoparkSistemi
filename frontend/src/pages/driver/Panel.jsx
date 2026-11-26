import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { addVehicle, applyPermit, deleteVehicle, getMyPermits, getMyReservations, getMySessions, getMyVehicles } from '../../api/driver';
import { useAuth } from '../../auth/AuthContext';
import PageHeader from '../../components/PageHeader';
import PlateBadge from '../../components/PlateBadge';
import StatCard from '../../components/StatCard';
import Loading from '../../components/Loading';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import ConfirmModal from '../../components/ConfirmModal';
import { useToast } from '../../components/Toast';
import { normalizePlate, plateError } from '../../utils/plate';
import {
  formatCurrency,
  formatDateTime,
  formatDate,
  formatDuration,
  isPermitValid,
  minutesSince,
  permitStatus,
  reservationStatus,
  sessionStatus,
} from '../../utils/format';

export default function SurucuPanel() {
  const { user } = useAuth();
  const toast = useToast();
  const [vehicles, setVehicles] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [plate, setPlate] = useState('');
  const [nickname, setNickname] = useState('');
  const [plateErr, setPlateErr] = useState(null);
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [, setTick] = useState(0);

  // Engelli izni başvurusu
  const [permits, setPermits] = useState([]);
  const [permitForm, setPermitForm] = useState({ plate: '', holderName: '', documentNo: '' });
  const [permitErr, setPermitErr] = useState(null);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [v, s, r, p] = await Promise.all([
        getMyVehicles(),
        getMySessions(),
        getMyReservations(),
        getMyPermits().catch(() => []),
      ]);
      setVehicles(Array.isArray(v) ? v : []);
      setSessions(Array.isArray(s) ? s : []);
      setReservations(Array.isArray(r) ? r : []);
      setPermits(Array.isArray(p) ? p : []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => setTick((x) => x + 1), 60000); // süreleri dakikada bir tazele
    return () => clearInterval(t);
  }, [load]);

  const active = sessions.filter((s) => s.status === 'Active');
  const history = sessions
    .filter((s) => s.status !== 'Active')
    .sort((a, b) => new Date(b.entryTime) - new Date(a.entryTime));
  const upcoming = reservations.filter((r) => ['PendingPayment', 'Confirmed', 'CheckedIn'].includes(r.status));
  const totalSpent = sessions.reduce((sum, s) => sum + (Number(s.paidAmount) || 0), 0);

  const onAdd = async (e) => {
    e.preventDefault();
    const n = normalizePlate(plate);
    const v = plateError(n);
    setPlateErr(v);
    if (v) return;
    if (vehicles.some((x) => normalizePlate(x.plate) === n)) {
      setPlateErr('Bu plaka zaten listenizde.');
      return;
    }
    setAdding(true);
    try {
      await addVehicle({ plate: n, nickname: nickname.trim() });
      setPlate('');
      setNickname('');
      toast.success('Araç eklendi.');
      const v2 = await getMyVehicles();
      setVehicles(Array.isArray(v2) ? v2 : []);
    } catch (err) {
      toast.error(err);
    } finally {
      setAdding(false);
    }
  };

  // Araç başına izin durumu: önce /api/vehicles/my içindeki disabledPermitStatus, yoksa başvurulardan en günceli
  const permitFor = (plateValue) => {
    const n = normalizePlate(plateValue);
    return [...permits]
      .filter((p) => normalizePlate(p.plate) === n)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  };
  const vehiclePermitStatus = (v) => v.disabledPermitStatus ?? permitFor(v.plate)?.status ?? null;

  const onApplyPermit = async (e) => {
    e.preventDefault();
    const plateN = normalizePlate(permitForm.plate);
    if (!plateN) return setPermitErr('Başvuru için bir aracınızı seçin.');
    if (permitForm.holderName.trim().length < 3) return setPermitErr('İzin sahibinin adını ve soyadını yazın.');
    if (permitForm.documentNo.trim().length < 3) return setPermitErr('Engelli kartı / rapor belge numarasını yazın.');
    const existing = permitFor(plateN);
    if (existing && (existing.status === 'Pending' || isPermitValid(existing))) {
      return setPermitErr('Bu plaka için bekleyen veya onaylı bir başvuru zaten var.');
    }
    setPermitErr(null);
    setApplying(true);
    try {
      const created = await applyPermit({
        plate: plateN,
        holderName: permitForm.holderName.trim(),
        documentNo: permitForm.documentNo.trim(),
      });
      toast.success('Engelli izni başvurunuz alındı. Yönetici onayından sonra engelli park yerlerini kullanabilirsiniz.');
      setPermitForm((f) => ({ ...f, plate: '', documentNo: '' }));
      if (created && created.id) setPermits((list) => [created, ...list.filter((x) => x.id !== created.id)]);
      const [p2, v2] = await Promise.all([getMyPermits().catch(() => null), getMyVehicles().catch(() => null)]);
      if (Array.isArray(p2)) setPermits(p2);
      if (Array.isArray(v2)) setVehicles(v2);
    } catch (err) {
      setPermitErr(err.message);
    } finally {
      setApplying(false);
    }
  };

  const onDelete = async () => {
    setDeleting(true);
    try {
      await deleteVehicle(toDelete.id);
      setVehicles((list) => list.filter((v) => v.id !== toDelete.id));
      toast.success('Araç silindi.');
      setToDelete(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <Loading text="Paneliniz hazırlanıyor…" />;

  return (
    <div>
      <PageHeader
        icon="bi-speedometer2"
        title={`Merhaba, ${user?.fullName?.split(' ')[0] || 'Sürücü'}`}
        subtitle="Araçlarınızı, aktif park oturumlarınızı ve geçmişinizi buradan yönetebilirsiniz."
        actions={
          <>
            <Link to="/surucu/rezervasyon" className="btn btn-accent">
              <i className="bi bi-calendar-plus me-2" />
              Yeni Rezervasyon
            </Link>
            <button type="button" className="btn btn-outline-primary" onClick={load}>
              <i className="bi bi-arrow-clockwise" />
            </button>
          </>
        }
      />

      <ErrorAlert error={error} onRetry={load} className="mb-4" />

      <div className="row g-3 mb-4">
        <div className="col-6 col-lg-3">
          <StatCard icon="bi-car-front" label="Araçlarım" value={vehicles.length} variant="primary" />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard icon="bi-p-circle" label="Şu an içeride" value={active.length} variant="teal" />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard icon="bi-calendar-check" label="Aktif rezervasyon" value={upcoming.length} variant="warning" />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard icon="bi-wallet2" label="Toplam ödeme" value={formatCurrency(totalSpent)} variant="success" />
        </div>
      </div>

      <div className="row g-4">
        {/* Araçlarım */}
        <div className="col-lg-5">
          <div className="card h-100">
            <div className="card-header">
              <i className="bi bi-car-front me-2 text-accent" />
              Araçlarım
            </div>
            <div className="card-body">
              <form onSubmit={onAdd} className="row g-2 mb-3" noValidate>
                <div className="col-sm-5">
                  <input
                    className={`form-control text-uppercase ${plateErr ? 'is-invalid' : ''}`}
                    placeholder="Plaka (34 ABC 123)"
                    value={plate}
                    maxLength={12}
                    onChange={(e) => setPlate(e.target.value)}
                    aria-label="Plaka"
                  />
                  <div className="invalid-feedback">{plateErr}</div>
                </div>
                <div className="col-sm-4">
                  <input
                    className="form-control"
                    placeholder="Takma ad (ör. Ailem)"
                    value={nickname}
                    maxLength={40}
                    onChange={(e) => setNickname(e.target.value)}
                    aria-label="Takma ad"
                  />
                </div>
                <div className="col-sm-3 d-grid">
                  <button type="submit" className="btn btn-primary" disabled={adding}>
                    {adding ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-plus-lg me-1" />}
                    Ekle
                  </button>
                </div>
              </form>

              {vehicles.length === 0 ? (
                <EmptyState icon="bi-car-front" title="Henüz araç eklemediniz">
                  Rezervasyon yapabilmek ve park geçmişinizi görmek için plakanızı ekleyin.
                </EmptyState>
              ) : (
                <ul className="list-group list-group-flush">
                  {vehicles.map((v) => {
                    const inside = active.find((s) => normalizePlate(s.plate) === normalizePlate(v.plate));
                    return (
                      <li key={v.id} className="list-group-item px-0 d-flex align-items-center gap-3">
                        <PlateBadge plate={v.plate} />
                        <div className="flex-grow-1 min-w-0">
                          <div className="fw-semibold text-truncate">{v.nickname || 'Araç'}</div>
                          {inside ? (
                            <span className="badge text-bg-primary">
                              <i className="bi bi-p-circle me-1" />
                              İçeride · {inside.lotName ? `${inside.lotName} · ` : ''}
                              {inside.zoneCode} bölgesi
                            </span>
                          ) : (
                            <span className="small text-secondary">Otopark dışında</span>
                          )}
                          {(() => {
                            const ps = vehiclePermitStatus(v);
                            if (!ps) return null;
                            const info = permitStatus(ps);
                            return (
                              <span
                                className={`badge ms-1 ${ps === 'Approved' ? 'badge-disabled' : `text-bg-${info.variant}`}`}
                                title="Engelli park izni durumu"
                              >
                                <span aria-hidden="true">♿</span> {info.label}
                              </span>
                            );
                          })()}
                        </div>
                        <Link to={`/aracim-nerede?plaka=${normalizePlate(v.plate)}`} className="btn btn-sm btn-light" title="Konum sorgula">
                          <i className="bi bi-geo-alt" />
                        </Link>
                        <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setToDelete(v)} title="Sil">
                          <i className="bi bi-trash" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Aktif oturumlar */}
        <div className="col-lg-7">
          <div className="card h-100">
            <div className="card-header d-flex justify-content-between align-items-center">
              <span>
                <i className="bi bi-p-circle me-2 text-accent" />
                Aktif Park Oturumlarım
              </span>
              <span className="badge text-bg-primary rounded-pill">{active.length}</span>
            </div>
            <div className="card-body">
              {active.length === 0 ? (
                <EmptyState icon="bi-p-circle" title="Şu anda otoparkta aracınız yok">
                  Aracınız giriş yaptığında burada süre ve güncel ücret görünecek.
                </EmptyState>
              ) : (
                <div className="d-flex flex-column gap-3">
                  {active.map((s) => {
                    const mins = s.durationMinutes ?? minutesSince(s.entryTime);
                    return (
                      <div key={s.id} className="border rounded-3 p-3 d-flex flex-wrap align-items-center gap-3">
                        <PlateBadge plate={s.plate} size="lg" />
                        <div className="flex-grow-1">
                          {s.lotName && <div className="small text-secondary fw-semibold">{s.lotName}</div>}
                          <div className="fw-semibold">
                            <i className="bi bi-geo-alt-fill text-accent me-1" />
                            {s.zoneCode ? `${s.zoneCode} Bölgesi` : 'Bölge belirtilmemiş'}
                            {s.isDisabledPermit && (
                              <span className="badge badge-disabled ms-2" title="Engelli izinli giriş">
                                <span aria-hidden="true">♿</span>
                              </span>
                            )}
                          </div>
                          <div className="small text-secondary">
                            Giriş: {formatDateTime(s.entryTime)} · {formatDuration(Math.max(mins, minutesSince(s.entryTime)))}
                          </div>
                        </div>
                        <div className="text-end">
                          <div className="small text-secondary">Güncel ücret</div>
                          <div className="fs-5 fw-bold">{formatCurrency(s.fee)}</div>
                          {s.isPaid ? (
                            <span className="badge text-bg-success">Ödendi</span>
                          ) : (
                            <Link to={`/ucret-ode?plaka=${normalizePlate(s.plate)}`} className="btn btn-sm btn-accent mt-1">
                              Öde
                            </Link>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {upcoming.length > 0 && (
                <div className="mt-4">
                  <div className="fw-semibold mb-2">
                    <i className="bi bi-calendar-check me-2 text-accent" />
                    Yaklaşan rezervasyonlar
                  </div>
                  <ul className="list-group">
                    {upcoming.map((r) => {
                      const st = reservationStatus(r.status);
                      return (
                        <li key={r.id} className="list-group-item d-flex flex-wrap align-items-center gap-2">
                          <PlateBadge plate={r.plate} size="sm" />
                          <span className="small">
                            {r.lotName ? `${r.lotName} · ` : ''}
                            {r.zoneName || r.zoneCode} · {formatDateTime(r.startTime)} – {formatDateTime(r.endTime)}
                          </span>
                          {r.slotType === 'Disabled' && (
                            <span className="badge badge-disabled" title="Engelli park yeri">
                              <span aria-hidden="true">♿</span>
                            </span>
                          )}
                          <span className={`badge text-bg-${st.variant} ms-auto`}>{st.label}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <Link to="/surucu/rezervasyon" className="small d-inline-block mt-2">
                    Tüm rezervasyonlarım →
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Engelli park izni */}
        <div className="col-12">
          <div className="card">
            <div className="card-header d-flex align-items-center justify-content-between">
              <span>
                <i className="bi bi-person-wheelchair me-2 text-accent" />
                Engelli Park İzni
              </span>
              <span className="small text-secondary fw-normal">Onaylı izinli araçlar ♿ engelli park yerlerini kullanabilir ve rezerve edebilir.</span>
            </div>
            <div className="card-body">
              <div className="row g-4">
                <div className="col-lg-5">
                  <h3 className="h6 fw-bold mb-3">Engelli izni başvurusu</h3>
                  {vehicles.length === 0 ? (
                    <div className="text-secondary small">Başvuru yapabilmek için önce aracınızı ekleyin.</div>
                  ) : (
                    <form onSubmit={onApplyPermit} noValidate>
                      <div className="mb-2">
                        <label htmlFor="pm-plate" className="form-label small fw-semibold">
                          Araç
                        </label>
                        <select
                          id="pm-plate"
                          className="form-select"
                          value={permitForm.plate}
                          onChange={(e) => setPermitForm((f) => ({ ...f, plate: e.target.value }))}
                        >
                          <option value="">Araç seçin…</option>
                          {vehicles.map((v) => {
                            const ps = vehiclePermitStatus(v);
                            return (
                              <option key={v.id} value={normalizePlate(v.plate)}>
                                {v.plate}
                                {v.nickname ? ` — ${v.nickname}` : ''}
                                {ps ? ` (${permitStatus(ps).label})` : ''}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      <div className="mb-2">
                        <label htmlFor="pm-holder" className="form-label small fw-semibold">
                          İzin sahibinin adı soyadı
                        </label>
                        <input
                          id="pm-holder"
                          className="form-control"
                          value={permitForm.holderName}
                          placeholder={user?.fullName || 'Ad Soyad'}
                          maxLength={100}
                          onChange={(e) => setPermitForm((f) => ({ ...f, holderName: e.target.value }))}
                        />
                      </div>
                      <div className="mb-3">
                        <label htmlFor="pm-doc" className="form-label small fw-semibold">
                          Belge no <span className="text-secondary fw-normal">(engelli kimlik kartı / sağlık kurulu raporu)</span>
                        </label>
                        <input
                          id="pm-doc"
                          className="form-control"
                          value={permitForm.documentNo}
                          maxLength={50}
                          onChange={(e) => setPermitForm((f) => ({ ...f, documentNo: e.target.value }))}
                        />
                      </div>
                      {permitErr && <div className="alert alert-danger py-2 small">{permitErr}</div>}
                      <button type="submit" className="btn btn-primary" disabled={applying}>
                        {applying ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-send me-2" />}
                        Başvur
                      </button>
                      <div className="form-text mt-2">
                        <i className="bi bi-shield-lock me-1" />
                        Belge bilgisi yalnızca izin doğrulaması için kullanılır (KVKK). Başvuru yönetici onayına düşer.
                      </div>
                    </form>
                  )}
                </div>
                <div className="col-lg-7">
                  <h3 className="h6 fw-bold mb-3">Başvurularım</h3>
                  {permits.length === 0 ? (
                    <EmptyState icon="bi-person-wheelchair" title="Henüz başvurunuz yok" className="py-3" />
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-sm align-middle">
                        <thead>
                          <tr>
                            <th>Plaka</th>
                            <th>İzin sahibi</th>
                            <th>Durum</th>
                            <th>Geçerlilik</th>
                            <th>Başvuru</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...permits]
                            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                            .map((p) => {
                              const st = permitStatus(p.status);
                              const expired = p.status === 'Approved' && !isPermitValid(p);
                              return (
                                <tr key={p.id}>
                                  <td>
                                    <PlateBadge plate={p.plate} size="sm" />
                                  </td>
                                  <td className="small">{p.holderName}</td>
                                  <td>
                                    <span className={`badge text-bg-${expired ? 'secondary' : st.variant}`}>
                                      <i className={`bi ${st.icon} me-1`} />
                                      {expired ? 'Süresi doldu' : st.label}
                                    </span>
                                    {p.note && (
                                      <div className="small text-secondary mt-1" title="Yönetici notu">
                                        <i className="bi bi-chat-left-text me-1" />
                                        {p.note}
                                      </div>
                                    )}
                                  </td>
                                  <td className="small text-nowrap">{p.status === 'Approved' ? (p.validUntil ? formatDate(p.validUntil) : 'Süresiz') : '—'}</td>
                                  <td className="small text-nowrap">{formatDate(p.createdAt)}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Geçmiş */}
        <div className="col-12">
          <div className="card">
            <div className="card-header">
              <i className="bi bi-clock-history me-2 text-accent" />
              Park Geçmişi
            </div>
            <div className="card-body p-0">
              {history.length === 0 ? (
                <EmptyState icon="bi-clock-history" title="Geçmiş kaydınız yok" />
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover">
                    <thead>
                      <tr>
                        <th>Plaka</th>
                        <th>Otopark</th>
                        <th>Bölge</th>
                        <th>Giriş</th>
                        <th>Çıkış</th>
                        <th>Süre</th>
                        <th className="text-end">Ücret</th>
                        <th className="text-end">Ödenen</th>
                        <th>Durum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((s) => {
                        const st = sessionStatus(s.status);
                        return (
                          <tr key={s.id}>
                            <td>
                              <PlateBadge plate={s.plate} size="sm" />
                            </td>
                            <td className="small">{s.lotName || s.lotCode || '—'}</td>
                            <td>
                              {s.zoneCode || '—'}
                              {s.isDisabledPermit && (
                                <span className="ms-1" title="Engelli izinli" aria-label="Engelli izinli">
                                  ♿
                                </span>
                              )}
                            </td>
                            <td className="text-nowrap">{formatDateTime(s.entryTime)}</td>
                            <td className="text-nowrap">{formatDateTime(s.exitTime)}</td>
                            <td className="text-nowrap">{formatDuration(s.durationMinutes)}</td>
                            <td className="text-end">{formatCurrency(s.fee)}</td>
                            <td className="text-end">{formatCurrency(s.paidAmount)}</td>
                            <td>
                              <span className={`badge text-bg-${st.variant}`}>{st.label}</span>
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
        </div>
      </div>

      <ConfirmModal
        show={!!toDelete}
        title="Aracı sil"
        icon="bi-trash"
        variant="danger"
        confirmText="Sil"
        busy={deleting}
        onConfirm={onDelete}
        onCancel={() => setToDelete(null)}
      >
        {toDelete && (
          <p className="mb-0">
            <PlateBadge plate={toDelete.plate} size="sm" /> plakalı aracı listenizden silmek istediğinize emin misiniz?
          </p>
        )}
      </ConfirmModal>
    </div>
  );
}
