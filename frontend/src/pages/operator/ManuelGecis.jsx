import { useCallback, useEffect, useState } from 'react';
import { getGateEvents, manualEntry, manualExit } from '../../api/operator';
import PageHeader from '../../components/PageHeader';
import PlateBadge from '../../components/PlateBadge';
import BarrierIndicator from '../../components/BarrierIndicator';
import ErrorAlert from '../../components/ErrorAlert';
import EmptyState from '../../components/EmptyState';
import LotSelector from '../../components/LotSelector';
import PermitCheckBox from '../../components/PermitCheckBox';
import { useLot } from '../../lot/LotContext';
import { normalizePlate, plateError } from '../../utils/plate';
import { decisionInfo, formatCurrency, formatDateTime, gateLabel } from '../../utils/format';

function GateForm({ gate, lotCode, lotName, onDone }) {
  const [plate, setPlate] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [apiError, setApiError] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => setOpen(false), 8000);
    return () => clearTimeout(t);
  }, [open, result]);

  const submit = async (e) => {
    e.preventDefault();
    const n = normalizePlate(plate);
    const v = plateError(n);
    setErr(v);
    if (v) return;
    setBusy(true);
    setApiError(null);
    try {
      const res = gate === 'Entry' ? await manualEntry(n, lotCode) : await manualExit(n, lotCode);
      const ev = {
        plate: n,
        gate,
        decision: res?.decision,
        message: res?.message,
        createdAt: new Date().toISOString(),
        suggestedZone: res?.suggestedZone,
        fee: res?.fee,
        sessionId: res?.sessionId,
        suggestedSlot: res?.suggestedSlot,
        isDisabledPermit: res?.isDisabledPermit,
        lotCode,
      };
      setResult(ev);
      setOpen(res?.decision === 'Allowed');
      if (res?.decision === 'Allowed') setPlate('');
      onDone?.();
    } catch (error) {
      setApiError(error);
    } finally {
      setBusy(false);
    }
  };

  const isEntry = gate === 'Entry';
  const info = result ? decisionInfo(result.decision) : null;

  return (
    <div className="card h-100">
      <div className="card-header d-flex align-items-center gap-2">
        <i aria-hidden="true" className={`bi ${isEntry ? 'bi-box-arrow-in-right' : 'bi-box-arrow-right'} text-accent`} />
        Manuel {gateLabel(gate)}
        <span className="ms-auto small text-secondary fw-normal text-truncate">
          <i aria-hidden="true" className="bi bi-buildings me-1" />
          {lotName}
        </span>
      </div>
      <div className="card-body">
        <form onSubmit={submit} noValidate className="mb-3">
          <label className="form-label fw-semibold" htmlFor={`mg-${gate}`}>
            Plaka
          </label>
          <div className="input-group input-group-lg has-validation">
            <input
              id={`mg-${gate}`}
              className={`form-control plate-input ${err ? 'is-invalid' : ''}`}
              placeholder="34 ABC 123"
              value={plate}
              maxLength={12}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
            />
            <button type="submit" className={`btn ${isEntry ? 'btn-accent' : 'btn-primary'}`} disabled={busy}>
              {busy ? <span className="spinner-border spinner-border-sm" /> : <i aria-hidden="true" className={`bi ${isEntry ? 'bi-door-open' : 'bi-door-closed'}`} />}
              <span className="ms-2 d-none d-sm-inline">{isEntry ? 'Giriş Yap' : 'Çıkış Yap'}</span>
            </button>
            <div className="invalid-feedback">{err}</div>
          </div>
          <div className="form-text">
            {isEntry
              ? 'Kamera plakayı okuyamadığında veya sistem arızasında kullanılır. İşlem denetim kaydına yazılır.'
              : 'Ödemesi yapılmamış araçlar için sistem çıkışı reddeder; önce Aktif Araçlar ekranından nakit ödeme alın.'}
          </div>
        </form>

        <ErrorAlert error={apiError} className="mb-3" onClose={() => setApiError(null)} />

        <BarrierIndicator gate={gate} open={open} event={result} />

        {result && (
          <div className={`alert alert-${info.variant} mt-3 mb-0`}>
            <div className="fw-semibold">
              <i aria-hidden="true" className={`bi ${info.icon} me-1`} />
              {info.label}
            </div>
            {result.message && <div>{result.message}</div>}
            <div className="small mt-1 d-flex flex-wrap gap-3">
              {result.suggestedZone && (
                <span>
                  Önerilen bölge: <strong>{result.suggestedZone}</strong>
                </span>
              )}
              {result.suggestedSlot && (
                <span>
                  Cep: <strong>{result.suggestedSlot}</strong>
                </span>
              )}
              {result.isDisabledPermit && (
                <span className="badge badge-disabled">
                  <span aria-hidden="true">♿</span> Engelli izinli
                </span>
              )}
              {result.fee != null && Number(result.fee) > 0 && <span>Ücret: {formatCurrency(result.fee)}</span>}
              {result.sessionId && <span>Oturum #{result.sessionId}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Manuel giriş / çıkış (UC-01, UC-02 alternatif akış) */
export default function ManuelGecis() {
  const { lotCode: ctxLot, lotName } = useLot();
  const [lotCode, setLotCode] = useState(ctxLot);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);

  const loadEvents = useCallback(async () => {
    try {
      const list = await getGateEvents(100, lotCode);
      setEvents((Array.isArray(list) ? list : []).filter((e) => e.isManual).slice(0, 15));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [lotCode]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  return (
    <div>
      <PageHeader
        icon="bi-sign-turn-right"
        title="Manuel Geçiş"
        subtitle="Plaka okunamadığında veya kamera devre dışıyken giriş-çıkışı el ile yapın."
        actions={<LotSelector value={lotCode} onChange={setLotCode} label="Geçiş yapılan otopark" />}
      />

      <div className="row g-4 mb-4">
        <div className="col-lg-6 col-xxl-4">
          <GateForm gate="Entry" lotCode={lotCode} lotName={lotName(lotCode)} onDone={loadEvents} />
        </div>
        <div className="col-lg-6 col-xxl-4">
          <GateForm gate="Exit" lotCode={lotCode} lotName={lotName(lotCode)} onDone={loadEvents} />
        </div>
        <div className="col-lg-6 col-xxl-4">
          <PermitCheckBox />
          <div className="small text-secondary mt-2 px-1">
            <i aria-hidden="true" className="bi bi-info-circle me-1" />
            İzinsiz araçlar, otoparkta yalnızca engelli cepleri boşsa giriş alamaz. İzinli araçlara engelli cebi önerilir.
            Belge gişede görüldüyse yönetici &quot;Engelli İzinleri&quot; ekranından doğrudan onaylı izin ekleyebilir.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header d-flex justify-content-between align-items-center">
          <span>
            <i aria-hidden="true" className="bi bi-clock-history me-2 text-accent" />
            Son manuel geçişler
          </span>
          <button type="button" className="btn btn-sm btn-light" onClick={loadEvents} aria-label="Listeyi yenile" title="Listeyi yenile">
            <i aria-hidden="true" className="bi bi-arrow-clockwise" />
          </button>
        </div>
        <div className="card-body p-0">
          <ErrorAlert error={error} onRetry={loadEvents} className="m-3" />
          {events.length === 0 && !error ? (
            <EmptyState icon="bi-sign-turn-right" title="Henüz manuel geçiş yok">Yukarıdaki formla yaptığınız girişler ve çıkışlar burada listelenir.</EmptyState>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>Zaman</th>
                    <th>Kapı</th>
                    <th>Plaka</th>
                    <th>Karar</th>
                    <th>Mesaj</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => {
                    const info = decisionInfo(ev.decision);
                    return (
                      <tr key={ev.id}>
                        <td className="small text-nowrap">{formatDateTime(ev.createdAt)}</td>
                        <td>{gateLabel(ev.gate)}</td>
                        <td className="text-nowrap">
                          <PlateBadge plate={ev.plate} size="sm" />
                          {ev.isDisabledPermit && (
                            <span className="badge badge-disabled ms-1" title="Engelli izinli">
                              <span aria-hidden="true">♿</span>
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`badge text-bg-${info.variant}`}>{info.label}</span>
                        </td>
                        <td className="small">{ev.message}</td>
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
  );
}
