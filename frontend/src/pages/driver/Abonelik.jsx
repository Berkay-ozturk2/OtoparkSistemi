import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useLot } from '../../lot/LotContext';
import { getMyVehicles } from '../../api/driver';
import { applySubscription, getMySubscriptions, getSubscriptionPlans, withdrawSubscription } from '../../api/subscriptions';
import PageHeader from '../../components/PageHeader';
import PlateBadge from '../../components/PlateBadge';
import ErrorAlert from '../../components/ErrorAlert';
import Loading from '../../components/Loading';
import { useToast } from '../../components/Toast';
import { addDays, daysUntil, formatCurrency, formatDate, planLabel, subscriptionStatus, toDateInput } from '../../utils/format';
import { formatPlate } from '../../utils/plate';

const MAX_START_DAYS = 60;

function addMonths(dateStr, months) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return d;
}

/** Telefon boş bırakılabilir; doluysa 05XX XXX XX XX biçiminde 11 hane olmalı. */
function phoneError(value) {
  const digits = (value || '').replace(/\D/g, '');
  if (!digits) return null;
  const local = digits.startsWith('90') && digits.length === 12 ? `0${digits.slice(2)}` : digits.startsWith('0') ? digits : `0${digits}`;
  if (local.length !== 11 || local[1] === '0') return 'Telefon numarasını 05XX XXX XX XX biçiminde, 11 hane olarak yazın.';
  return null;
}

function validate(form, { today, maxStart }) {
  const e = {};
  if (!form.plan) e.plan = 'Aylık ya da yıllık paketlerden birini seçin.';
  if (!form.plate) e.plate = 'Abone olacak aracı seçin.';
  if (!form.lotCode) e.lotCode = 'Abone olmak istediğiniz otoparkı seçin.';
  if (!form.startDate) e.startDate = 'Aboneliğin başlayacağı günü seçin.';
  else if (form.startDate < today) e.startDate = 'Başlangıç tarihi bugünden önce olamaz.';
  else if (form.startDate > maxStart) e.startDate = `Başlangıç en fazla ${MAX_START_DAYS} gün sonrası olabilir (${formatDate(maxStart)}).`;
  const name = form.holderName.trim();
  if (!name) e.holderName = 'Abonelik sahibinin adını ve soyadını yazın.';
  else if (name.length < 3 || !name.includes(' ')) e.holderName = 'Ad ve soyadı arada boşluk bırakarak yazın.';
  const ph = phoneError(form.phone);
  if (ph) e.phone = ph;
  return e;
}

const FIELD_ORDER = ['plan', 'plate', 'lotCode', 'startDate', 'holderName', 'phone'];

