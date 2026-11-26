import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getPaymentQuote, pay } from '../../api/payments';
import PageHeader from '../../components/PageHeader';
import PlateBadge from '../../components/PlateBadge';
import ErrorAlert from '../../components/ErrorAlert';
import CardPaymentForm from '../../components/CardPaymentForm';
import { normalizePlate, plateError } from '../../utils/plate';
import { formatCurrency, formatDateTime, formatDuration } from '../../utils/format';

function Steps({ step }) {
  const items = ['Plaka', 'Ödeme', 'Sonuç'];
  return (
    <div className="steps mb-4">
      {items.map((label, i) => (
        <span key={label} className="d-flex align-items-center gap-2">
          {i > 0 && <span className="sep" />}
          <span className={`step ${step === i ? 'active' : step > i ? 'done' : ''}`}>
            <span className="num">{step > i ? <i className="bi bi-check" /> : i + 1}</span>
            {label}
          </span>
        </span>
      ))}
    </div>
  );
}

/** UC-03: Otopark ücretini öde (girişsiz) */
export default function UcretOde() {
  const [params, setParams] = useSearchParams();
  const [plate, setPlate] = useState(params.get('plaka') || '');
  const [validation, setValidation] = useState(null);
  const [quote, setQuote] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const step = receipt ? 2 : quote && !quote.isPaid && Number(quote.amount) > 0 ? 1 : 0;

  const lookup = async (value) => {
    const n = normalizePlate(value);
    const v = plateError(n);
    setValidation(v);
    if (v) return;
    setBusy(true);
    setError(null);
    setNotFound(false);
    setQuote(null);
    setReceipt(null);
    setPayError(null);
    try {
      const q = await getPaymentQuote(n);
      setQuote(q);
      setParams({ plaka: n }, { replace: true });
    } catch (err) {
      if (err.status === 404) setNotFound(true);
      else setError(err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const initial = params.get('plaka');
    if (initial) lookup(initial);
  }, []); // eslint-disable-line

  const onPay = async (card) => {
    setPaying(true);
    setPayError(null);
    try {
      const res = await pay({ sessionId: quote.sessionId, reservationId: null, card });
      if (res?.status === 'Success') {
        setReceipt(res);
      } else {
        setPayError(res?.message || 'Ödeme başarısız oldu.');
      }
    } catch (err) {
      setPayError(err);
    } finally {
      setPaying(false);
    }
  };

  const reset = () => {
    setPlate('');
    setQuote(null);
    setReceipt(null);
    setNotFound(false);
    setParams({}, { replace: true });
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1000 }}>
      <PageHeader
        icon="bi-credit-card"
        title="Otopark Ücretini Öde"
        subtitle="Gişeye uğramadan plakanızla ücretinizi sorgulayın ve kartla ödeyin. Ödeme sonrası çıkışta bariyer otomatik açılır."
      />

      <Steps step={step} />

      {!receipt && (
        <div className="card mb-4">
          <div className="card-body p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                lookup(plate);
              }}
              className="row g-3 align-items-end"
              noValidate
            >
              <div className="col-md-8">
                <label htmlFor="pay-plate" className="form-label fw-semibold">
                  Plaka
                </label>
                <input
                  id="pay-plate"
                  className={`form-control form-control-lg plate-input ${validation ? 'is-invalid' : ''}`}
                  placeholder="34 ABC 123"
                  value={plate}
                  maxLength={12}
                  onChange={(e) => setPlate(e.target.value.toUpperCase())}
                />
                <div className="invalid-feedback">{validation}</div>
              </div>
              <div className="col-md-4 d-grid">
                <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
                  {busy ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-calculator me-2" />}
                  Ücreti Sorgula
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ErrorAlert error={error} onRetry={() => lookup(plate)} className="mb-4" />

      {notFound && (
        <div className="alert alert-secondary d-flex align-items-center gap-3">
          <i className="bi bi-search fs-4" />
          <div>
            Bu plakaya ait açık bir park kaydı bulunamadı. Aracınız içeride değilse ödeme yapmanız gerekmez.
          </div>
        </div>
      )}

      {quote && !receipt && (
        <div className="row g-4">
          <div className="col-lg-5">
            <div className="card h-100">
              <div className="card-header">
                <i className="bi bi-receipt me-2 text-accent" />
                Park Özeti
              </div>
              <div className="card-body">
                <div className="text-center mb-3">
                  <PlateBadge plate={quote.plate} size="lg" />
                </div>
                <dl className="row mb-0">
                  <dt className="col-6 text-secondary fw-normal">Giriş zamanı</dt>
                  <dd className="col-6 text-end fw-semibold">{formatDateTime(quote.entryTime)}</dd>
                  <dt className="col-6 text-secondary fw-normal">Park süresi</dt>
                  <dd className="col-6 text-end fw-semibold">{formatDuration(quote.durationMinutes)}</dd>
                  <dt className="col-6 text-secondary fw-normal">Oturum no</dt>
                  <dd className="col-6 text-end">#{quote.sessionId}</dd>
                </dl>
                <hr />
                <div className="d-flex justify-content-between align-items-center">
                  <span className="fw-semibold">Ödenecek tutar</span>
                  <span className="fs-3 fw-bold text-primary">{formatCurrency(quote.amount)}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="col-lg-7">
            {quote.isPaid ? (
              <div className="card h-100">
                <div className="card-body text-center py-5">
                  <i className="bi bi-check-circle-fill display-4 text-success" />
                  <h2 className="h5 mt-3">Ücret ödenmiş</h2>
                  <p className="text-secondary mb-0">
                    Bu park oturumu için ödeme alınmıştır. Ödeme sonrası tanınan süre içinde çıkış yapabilirsiniz.
                  </p>
                </div>
              </div>
            ) : Number(quote.amount) <= 0 ? (
              <div className="card h-100">
                <div className="card-body text-center py-5">
                  <i className="bi bi-gift display-4 text-accent" />
                  <h2 className="h5 mt-3">Ödeme gerekmiyor</h2>
                  <p className="text-secondary mb-0">Ücretsiz süre içindesiniz; çıkışta bariyer otomatik açılır.</p>
                </div>
              </div>
            ) : (
              <div className="card">
                <div className="card-header">
                  <i className="bi bi-credit-card-2-front me-2 text-accent" />
                  Kart ile Ödeme
                </div>
                <div className="card-body">
                  <ErrorAlert error={payError} title="Ödeme başarısız" className="mb-3" onClose={() => setPayError(null)} />
                  <CardPaymentForm amount={quote.amount} onPay={onPay} busy={paying} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {receipt && (
        <div className="card mx-auto" style={{ maxWidth: 560 }}>
          <div className="card-body p-4 text-center">
            <i className="bi bi-check-circle-fill display-3 text-success" />
            <h2 className="h4 mt-3">Ödeme başarılı</h2>
            <p className="text-secondary">{receipt.message || 'Çıkışta bariyer otomatik olarak açılacaktır.'}</p>
            <div className="receipt text-start mt-3">
              <div className="d-flex justify-content-between mb-2">
                <span className="text-secondary">Plaka</span>
                <PlateBadge plate={quote?.plate} size="sm" />
              </div>
              <div className="d-flex justify-content-between mb-2">
                <span className="text-secondary">Tutar</span>
                <strong>{formatCurrency(receipt.amount)}</strong>
              </div>
              <div className="d-flex justify-content-between mb-2">
                <span className="text-secondary">Ödeme no</span>
                <span>#{receipt.paymentId}</span>
              </div>
              {receipt.transactionId && (
                <div className="d-flex justify-content-between">
                  <span className="text-secondary">İşlem kodu</span>
                  <code>{receipt.transactionId}</code>
                </div>
              )}
            </div>
            <div className="d-flex gap-2 justify-content-center mt-4 no-print">
              <button type="button" className="btn btn-outline-primary" onClick={() => window.print()}>
                <i className="bi bi-printer me-2" />
                Yazdır
              </button>
              <button type="button" className="btn btn-primary" onClick={reset}>
                Yeni sorgu
              </button>
              <Link to="/" className="btn btn-light">
                Ana sayfa
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
