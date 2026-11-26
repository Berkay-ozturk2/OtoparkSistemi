import { useState } from 'react';
import { checkPermit } from '../api/operator';
import { normalizePlate, plateError } from '../utils/plate';
import { formatDate, permitStatus } from '../utils/format';
import PlateBadge from './PlateBadge';

/** Gişede hızlı engelli izni kontrolü: GET /api/permits/check/{plate} → { plate, valid, permit } */
export default function PermitCheckBox({ className = '', compact = false }) {
  const [plate, setPlate] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  const onSubmit = async (e) => {
    e.preventDefault();
    const n = normalizePlate(plate);
    const v = plateError(n);
    setErr(v);
    setResult(null);
    if (v) return;
    setBusy(true);
    try {
      const res = await checkPermit(n);
      setResult(res || { plate: n, valid: false, permit: null });
    } catch (ex) {
      if (ex.status === 404) setResult({ plate: n, valid: false, permit: null });
      else setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const permit = result?.permit;
  const st = permit ? permitStatus(permit.status) : null;

  return (
    <div className={`card ${className}`}>
      <div className="card-header">
        <i className="bi bi-person-wheelchair me-2 text-accent" />
        Engelli izni kontrolü
      </div>
      <div className="card-body">
        <form onSubmit={onSubmit} className="d-flex gap-2" noValidate>
          <input
            className={`form-control ${compact ? 'form-control-sm' : ''} text-uppercase ${err ? 'is-invalid' : ''}`}
            placeholder="Plaka (06 ABC 123)"
            value={plate}
            maxLength={12}
            onChange={(e) => {
              setPlate(e.target.value.toUpperCase());
              setResult(null);
            }}
            aria-label="İzin kontrolü için plaka"
          />
          <button type="submit" className={`btn btn-primary ${compact ? 'btn-sm' : ''} text-nowrap`} disabled={busy}>
            {busy ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-search me-1" />}
            Kontrol
          </button>
        </form>
        {err && <div className="text-danger small mt-2">{err}</div>}

        {result && (
          <div className={`permit-check-result mt-3 ${result.valid ? 'bg-success-subtle border border-success' : 'bg-danger-subtle border border-danger'}`}>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <PlateBadge plate={result.plate} size="sm" />
              {result.valid ? (
                <span className="fw-bold text-success">
                  <i className="bi bi-patch-check-fill me-1" />
                  Geçerli engelli izni var <span aria-hidden="true">♿</span>
                </span>
              ) : (
                <span className="fw-bold text-danger">
                  <i className="bi bi-x-octagon-fill me-1" />
                  Geçerli izin yok
                </span>
              )}
            </div>
            {permit && (
              <div className="small mt-2">
                <div>
                  İzin sahibi: <strong>{permit.holderName || '—'}</strong>
                  {permit.documentNo && <> · Belge: {permit.documentNo}</>}
                </div>
                <div>
                  Durum: <span className={`badge text-bg-${st.variant}`}>{st.label}</span>
                  {' · '}Geçerlilik: {permit.validUntil ? formatDate(permit.validUntil) : 'süresiz'}
                </div>
              </div>
            )}
            {!result.valid && !permit && <div className="small mt-1 text-secondary">Bu plaka için kayıtlı engelli izni bulunmuyor.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
