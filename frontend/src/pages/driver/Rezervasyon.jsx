import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  cancelReservation,
  createReservation,
  getMyPermits,
  getMyReservations,
  getMyVehicles,
  quoteReservation,
} from '../../api/driver';
import { getZones } from '../../api/parking';
import { pay } from '../../api/payments';
import PageHeader from '../../components/PageHeader';
import PlateBadge from '../../components/PlateBadge';
import Loading from '../../components/Loading';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import ConfirmModal from '../../components/ConfirmModal';
import Modal from '../../components/Modal';
import CardPaymentForm from '../../components/CardPaymentForm';
import LotSelector from '../../components/LotSelector';
import { useLot } from '../../lot/LotContext';
import { useToast } from '../../components/Toast';
import { normalizePlate } from '../../utils/plate';
import {
  formatCurrency,
  formatDateTime,
  formatDuration,
  fromDateTimeInput,
  isPermitValid,
  nextRoundHour,
  reservationStatus,
  toDateTimeInput,
} from '../../utils/format';

/** UC-04: Çevrimiçi yer rezerve et */
export default function Rezervasyon() {
  const toast = useToast();
  const { lotCode: ctxLot, setLotCode: setCtxLot, lotName, lots } = useLot();
  const [resLot, setResLot] = useState(ctxLot);
  const isSiteDemo = lots.some((lot) => lot.code === resLot && lot.siteReference);
  const [slotType, setSlotType] = useState('Standard');
  const [permits, setPermits] = useState([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [zones, setZones] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [zoneCode, setZoneCode] = useState('');
  const [plate, setPlate] = useState('');
  const [start, setStart] = useState(toDateTimeInput(nextRoundHour(1)));
  const [end, setEnd] = useState(toDateTimeInput(nextRoundHour(3)));

  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [creating, setCreating] = useState(false);

  const [payFor, setPayFor] = useState(null); // ödeme adımındaki rezervasyon
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState(null);
  const [paidResult, setPaidResult] = useState(null);

  const [toCancel, setToCancel] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [v, r, p] = await Promise.all([getMyVehicles(), getMyReservations(), getMyPermits().catch(() => [])]);
      const vl = Array.isArray(v) ? v : [];
      setVehicles(vl);
      setReservations(Array.isArray(r) ? r : []);
      setPermits(Array.isArray(p) ? p : []);
      setPlate((cur) => cur || vl[0]?.plate || '');
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Seçilen otoparkın bölgeleri
  useEffect(() => {
    let cancelled = false;
    setZonesLoading(true);
    getZones(resLot)
      .then((z) => {
        if (cancelled) return;
        const zl = Array.isArray(z) ? z : [];
        setZones(zl);
        setZoneCode((cur) => (zl.some((x) => x.code === cur) ? cur : zl[0]?.code || ''));
      })
      .catch((err) => !cancelled && setError(err))
      .finally(() => !cancelled && setZonesLoading(false));
    return () => {
      cancelled = true;
    };
  }, [resLot]);

  const onLotChange = (code) => {
    setResLot(code);
    setCtxLot(code); // genel seçili otoparkı da güncelle
    setZoneCode('');
  };

  // Seçilen plakanın geçerli (onaylı, süresi dolmamış) engelli izni var mı?
  const selectedVehicle = vehicles.find((v) => normalizePlate(v.plate) === normalizePlate(plate));
  const platePermits = permits.filter((p) => normalizePlate(p.plate) === normalizePlate(plate));
  const hasPermit = platePermits.length
    ? platePermits.some((p) => isPermitValid(p))
    : selectedVehicle?.disabledPermitStatus === 'Approved';
  const pendingPermit = platePermits.some((p) => p.status === 'Pending') || selectedVehicle?.disabledPermitStatus === 'Pending';

  useEffect(() => {
    if (!hasPermit && slotType === 'Disabled') setSlotType('Standard');
  }, [hasPermit, slotType]);

  const selectedZone = zones.find((z) => z.code === zoneCode);

  const startIso = fromDateTimeInput(start);
  const endIso = fromDateTimeInput(end);
  const durationMin = startIso && endIso ? (new Date(endIso) - new Date(startIso)) / 60000 : 0;

  const formError = useMemo(() => {
    if (!zoneCode) return 'Bölge seçiniz.';
    if (slotType === 'Disabled' && !hasPermit) return 'Engelli park yeri için onaylı engelli izni gerekir.';
    if (slotType === 'Disabled' && selectedZone && !(selectedZone.disabledTotal > 0)) return 'Seçilen bölgede engelli park yeri yok.';
    if (!startIso || !endIso) return 'Başlangıç ve bitiş zamanını giriniz.';
    if (new Date(startIso) < new Date(Date.now() - 5 * 60000)) return 'Başlangıç zamanı geçmişte olamaz.';
    if (durationMin <= 0) return 'Bitiş zamanı başlangıçtan sonra olmalıdır.';
    if (durationMin < 30) return 'Rezervasyon en az 30 dakika olmalıdır.';
    if (durationMin > 24 * 60) return 'Rezervasyon en fazla 24 saat olabilir.';
    return null;
  }, [zoneCode, startIso, endIso, durationMin, slotType, hasPermit, selectedZone]);

  // Fiyat teklifi: form değiştikçe (kısa gecikmeyle) otomatik alınır
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (formError) return undefined;
    let cancelled = false;
    const t = setTimeout(async () => {
      setQuoting(true);
      try {
        const q = await quoteReservation({ lotCode: resLot, zoneCode, slotType, startTime: startIso, endTime: endIso });
        if (!cancelled) setQuote(q);
      } catch (err) {
        if (!cancelled) setQuoteError(err);
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [resLot, zoneCode, slotType, startIso, endIso, formError]);

  const onCreate = async (e) => {
    e.preventDefault();
    if (formError || !quote?.available) return;
    const p = normalizePlate(plate);
    if (!p) {
      toast.warning('Önce panelinizden bir araç ekleyin.');
      return;
    }
    setCreating(true);
    try {
      const r = await createReservation({ plate: p, lotCode: resLot, zoneCode, slotType, startTime: startIso, endTime: endIso });
      setReservations((list) => [r, ...list]);
      setPaidResult(null);
      setPayError(null);
      setPayFor(r);
      toast.info('Rezervasyon oluşturuldu. Onaylanması için ön ödemeyi tamamlayın.');
    } catch (err) {
      toast.error(err);
    } finally {
      setCreating(false);
    }
  };

  const onPay = async (card) => {
    setPaying(true);
    setPayError(null);
    try {
      const res = await pay({ sessionId: null, reservationId: payFor.id, card });
      if (res?.status === 'Success') {
        setPaidResult(res);
        toast.success('Ödeme başarılı, rezervasyonunuz onaylandı.');
        const r = await getMyReservations().catch(() => null);
        if (Array.isArray(r)) setReservations(r);
      } else {
        setPayError(res?.message || 'Ödeme başarısız oldu.');
      }
    } catch (err) {
      setPayError(err);
    } finally {
      setPaying(false);
    }
  };

  const onCancel = async () => {
    setCancelling(true);
    try {
      await cancelReservation(toCancel.id);
      setReservations((list) => list.map((r) => (r.id === toCancel.id ? { ...r, status: 'Cancelled' } : r)));
      toast.success('Rezervasyon iptal edildi.');
      setToCancel(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setCancelling(false);
    }
  };

  const sorted = [...reservations].sort((a, b) => new Date(b.createdAt || b.startTime) - new Date(a.createdAt || a.startTime));

  if (loading) return <Loading text="Rezervasyon bilgileri yükleniyor…" />;

  return (
    <div>
      <PageHeader
        icon="bi-calendar-check"
        title="Yer Rezervasyonu"
        subtitle="Otopark, bölge ve zaman aralığı seçin, fiyat teklifini görün, ön ödemeyle yerinizi garantileyin."
      />

      <ErrorAlert error={error} onRetry={load} className="mb-4" />

      <div className="row g-4">
        <div className="col-lg-5">
          <div className="card">
            <div className="card-header">
              <i className="bi bi-calendar-plus me-2 text-accent" />
              Yeni Rezervasyon
            </div>
            <div className="card-body">
              {vehicles.length === 0 && (
                <div className="alert alert-warning small">
                  <i className="bi bi-exclamation-triangle me-1" />
                  Rezervasyon için önce <Link to="/surucu">panelinizden</Link> bir araç eklemelisiniz.
                </div>
              )}
              <form onSubmit={onCreate} noValidate>
                <div className="mb-3">
                  <label className="form-label fw-semibold d-block">Otopark</label>
                  <LotSelector value={resLot} onChange={onLotChange} size="" align="start" className="w-100" />
                  {isSiteDemo && <div className="form-text">Bu sahadaki rezervasyon yalnızca AkıllıPark demosunda geçerlidir.</div>}
                </div>

                <div className="mb-3">
                  <label className="form-label fw-semibold" htmlFor="rz-plate">
                    Araç
                  </label>
                  <select id="rz-plate" className="form-select" value={plate} onChange={(e) => setPlate(e.target.value)} disabled={vehicles.length === 0}>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.plate}>
                        {v.plate}
                        {v.nickname ? ` — ${v.nickname}` : ''}
                        {v.disabledPermitStatus === 'Approved' ? ' ♿' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Engelli park yeri seçeneği (yalnız onaylı izinli plakalar) */}
                <div className={`border rounded-3 p-3 mb-3 ${slotType === 'Disabled' ? 'border-primary bg-primary-subtle' : ''}`}>
                  <div className="form-check form-switch mb-0">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      role="switch"
                      id="rz-disabled"
                      checked={slotType === 'Disabled'}
                      disabled={!hasPermit}
                      onChange={(e) => setSlotType(e.target.checked ? 'Disabled' : 'Standard')}
                    />
                    <label className="form-check-label fw-semibold" htmlFor="rz-disabled">
                      <span aria-hidden="true">♿</span> Engelli park yeri
                    </label>
                  </div>
                  {hasPermit ? (
                    <div className="small text-secondary mt-1">
                      Bu araç için onaylı engelli izniniz var. Girişe yakın, geniş engelli cebi rezerve edebilirsiniz.
                    </div>
                  ) : (
                    <div className="small text-secondary mt-1">
                      <i className="bi bi-info-circle me-1" />
                      Engelli park yerleri yalnızca <strong>onaylı engelli izni</strong> olan araçlar içindir.
                      {pendingPermit ? (
                        <> Bu plaka için başvurunuz yönetici onayı bekliyor.</>
                      ) : (
                        <>
                          {' '}
                          İzin için <Link to="/surucu">panelinizden</Link> başvurabilirsiniz.
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="mb-3">
                  <label className="form-label fw-semibold">Bölge</label>
                  <div className="d-flex flex-column gap-2">
                    {zonesLoading && zones.length === 0 && <Loading inline text="Bölgeler yükleniyor…" />}
                    {zones.map((z) => {
                      const noDisabled = slotType === 'Disabled' && !(z.disabledTotal > 0);
                      return (
                        <label
                          key={z.code}
                          className={`border rounded-3 p-2 px-3 d-flex align-items-center gap-3 ${zoneCode === z.code ? 'border-2 border-info bg-accent-soft' : ''} ${noDisabled ? 'opacity-50' : ''}`}
                          style={{ cursor: noDisabled ? 'not-allowed' : 'pointer' }}
                        >
                          <input
                            type="radio"
                            className="form-check-input mt-0"
                            name="zone"
                            value={z.code}
                            checked={zoneCode === z.code}
                            disabled={noDisabled}
                            onChange={() => setZoneCode(z.code)}
                          />
                          <span className="badge text-bg-primary fs-6">{z.code}</span>
                          <span className="flex-grow-1 min-w-0">
                            <span className="d-block fw-semibold">{z.name}</span>
                            <span className="d-block small text-secondary">Kat {z.floor}</span>
                          </span>
                          <span className="small text-nowrap text-end">
                            {slotType === 'Disabled' ? (
                              <>
                                <span aria-hidden="true">♿</span> <strong>{z.disabledFree ?? 0}</strong>/{z.disabledTotal ?? 0} boş
                              </>
                            ) : (
                              <>
                                <strong>{z.freeSlots}</strong>/{z.totalSlots} boş
                                {z.disabledTotal > 0 && (
                                  <span className="d-block text-secondary">
                                    <span aria-hidden="true">♿</span> {z.disabledFree ?? 0}/{z.disabledTotal}
                                  </span>
                                )}
                              </>
                            )}
                          </span>
                        </label>
                      );
                    })}
                    {!zonesLoading && zones.length === 0 && <div className="text-secondary small">Bölge bilgisi alınamadı.</div>}
                  </div>
                </div>

                <div className="row g-2 mb-3">
                  <div className="col-sm-6">
                    <label className="form-label fw-semibold" htmlFor="rz-start">
                      Başlangıç
                    </label>
                    <input id="rz-start" type="datetime-local" className="form-control" value={start} min={toDateTimeInput(new Date())} onChange={(e) => setStart(e.target.value)} />
                  </div>
                  <div className="col-sm-6">
                    <label className="form-label fw-semibold" htmlFor="rz-end">
                      Bitiş
                    </label>
                    <input id="rz-end" type="datetime-local" className="form-control" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
                  </div>
                  {!formError && <div className="col-12 small text-secondary">Süre: {formatDuration(durationMin)}</div>}
                </div>

                {/* Fiyat teklifi */}
                <div className="border rounded-3 p-3 mb-3 bg-light">
                  {formError ? (
                    <div className="text-danger small">
                      <i className="bi bi-exclamation-circle me-1" />
                      {formError}
                    </div>
                  ) : quoting ? (
                    <Loading inline text="Fiyat hesaplanıyor…" />
                  ) : quoteError ? (
                    <div className="text-danger small">{quoteError.message}</div>
                  ) : quote ? (
                    <div className="d-flex align-items-center justify-content-between gap-2">
                      <div>
                        <div className={`small fw-semibold ${quote.available ? 'text-success' : 'text-danger'}`}>
                          <i className={`bi ${quote.available ? 'bi-check-circle' : 'bi-x-circle'} me-1`} />
                          {quote.available ? 'Bu aralıkta yer müsait' : 'Bu aralıkta yer yok'}
                        </div>
                        {quote.message && <div className="small text-secondary">{quote.message}</div>}
                      </div>
                      <div className="fs-3 fw-bold text-primary text-nowrap">{formatCurrency(quote.amount)}</div>
                    </div>
                  ) : (
                    <div className="small text-secondary">Fiyat teklifi bekleniyor…</div>
                  )}
                </div>

                <button
                  type="submit"
                  className="btn btn-accent btn-lg w-100"
                  disabled={!!formError || !quote?.available || creating || vehicles.length === 0}
                >
                  {creating ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-arrow-right-circle me-2" />}
                  Rezervasyon Oluştur ve Öde
                </button>
                <div className="small text-secondary mt-2">
                  <i className="bi bi-info-circle me-1" />
                  Ön ödenen tutar, çıkışta park ücretinizden düşülür.
                </div>
              </form>
            </div>
          </div>
        </div>

        <div className="col-lg-7">
          <div className="card">
            <div className="card-header d-flex justify-content-between align-items-center">
              <span>
                <i className="bi bi-list-check me-2 text-accent" />
                Rezervasyonlarım
              </span>
              <button type="button" className="btn btn-sm btn-light" onClick={load} title="Yenile">
                <i className="bi bi-arrow-clockwise" />
              </button>
            </div>
            <div className="card-body p-0">
              {sorted.length === 0 ? (
                <EmptyState icon="bi-calendar-x" title="Henüz rezervasyonunuz yok">
                  Soldaki formdan ilk rezervasyonunuzu oluşturabilirsiniz.
                </EmptyState>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Plaka</th>
                        <th>Otopark / Bölge</th>
                        <th>Zaman</th>
                        <th className="text-end">Tutar</th>
                        <th>Durum</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((r) => {
                        const st = reservationStatus(r.status);
                        const cancellable = r.status === 'PendingPayment' || r.status === 'Confirmed';
                        return (
                          <tr key={r.id}>
                            <td className="text-secondary">{r.id}</td>
                            <td>
                              <PlateBadge plate={r.plate} size="sm" />
                            </td>
                            <td>
                              {(r.lotName || r.lotCode) && <div className="small text-secondary">{r.lotName || lotName(r.lotCode)}</div>}
                              <span className="badge text-bg-primary me-1">{r.zoneCode}</span>
                              {r.slotType === 'Disabled' && (
                                <span className="badge badge-disabled me-1" title="Engelli park yeri">
                                  <span aria-hidden="true">♿</span>
                                </span>
                              )}
                              <span className="small d-none d-xl-inline">{r.zoneName}</span>
                            </td>
                            <td className="small text-nowrap">
                              {formatDateTime(r.startTime)}
                              <br />
                              {formatDateTime(r.endTime)}
                            </td>
                            <td className="text-end fw-semibold">{formatCurrency(r.amount)}</td>
                            <td>
                              <span className={`badge text-bg-${st.variant}`}>{st.label}</span>
                            </td>
                            <td className="text-end text-nowrap">
                              {r.status === 'PendingPayment' && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-accent me-1"
                                  onClick={() => {
                                    setPaidResult(null);
                                    setPayError(null);
                                    setPayFor(r);
                                  }}
                                >
                                  Öde
                                </button>
                              )}
                              {cancellable && (
                                <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setToCancel(r)}>
                                  İptal
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
          </div>
        </div>
      </div>

      {/* Ödeme adımı */}
      <Modal
        show={!!payFor}
        title={paidResult ? 'Rezervasyon onaylandı' : 'Rezervasyon ön ödemesi'}
        icon={paidResult ? 'bi-check-circle' : 'bi-credit-card'}
        onClose={paying ? undefined : () => setPayFor(null)}
        staticBackdrop={paying}
        size="lg"
      >
        {payFor && !paidResult && (
          <div className="row g-4">
            <div className="col-md-5">
              <div className="border rounded-3 p-3 h-100">
                <div className="text-center mb-3">
                  <PlateBadge plate={payFor.plate} size="lg" />
                </div>
                <div className="small text-secondary">Bölge</div>
                <div className="fw-semibold mb-2">{payFor.zoneName || payFor.zoneCode}</div>
                <div className="small text-secondary">Zaman aralığı</div>
                <div className="fw-semibold mb-2">
                  {formatDateTime(payFor.startTime)} – {formatDateTime(payFor.endTime)}
                </div>
                <hr />
                <div className="d-flex justify-content-between align-items-center">
                  <span>Tutar</span>
                  <span className="fs-4 fw-bold text-primary">{formatCurrency(payFor.amount)}</span>
                </div>
              </div>
            </div>
            <div className="col-md-7">
              <ErrorAlert error={payError} title="Ödeme başarısız" className="mb-3" onClose={() => setPayError(null)} />
              <CardPaymentForm amount={payFor.amount} onPay={onPay} busy={paying} />
            </div>
          </div>
        )}
        {paidResult && (
          <div className="text-center py-3">
            <i className="bi bi-check-circle-fill display-3 text-success" />
            <h3 className="h5 mt-3">Yeriniz ayrıldı!</h3>
            <p className="text-secondary">
              {paidResult.message || 'Rezervasyonunuz onaylandı. Girişte plakanız tanınarak bariyer otomatik açılacaktır.'}
            </p>
            <div className="receipt d-inline-block text-start">
              <div>
                Tutar: <strong>{formatCurrency(paidResult.amount)}</strong>
              </div>
              <div>Ödeme no: #{paidResult.paymentId}</div>
              {paidResult.transactionId && (
                <div>
                  İşlem kodu: <code>{paidResult.transactionId}</code>
                </div>
              )}
            </div>
            <div className="mt-4">
              <button type="button" className="btn btn-primary" onClick={() => setPayFor(null)}>
                Tamam
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal
        show={!!toCancel}
        title="Rezervasyonu iptal et"
        icon="bi-x-circle"
        variant="danger"
        confirmText="İptal Et"
        cancelText="Vazgeç"
        busy={cancelling}
        onConfirm={onCancel}
        onCancel={() => setToCancel(null)}
      >
        {toCancel && (
          <p className="mb-0">
            #{toCancel.id} numaralı ({toCancel.zoneCode} bölgesi, {formatDateTime(toCancel.startTime)}) rezervasyonu iptal
            etmek istediğinize emin misiniz?
            {toCancel.status === 'Confirmed' && ' İade koşulları işletme politikasına bağlıdır.'}
          </p>
        )}
      </ConfirmModal>
    </div>
  );
}
