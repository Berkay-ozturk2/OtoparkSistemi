import { useEffect, useMemo, useRef, useState } from 'react';
import { assignSlot, checkPermit, getActiveSessions, getSlotDetail, unassignSlot } from '../api/operator';
import { normalizePlate, formatPlate } from '../utils/plate';
import { formatDateTime, formatDuration, minutesSince } from '../utils/format';
import { STATE_LABEL, isDisabledSlot, slotState } from './ParkingMap';
import PlateBadge from './PlateBadge';
import { useToast } from './Toast';

export const DISABLED_RULE_TITLE = 'Normal araç engelli park yerine atanamaz';

/** Kuralın açıklayıcı uyarısı (arayüz ve sunucu reddi aynı kutuyu gösterir) */
function DisabledRuleAlert({ plate, message }) {
  return (
    <div className="alert alert-danger py-2 px-3 small mb-2 d-flex gap-2" role="alert" aria-live="assertive">
      <i className="bi bi-slash-circle-fill fs-5 lh-1 mt-1" aria-hidden="true" />
      <div>
        <div className="fw-semibold">{DISABLED_RULE_TITLE}</div>
        {message || (
          <>
            <strong>{formatPlate(plate)}</strong> plakalı aracın geçerli engelli izni yok. Engelli park yerleri yalnızca izinli araçlar
            içindir; aracı standart bir cebe atayın.
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Krokide tıklanan park yerinin detay kartı.
 *  slot         : SlotDto (canlı listeden; durum değişince kart güncellenir)
 *  canManage    : görevli/yönetici → plaka, giriş saati ve atama
 *  zoneLabel    : "A Blok · Zemin"
 *  onClose, onOverride(slot), onPatched(code, patch)
 */
export default function SlotDetailCard({ slot, lotCode, canManage, zoneLabel, onClose, onOverride, onPatched }) {
  const toast = useToast();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState(null);
  const [plate, setPlate] = useState('');
  const [permitCache, setPermitCache] = useState({});
  const [busy, setBusy] = useState(false);
  const [serverRule, setServerRule] = useState(null);
  const [error, setError] = useState(null);
  const closeRef = useRef(null);

  const st = slotState(slot);
  const dis = isDisabledSlot(slot);
  const reqKey = `${slot.id}-${slot.isOccupied}-${slot.updatedAt}`;

  useEffect(() => {
    closeRef.current?.focus();
  }, [slot.id]);

  useEffect(() => {
    setPlate('');
    setServerRule(null);
    setError(null);
  }, [slot.id]);

  // Plaka/giriş saati yalnızca yetkili kullanıcıya ve sunucudan
  useEffect(() => {
    if (!canManage || slot.id == null) return undefined;
    let alive = true;
    setLoading(true);
    getSlotDetail(slot.id)
      .then((d) => alive && setDetail(d))
      .catch((err) => alive && setError(err))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [canManage, reqKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const assigned = canManage && detail?.id === slot.id && detail?.plate;
  const canAssign = canManage && slot.isActive !== false && !assigned;

  useEffect(() => {
    if (!canAssign || sessions) return;
    getActiveSessions(lotCode)
      .then((list) => setSessions(Array.isArray(list) ? list : []))
      .catch(() => setSessions([]));
  }, [canAssign, sessions, lotCode]);

  const norm = normalizePlate(plate);
  const session = useMemo(
    () => (sessions || []).find((s) => normalizePlate(s.plate) === norm && (!s.lotCode || !lotCode || s.lotCode === lotCode)),
    [sessions, norm, lotCode],
  );

  // Engelli cep + izinsiz görünen oturum: izin belgesini güncel olarak doğrula (giriş sonrası onaylanmış olabilir)
  const needsPermitCheck = dis && session && !session.isDisabledPermit && permitCache[norm] === undefined;
  useEffect(() => {
    if (!needsPermitCheck) return;
    let alive = true;
    checkPermit(norm)
      .then((r) => alive && setPermitCache((c) => ({ ...c, [norm]: !!r?.valid })))
      .catch(() => alive && setPermitCache((c) => ({ ...c, [norm]: false })));
    return () => {
      alive = false;
    };
  }, [needsPermitCheck, norm]);

  const hasPermit = session ? session.isDisabledPermit || permitCache[norm] === true : false;
  const ruleBlocked = dis && !!session && !hasPermit && permitCache[norm] !== undefined;
  const permitPending = dis && !!session && !session.isDisabledPermit && permitCache[norm] === undefined;
  const noSession = norm.length >= 5 && sessions && !session;

  const doAssign = async (e) => {
    e.preventDefault();
    if (!session || ruleBlocked || permitPending) return;
    setBusy(true);
    setServerRule(null);
    try {
      const d = await assignSlot(slot.id, norm);
      setDetail(d);
      setPlate('');
      setSessions(null);
      onPatched?.(slot.code, { isOccupied: true, _flash: Date.now() });
      toast.success(`${formatPlate(norm)} → ${slot.code} cebine atandı.`);
    } catch (err) {
      if (err?.status === 422) setServerRule(err.message);
      else toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const doUnassign = async () => {
    setBusy(true);
    try {
      const d = await unassignSlot(slot.id);
      setDetail(d);
      onPatched?.(slot.code, { isOccupied: false, _flash: Date.now() });
      toast.success(`${slot.code} cebindeki atama kaldırıldı.`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const entry = assigned ? detail.entryTime : null;

  return (
    <section className="card slot-detail-card shadow" aria-label={`${slot.code} park yeri ayrıntısı`}>
      <div className="card-header d-flex align-items-center gap-2 py-2">
        <strong className="fs-5">{slot.code}</strong>
        <span className={`badge pm-tip-state pm-tip-${st}`}>{STATE_LABEL[st]}</span>
        {dis && (
          <span className="badge badge-disabled">
            <span aria-hidden="true">♿</span> Engelli
          </span>
        )}
        {slot.hasViolation && <span className="badge text-bg-danger">İhlal</span>}
        <button type="button" ref={closeRef} className="btn-close ms-auto" aria-label="Kapat" onClick={onClose} />
      </div>
      <div className="card-body py-2 small">
        <dl className="slot-detail-dl mb-2">
          <dt>Durum</dt>
          <dd>{STATE_LABEL[st]}</dd>
          <dt>Konum</dt>
          <dd>{zoneLabel || slot.zoneCode}</dd>
          <dt>Plaka</dt>
          <dd>
            {!canManage ? (
              <span className="text-secondary">Yalnızca görevli görebilir</span>
            ) : loading && !detail ? (
              <span className="placeholder col-6" />
            ) : assigned ? (
              <PlateBadge plate={detail.plate} size="sm" />
            ) : slot.isOccupied ? (
              <span className="text-secondary">Atanmamış (kamera algıladı)</span>
            ) : (
              '—'
            )}
          </dd>
          <dt>Giriş saati</dt>
          <dd>
            {!canManage ? (
              <span className="text-secondary">—</span>
            ) : entry ? (
              <>
                {formatDateTime(entry)}
                <span className="text-secondary"> · {formatDuration(minutesSince(entry))}</span>
              </>
            ) : (
              '—'
            )}
          </dd>
          {assigned && dis && (
            <>
              <dt>Engelli izni</dt>
              <dd>{detail.isDisabledPermit ? <span className="text-success fw-semibold">Geçerli</span> : <span className="text-danger fw-semibold">Yok</span>}</dd>
            </>
          )}
          <dt>Güncelleme</dt>
          <dd>{slot.updatedAt ? formatDateTime(slot.updatedAt) : '—'}</dd>
        </dl>

        {!canManage && (
          <p className="text-secondary mb-0">
            <i aria-hidden="true" className="bi bi-shield-lock me-1" />
            Plaka ve giriş saati kişisel veridir (KVKK); yalnızca otopark görevlilerine gösterilir.
          </p>
        )}
        {error && <div className="alert alert-warning py-1 px-2 mb-2">{error.message}</div>}
        {slot.isActive === false && <div className="alert alert-secondary py-1 px-2 mb-2">Bu cep kullanım dışı; araç atanamaz.</div>}

        {canAssign && (
          <form onSubmit={doAssign} noValidate>
            {dis && !ruleBlocked && !serverRule && (
              <div className="text-info-emphasis mb-2">
                <span aria-hidden="true">♿</span> Bu cebe yalnızca engelli izni olan araçlar atanabilir.
              </div>
            )}
            <label className="form-label fw-semibold mb-1" htmlFor={`assign-${slot.id}`}>
              Araç ata
            </label>
            <div className="input-group input-group-sm mb-2">
              <input
                id={`assign-${slot.id}`}
                className={`form-control text-uppercase ${ruleBlocked || serverRule ? 'is-invalid' : ''}`}
                list={`sessions-${slot.id}`}
                placeholder="Plaka (ör. 06 ABC 123)"
                value={plate}
                autoComplete="off"
                onChange={(e) => {
                  setPlate(e.target.value);
                  setServerRule(null);
                }}
                aria-describedby={`assign-help-${slot.id}`}
              />
              <button type="submit" className="btn btn-accent" disabled={busy || !session || ruleBlocked || permitPending}>
                {busy ? <span className="spinner-border spinner-border-sm" /> : <i aria-hidden="true" className="bi bi-box-arrow-in-down" />} Ata
              </button>
            </div>
            <datalist id={`sessions-${slot.id}`}>
              {(sessions || []).map((s) => (
                <option key={s.id} value={formatPlate(s.plate)}>
                  {s.isDisabledPermit ? '♿ izinli' : 'normal araç'}
                </option>
              ))}
            </datalist>
            <div id={`assign-help-${slot.id}`}>
              {(ruleBlocked || serverRule) && <DisabledRuleAlert plate={norm} message={serverRule} />}
              {permitPending && <div className="text-secondary mb-2">Engelli izni kontrol ediliyor…</div>}
              {noSession && <div className="text-warning-emphasis mb-2">Bu otoparkta bu plakayla aktif oturum yok. Önce giriş kaydı yapılmalı.</div>}
              {session && !ruleBlocked && !permitPending && (
                <div className="text-secondary mb-2">
                  Giriş: {formatDateTime(session.entryTime)}
                  {hasPermit && <span className="ms-1">· ♿ izinli</span>}
                </div>
              )}
            </div>
          </form>
        )}

        {canManage && (
          <div className="d-flex flex-wrap gap-2 mt-1">
            {assigned && (
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={doUnassign} disabled={busy}>
                <i aria-hidden="true" className="bi bi-x-circle me-1" />
                Atamayı kaldır
              </button>
            )}
            {onOverride && (
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => onOverride(slot)}>
                <i aria-hidden="true" className="bi bi-pencil-square me-1" />
                Durumu düzelt
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
