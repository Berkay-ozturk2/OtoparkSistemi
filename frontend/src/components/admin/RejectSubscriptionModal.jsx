import { useEffect, useId, useState } from 'react';
import Modal from '../Modal';
import PlateBadge from '../PlateBadge';
import { planLabel } from '../../utils/format';

const QUICK_REASONS = ['Plaka ile ruhsat bilgisi uyuşmuyor', 'Bu otoparkta abonelik kontenjanı dolu', 'İletişim bilgisi eksik'];

/** Ret gerekçesi zorunludur; başvuru sahibi bu metni kendi ekranında görür. */
export default function RejectSubscriptionModal({ subscription, busy, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const id = useId();

  useEffect(() => {
    setReason('');
    setTouched(false);
  }, [subscription?.id]);

  const error = reason.trim().length < 5 ? 'Başvuru sahibine ne yapması gerektiğini anlatan bir gerekçe yazın (en az 5 karakter).' : null;

  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (!error) onConfirm(reason.trim());
  };

  return (
    <Modal
      show={!!subscription}
      title="Başvuruyu reddet"
      icon="bi-x-circle"
      onClose={busy ? undefined : onCancel}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onCancel} disabled={busy}>
            Vazgeç
          </button>
          <button type="submit" form={`${id}-form`} className="btn btn-danger" disabled={busy}>
            {busy ? <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> : <i aria-hidden="true" className="bi bi-x-circle me-2" />}
            Başvuruyu reddet
          </button>
        </>
      }
    >
      {subscription && (
        <form id={`${id}-form`} onSubmit={submit} noValidate>
          <div className="d-flex align-items-center gap-2 flex-wrap mb-3">
            <PlateBadge plate={subscription.plate} size="sm" />
            <span className="fw-semibold">{subscription.holderName}</span>
            <span className="text-secondary small">
              {planLabel(subscription.plan)} paket, {subscription.lotName}
            </span>
          </div>
          <label htmlFor={`${id}-reason`} className="form-label fw-semibold">
            Ret gerekçesi
          </label>
          <textarea
            id={`${id}-reason`}
            className={`form-control ${touched && error ? 'is-invalid' : ''}`}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-describedby={`${id}-help ${id}-err`}
            aria-invalid={touched && !!error}
            autoFocus
          />
          {touched && error && (
            <div id={`${id}-err`} className="invalid-feedback d-block">
              {error}
            </div>
          )}
          <div id={`${id}-help`} className="form-text">
            Başvuru sahibi bu metni Abonelik ekranında görür.
          </div>
          <div className="d-flex flex-wrap gap-2 mt-2">
            {QUICK_REASONS.map((r) => (
              <button key={r} type="button" className="btn btn-sm btn-light reason-chip" onClick={() => setReason(r)}>
                {r}
              </button>
            ))}
          </div>
        </form>
      )}
    </Modal>
  );
}
