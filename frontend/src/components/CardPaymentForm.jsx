import { useState } from 'react';
import { formatCurrency } from '../utils/format';

// Mock / iyzico sandbox test kartları (sözleşme bölüm 4)
export const TEST_CARDS = [
  { number: '5528790000000008', label: 'Mastercard — başarılı', ok: true },
  { number: '4766620000000001', label: 'Visa — başarılı', ok: true },
  { number: '4111111111111129', label: 'Visa — "Yetersiz bakiye" ile başarısız', ok: false },
];

export function luhnValid(num) {
  const digits = String(num).replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const groupCard = (v) =>
  v
    .replace(/\D/g, '')
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ');

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 12 }, (_, i) => String(THIS_YEAR + i));

/**
 * Sanal POS kart formu. Kart bilgisi yalnızca ödeme isteğinde gönderilir; tarayıcıda saklanmaz.
 *  amount    : ödenecek tutar
 *  onPay     : async (card) => void
 *  busy      : bool
 */
export default function CardPaymentForm({ amount, onPay, busy = false, submitLabel, showTestCards = true }) {
  const [holderName, setHolderName] = useState('');
  const [number, setNumber] = useState('');
  const [expireMonth, setExpireMonth] = useState('12');
  const [expireYear, setExpireYear] = useState(String(THIS_YEAR + 4));
  const [cvc, setCvc] = useState('');
  const [touched, setTouched] = useState(false);

  const raw = number.replace(/\D/g, '');
  const errors = {
    holderName: holderName.trim().length < 3 ? 'Kart üzerindeki adı girin.' : null,
    number: !luhnValid(raw) ? 'Geçerli bir kart numarası girin.' : null,
    cvc: !/^\d{3,4}$/.test(cvc) ? 'CVC 3 veya 4 haneli olmalıdır.' : null,
    expire:
      Number(expireYear) === THIS_YEAR && Number(expireMonth) < new Date().getMonth() + 1
        ? 'Kartın son kullanma tarihi geçmiş.'
        : null,
  };
  const hasError = Object.values(errors).some(Boolean);

  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (hasError || busy) return;
    onPay({
      holderName: holderName.trim(),
      number: raw,
      expireMonth,
      expireYear,
      cvc,
    });
  };

  const fillTest = (card) => {
    setNumber(groupCard(card.number));
    if (!holderName) setHolderName('Test Kullanıcı');
    setCvc('123');
    setExpireMonth('12');
    setExpireYear(YEARS.includes('2030') ? '2030' : YEARS[YEARS.length - 1]);
  };

  const invalid = (key) => (touched && errors[key] ? 'is-invalid' : '');

  return (
    <form onSubmit={submit} noValidate className="card-payment-form">
      <div className="credit-card-preview mb-3" aria-hidden="true">
        <div className="d-flex justify-content-between align-items-start">
          <i aria-hidden="true" className="bi bi-cpu fs-3" />
          <span className="fw-semibold small">AkıllıPark Sanal POS</span>
        </div>
        <div className="cc-number">{number || '•••• •••• •••• ••••'}</div>
        <div className="d-flex justify-content-between small text-uppercase">
          <span className="text-truncate me-2">{holderName || 'AD SOYAD'}</span>
          <span>
            {expireMonth}/{expireYear.slice(-2)}
          </span>
        </div>
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="cc-name">
          Kart üzerindeki ad soyad
        </label>
        <input
          id="cc-name"
          className={`form-control ${invalid('holderName')}`}
          autoComplete="cc-name"
          value={holderName}
          onChange={(e) => setHolderName(e.target.value)}
          maxLength={60}
        />
        <div className="invalid-feedback">{errors.holderName}</div>
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="cc-number">
          Kart numarası
        </label>
        <div className="input-group has-validation">
          <span className="input-group-text">
            <i aria-hidden="true" className="bi bi-credit-card" />
          </span>
          <input
            id="cc-number"
            className={`form-control font-monospace ${invalid('number')}`}
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="0000 0000 0000 0000"
            value={number}
            onChange={(e) => setNumber(groupCard(e.target.value))}
          />
          <div className="invalid-feedback">{errors.number}</div>
        </div>
      </div>

      <div className="row g-2 mb-3">
        <div className="col-4">
          <label className="form-label" htmlFor="cc-month">
            Ay
          </label>
          <select id="cc-month" className={`form-select ${invalid('expire')}`} value={expireMonth} onChange={(e) => setExpireMonth(e.target.value)}>
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="col-4">
          <label className="form-label" htmlFor="cc-year">
            Yıl
          </label>
          <select id="cc-year" className={`form-select ${invalid('expire')}`} value={expireYear} onChange={(e) => setExpireYear(e.target.value)}>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="col-4">
          <label className="form-label" htmlFor="cc-cvc">
            CVC
          </label>
          <input
            id="cc-cvc"
            className={`form-control ${invalid('cvc')}`}
            inputMode="numeric"
            autoComplete="cc-csc"
            maxLength={4}
            value={cvc}
            onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
        </div>
        {touched && (errors.expire || errors.cvc) && (
          <div className="col-12 text-danger small">{errors.expire || errors.cvc}</div>
        )}
      </div>

      <button type="submit" className="btn btn-accent btn-lg w-100" disabled={busy}>
        {busy ? (
          <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
        ) : (
          <i aria-hidden="true" className="bi bi-lock-fill me-2" />
        )}
        {submitLabel || `${formatCurrency(amount)} Öde`}
      </button>
      <div className="text-secondary small mt-2 text-center">
        <i aria-hidden="true" className="bi bi-shield-check me-1" />
        Kart bilgileriniz saklanmaz; yalnızca ödeme kuruluşuna iletilir (KVKK).
      </div>

      {showTestCards && (
        <div className="test-cards mt-4">
          <div className="fw-semibold small mb-2">
            <i aria-hidden="true" className="bi bi-info-circle me-1" />
            iyzico sandbox test kartları (gerçek ödeme alınmaz)
          </div>
          <ul className="list-unstyled mb-0 small">
            {TEST_CARDS.map((c) => (
              <li key={c.number} className="d-flex align-items-center justify-content-between gap-2 py-1">
                <span>
                  <code>{groupCard(c.number)}</code>
                  <span className={`ms-2 ${c.ok ? 'text-success' : 'text-danger'}`}>{c.label}</span>
                </span>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => fillTest(c)}>
                  Kullan
                </button>
              </li>
            ))}
          </ul>
          <div className="text-secondary small mt-1">Son kullanma: 12/2030 · CVC: 123 · Ad: herhangi bir ad</div>
        </div>
      )}
    </form>
  );
}