/** Sürücü: aylık / yıllık abonelik başvurusu ve başvuru geçmişi. */
export default function Abonelik() {
  const toast = useToast();
  const { user } = useAuth();
  const { lots, lotCode: ctxLot } = useLot();
  const uid = useId();
  const today = toDateInput(new Date());
  const maxStart = toDateInput(addDays(new Date(), MAX_START_DAYS));

  const [plans, setPlans] = useState([]);
  const [vehicles, setVehicles] = useState(null);
  const [mine, setMine] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState({ plan: '', plate: '', lotCode: '', startDate: today, holderName: user?.fullName || '', phone: '' });
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [withdrawing, setWithdrawing] = useState(null);
  const [justCreated, setJustCreated] = useState(null);
  const summaryRef = useRef(null);
  const historyRef = useRef(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [p, v, m] = await Promise.all([getSubscriptionPlans(), getMyVehicles(), getMySubscriptions()]);
      setPlans(Array.isArray(p) ? p : []);
      setVehicles(Array.isArray(v) ? v : []);
      setMine(Array.isArray(m) ? m : []);
      setForm((f) => ({ ...f, plate: f.plate || (v?.length === 1 ? v[0].plate : '') }));
    } catch (err) {
      setLoadError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setForm((f) => (f.lotCode ? f : { ...f, lotCode: ctxLot || '' }));
  }, [ctxLot]);

  const errors = useMemo(() => validate(form, { today, maxStart }), [form, today, maxStart]);
  const show = (k) => (submitted || touched[k]) && errors[k];
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setServerError(null);
  };
  const blur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));

  const plan = plans.find((p) => p.plan === form.plan);
  const lot = lots.find((l) => l.code === form.lotCode);
  const endDate = plan && form.startDate && !errors.startDate ? addMonths(form.startDate, plan.months) : null;
  const errorList = FIELD_ORDER.filter((k) => errors[k]);

  // Hatalı gönderimde odak, çizildikten sonra hata özetine taşınır (ekran okuyucu da okur)
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (attempt > 0) summaryRef.current?.focus();
  }, [attempt]);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (errorList.length) {
      setAttempt((n) => n + 1);
      return;
    }
    setBusy(true);
    setServerError(null);
    try {
      const created = await applySubscription({
        plate: form.plate,
        lotCode: form.lotCode,
        plan: form.plan,
        holderName: form.holderName.trim(),
        phone: form.phone.trim() || null,
        startDate: form.startDate,
      });
      toast.success('Başvurunuz alındı. Onaylanınca bu ekranda görürsünüz.');
      setJustCreated(created.id);
      setMine((m) => [created, ...m]);
      setForm((f) => ({ ...f, plan: '', startDate: today }));
      setTouched({});
      setSubmitted(false);
      setTimeout(() => historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (err) {
      setServerError(err);
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (s) => {
    setWithdrawing(s.id);
    try {
      const updated = await withdrawSubscription(s.id);
      setMine((m) => m.map((x) => (x.id === s.id ? updated : x)));
      toast.success('Başvurunuz geri çekildi.');
    } catch (err) {
      toast.error(err);
    } finally {
      setWithdrawing(null);
    }
  };

  const fieldClass = (k) => `form-control ${show(k) ? 'is-invalid' : ''}`;
  const selectClass = (k) => `form-select ${show(k) ? 'is-invalid' : ''}`;
  const desc = (k, help) => [help ? `${uid}-${k}-help` : null, show(k) ? `${uid}-${k}-err` : null].filter(Boolean).join(' ') || undefined;
  const Err = ({ k }) =>
    show(k) ? (
      <div id={`${uid}-${k}-err`} className="invalid-feedback d-block">
        <i className="bi bi-exclamation-circle me-1" aria-hidden="true" />
        {errors[k]}
      </div>
    ) : null;

  if (loadError) return <ErrorAlert error={loadError} onRetry={load} />;
  if (!vehicles) return <Loading />;

  return (
    <div>
      <PageHeader icon="bi-person-vcard" title="Abonelik" subtitle="Aynı otoparkı düzenli kullanıyorsanız aylık ya da yıllık paketle abone olun." />

      <div className="row g-4 align-items-start">
        <div className="col-lg-7 col-xl-8">
          <form className="card sub-form" onSubmit={submit} noValidate aria-labelledby={`${uid}-title`}>
            <div className="card-body p-3 p-md-4">
              <h2 id={`${uid}-title`} className="visually-hidden">
                Abonelik başvurusu
              </h2>

              {submitted && errorList.length > 0 && (
                <div ref={summaryRef} tabIndex={-1} className="form-summary" role="alert">
                  <strong>Başvuruyu göndermek için {errorList.length} alanı düzeltin:</strong>
                  <ul>
                    {errorList.map((k) => (
                      <li key={k}>
                        <a href={`#${uid}-${k}`} onClick={(e) => { e.preventDefault(); document.getElementById(`${uid}-${k}`)?.focus(); }}>
                          {errors[k]}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <ErrorAlert error={serverError} className="mb-3" title="Başvuru gönderilemedi" />

              {/* Paket */}
              <fieldset className="mb-4">
                <legend className="form-label fw-semibold fs-6">Paket</legend>
                <div className="plan-picker" role="radiogroup" aria-describedby={desc('plan')}>
                  {plans.map((p, i) => {
                    const checked = form.plan === p.plan;
                    return (
                      <label key={p.plan} className={`plan-option ${checked ? 'is-checked' : ''} ${show('plan') ? 'is-invalid' : ''}`}>
                        <input
                          id={i === 0 ? `${uid}-plan` : undefined}
                          type="radio"
                          name="plan"
                          value={p.plan}
                          checked={checked}
                          onChange={set('plan')}
                          onBlur={blur('plan')}
                          className="visually-hidden"
                        />
                        <span className="plan-option-check" aria-hidden="true">
                          <i aria-hidden="true" className="bi bi-check-lg" />
                        </span>
                        <span className="plan-option-name">{p.name}</span>
                        <span className="plan-option-price">{formatCurrency(p.price)}</span>
                        <span className="plan-option-per">{p.months === 1 ? 'her ay' : `${p.months} ay için tek ödeme`}</span>
                        {p.savingPercent > 0 ? (
                          <span className="plan-option-note">
                            Ayda {formatCurrency(p.monthlyEquivalent)}, aylığa göre %{p.savingPercent} daha az
                          </span>
                        ) : (
                          <span className="plan-option-note">Başlangıç gününden itibaren 1 ay geçerli</span>
                        )}
                      </label>
                    );
                  })}
                </div>
                <Err k="plan" />
              </fieldset>

              <div className="row g-3">
                {/* Araç */}
                <div className="col-md-6">
                  <label htmlFor={`${uid}-plate`} className="form-label fw-semibold">
                    Araç
                  </label>
                  {vehicles.length === 0 ? (
                    <div className="field-note" id={`${uid}-plate`} tabIndex={-1}>
                      Hesabınızda kayıtlı araç yok. Önce <Link to="/surucu">Panelim</Link> ekranından aracınızı ekleyin.
                    </div>
                  ) : (
                    <select id={`${uid}-plate`} className={selectClass('plate')} value={form.plate} onChange={set('plate')} onBlur={blur('plate')} aria-invalid={!!show('plate')} aria-describedby={desc('plate', true)}>
                      <option value="">Araç seçin</option>
                      {vehicles.map((v) => (
                        <option key={v.id} value={v.plate}>
                          {formatPlate(v.plate)}
                          {v.nickname ? ` (${v.nickname})` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {vehicles.length > 0 && (
                    <div id={`${uid}-plate-help`} className="form-text">
                      Listede olmayan araç için önce <Link to="/surucu">Panelim</Link> ekranından ekleyin.
                    </div>
                  )}
                  <Err k="plate" />
                </div>

                {/* Otopark */}
                <div className="col-md-6">
                  <label htmlFor={`${uid}-lotCode`} className="form-label fw-semibold">
                    Otopark
                  </label>
                  <select id={`${uid}-lotCode`} className={selectClass('lotCode')} value={form.lotCode} onChange={set('lotCode')} onBlur={blur('lotCode')} aria-invalid={!!show('lotCode')} aria-describedby={desc('lotCode')}>
                    <option value="">Otopark seçin</option>
                    {lots.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  <Err k="lotCode" />
                </div>

                {/* Başlangıç */}
                <div className="col-md-6">
                  <label htmlFor={`${uid}-startDate`} className="form-label fw-semibold">
                    Başlangıç tarihi
                  </label>
                  <input
                    id={`${uid}-startDate`}
                    type="date"
                    className={fieldClass('startDate')}
                    min={today}
                    max={maxStart}
                    value={form.startDate}
                    onChange={set('startDate')}
                    onBlur={blur('startDate')}
                    aria-invalid={!!show('startDate')}
                    aria-describedby={desc('startDate', true)}
                  />
                  <div id={`${uid}-startDate-help`} className="form-text">
                    Onay bu tarihten sonra gelirse abonelik onay günü başlar.
                  </div>
                  <Err k="startDate" />
                </div>

                {/* Ad soyad */}
                <div className="col-md-6">
                  <label htmlFor={`${uid}-holderName`} className="form-label fw-semibold">
                    Ad soyad
                  </label>
                  <input
                    id={`${uid}-holderName`}
                    type="text"
                    autoComplete="name"
                    maxLength={100}
                    className={fieldClass('holderName')}
                    value={form.holderName}
                    onChange={set('holderName')}
                    onBlur={blur('holderName')}
                    aria-invalid={!!show('holderName')}
                    aria-describedby={desc('holderName')}
                  />
                  <Err k="holderName" />
                </div>

                {/* Telefon */}
                <div className="col-md-6">
                  <label htmlFor={`${uid}-phone`} className="form-label fw-semibold">
                    Telefon <span className="fw-normal text-secondary">(isteğe bağlı)</span>
                  </label>
                  <input
                    id={`${uid}-phone`}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="05XX XXX XX XX"
                    className={fieldClass('phone')}
                    value={form.phone}
                    onChange={set('phone')}
                    onBlur={blur('phone')}
                    aria-invalid={!!show('phone')}
                    aria-describedby={desc('phone', true)}
                  />
                  <div id={`${uid}-phone-help`} className="form-text">
                    Başvurunuzla ilgili size ulaşmak için kullanılır.
                  </div>
                  <Err k="phone" />
                </div>
              </div>
            </div>

            <div className="sub-form-foot">
              <p className="mb-0 small text-secondary">Başvurunuzu otopark yönetimi değerlendirir; sonucu bu ekranda görürsünüz.</p>
              <button type="submit" className="btn btn-accent btn-lg" disabled={busy || vehicles.length === 0}>
                {busy ? <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> : <i className="bi bi-send me-2" aria-hidden="true" />}
                Başvuruyu gönder
              </button>
            </div>
          </form>
        </div>

        {/* Özet */}
        <aside className="col-lg-5 col-xl-4">
          <div className="card sub-summary-card" aria-live="polite">
            <div className="card-body">
              <h2 className="h6 mb-3">Başvuru özeti</h2>
              <dl className="sub-receipt">
                <div>
                  <dt>Paket</dt>
                  <dd>{plan ? plan.name : <span className="text-secondary">seçilmedi</span>}</dd>
                </div>
                <div>
                  <dt>Araç</dt>
                  <dd>{form.plate ? <PlateBadge plate={form.plate} size="sm" /> : <span className="text-secondary">seçilmedi</span>}</dd>
                </div>
                <div>
                  <dt>Otopark</dt>
                  <dd>{lot ? lot.name : <span className="text-secondary">seçilmedi</span>}</dd>
                </div>
                <div>
                  <dt>Geçerlilik</dt>
                  <dd>
                    {endDate ? (
                      <>
                        {formatDate(form.startDate)} – {formatDate(endDate)}
                      </>
                    ) : (
                      <span className="text-secondary">paket ve tarih seçin</span>
                    )}
                  </dd>
                </div>
              </dl>
              <div className="sub-total">
                <span>Paket ücreti</span>
                <strong>{plan ? formatCurrency(plan.price) : '—'}</strong>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Başvurularım */}
      <section ref={historyRef} className="mt-4" aria-labelledby={`${uid}-hist`}>
        <h2 id={`${uid}-hist`} className="h5 mb-3">
          Başvurularım ve aboneliklerim
        </h2>
        {mine.length === 0 ? (
          <p className="text-secondary">Henüz başvurunuz yok. Yukarıdaki formla ilk başvurunuzu yapabilirsiniz.</p>
        ) : (
          <ul className="my-subs">
            {mine.map((s) => {
              const st = subscriptionStatus(s);
              const left = s.status === 'Active' && s.isCurrent ? daysUntil(s.endDate) : null;
              return (
                <li key={s.id} className={`my-sub my-sub-${st.variant} ${justCreated === s.id ? 'is-new' : ''}`}>
                  <div className="my-sub-main">
                    <PlateBadge plate={s.plate} size="sm" />
                    <div className="min-w-0">
                      <div className="fw-semibold">
                        {planLabel(s.plan)} abonelik, {s.lotName}
                      </div>
                      <div className="small text-secondary">
                        {s.endDate ? `${formatDate(s.startDate)} – ${formatDate(s.endDate)}` : `${formatDate(s.startDate)} başlangıç istendi`}
                        {left != null && `, ${left} gün kaldı`}
                      </div>
                      {s.status === 'Rejected' && s.note && (
                        <div className="my-sub-note">
                          <i className="bi bi-chat-left-text me-1" aria-hidden="true" />
                          {s.note}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="my-sub-side">
                    <span className={`badge rounded-pill text-bg-${st.variant}`}>
                      <i className={`bi ${st.icon} me-1`} aria-hidden="true" />
                      {st.label}
                    </span>
                    {s.status === 'Pending' && (
                      <button type="button" className="btn btn-sm btn-light" onClick={() => withdraw(s)} disabled={withdrawing === s.id}>
                        {withdrawing === s.id && <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />}
                        Başvuruyu geri çek
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
