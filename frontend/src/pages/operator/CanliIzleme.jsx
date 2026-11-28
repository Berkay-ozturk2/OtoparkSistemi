import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import useParkingLive, { belongsToLot } from '../../realtime/useParkingLive';
import { getBackendAgents, getGateEvents, getReviewQueue, getViolations, overrideSlot } from '../../api/operator';
import LotSelector from '../../components/LotSelector';
import PermitCheckBox from '../../components/PermitCheckBox';
import ViolationResolveModal from '../../components/ViolationResolveModal';
import { useLot } from '../../lot/LotContext';
import { isSoundOn, playAlert, setSoundOn as storeSound } from '../../utils/sound';
import ParkingView from '../../components/ParkingView';
import { DUR, EASE, dur, gsap } from '../../utils/motion';
import AnimatedNumber from '../../components/AnimatedNumber';
import StatCard from '../../components/StatCard';
import LiveBadge from '../../components/LiveBadge';
import BarrierIndicator from '../../components/BarrierIndicator';
import PlateBadge from '../../components/PlateBadge';
import ErrorAlert from '../../components/ErrorAlert';
import Loading from '../../components/Loading';
import ConfirmModal from '../../components/ConfirmModal';
import { useToast } from '../../components/Toast';
import { decisionInfo, formatDateTime, formatPercent, formatTime, gateLabel, slotTypeLabel, timeAgo } from '../../utils/format';

const BARRIER_OPEN_MS = 8000;
const MAX_EVENTS = 60;

function asAgentList(x) {
  if (Array.isArray(x)) return x;
  if (x && Array.isArray(x.agents)) return x.agents;
  return [];
}

function agentStatusVariant(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'running' || s === 'ok') return 'success';
  if (s === 'error' || s === 'failed') return 'danger';
  if (s === 'stopped' || s === 'idle') return 'secondary';
  return 'warning';
}

/** UC-08 (anlık doluluk), UC-01/UC-02 (giriş/çıkış olayları) — operatör canlı izleme ekranı */
export default function CanliIzleme() {
  const toast = useToast();
  const [events, setEvents] = useState([]);
  const [eventsError, setEventsError] = useState(null);
  const [barriers, setBarriers] = useState({
    Entry: { open: false, event: null },
    Exit: { open: false, event: null },
  });
  const [pendingCount, setPendingCount] = useState(0);
  const [agents, setAgents] = useState([]);
  const { lotCode, lotName } = useLot();
  const [soundOn, setSoundOn] = useState(isSoundOn);
  const [violations, setViolations] = useState([]);
  const [violationToResolve, setViolationToResolve] = useState(null);
  const [resolveAs, setResolveAs] = useState('Resolved');
  const lotRef = useRef(lotCode);
  lotRef.current = lotCode;
  const [newBadge, setNewBadge] = useState(0);
  const [slotToEdit, setSlotToEdit] = useState(null);
  const [overriding, setOverriding] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [, setTick] = useState(0);

  const closeTimers = useRef({});
  const screenRef = useRef(null);
  const feedRef = useRef(null);
  const topKey = events[0]?._new ? events[0]._key : null;

  // Yeni plaka okuması: kart yukarıdan kısa ve yumuşak belirir (azaltılmış harekette anında)
  useEffect(() => {
    if (!topKey || !feedRef.current) return undefined;
    const el = feedRef.current.querySelector(`[data-ev-key="${CSS.escape(topKey)}"]`);
    if (!el) return undefined;
    const tween = gsap.fromTo(el, { autoAlpha: 0, y: -10, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: dur(DUR.ui), ease: EASE.out, clearProps: 'transform,visibility' });
    return () => tween.progress(1).kill();
  }, [topKey]);

  // Ses ayarı (yerel depoda); kapalıyken playAlert sessiz kalır
  const beep = useCallback((decision) => playAlert(decision), []);

  const applyBarrier = useCallback((ev) => {
    const gate = ev.gate === 'Exit' ? 'Exit' : 'Entry';
    const open = ev.decision === 'Allowed';
    setBarriers((b) => ({ ...b, [gate]: { open, event: ev } }));
    if (closeTimers.current[gate]) clearTimeout(closeTimers.current[gate]);
    if (open) {
      closeTimers.current[gate] = setTimeout(() => {
        setBarriers((b) => ({ ...b, [gate]: { ...b[gate], open: false } }));
      }, BARRIER_OPEN_MS);
    }
  }, []);

  const loadSide = useCallback(async () => {
    setEventsError(null);
    getViolations({ lot: lotCode, status: 'Open' })
      .then((v) => setViolations(Array.isArray(v) ? v : []))
      .catch(() => {});
    try {
      const list = await getGateEvents(30, lotCode);
      const arr = Array.isArray(list) ? list : [];
      setEvents(arr);
      // Bariyer göstergelerinde her kapının son olayını (kapalı olarak) göster
      const lastEntry = arr.find((e) => e.gate === 'Entry');
      const lastExit = arr.find((e) => e.gate === 'Exit');
      setBarriers((b) => ({
        Entry: b.Entry.event && belongsToLot(b.Entry.event, lotCode) ? b.Entry : { open: false, event: lastEntry || null },
        Exit: b.Exit.event && belongsToLot(b.Exit.event, lotCode) ? b.Exit : { open: false, event: lastExit || null },
      }));
    } catch (err) {
      setEventsError(err);
    }
    getReviewQueue()
      .then((q) => setPendingCount(Array.isArray(q) ? q.length : 0))
      .catch(() => {});
    getBackendAgents()
      .then((a) => setAgents(asAgentList(a)))
      .catch(() => {});
  }, [lotCode]);

  const live = useParkingLive(
    {
      onGateEvent: (ev) => {
        if (!ev || !belongsToLot(ev, lotRef.current)) return; // başka otoparkın olayı
        const item = { ...ev, _new: true, _key: `${ev.id ?? 'x'}-${Date.now()}` };
        setEvents((list) => [item, ...list.filter((e) => e.id !== ev.id)].slice(0, MAX_EVENTS));
        applyBarrier(ev);
        beep(ev.decision);
        setNewBadge((n) => n + 1);
        if (ev.decision === 'PendingReview') {
          toast.warning(`Onay bekleyen okuma: ${ev.plate || 'okunamadı'} (${gateLabel(ev.gate)})`);
        }
      },
      onReviewQueueChanged: (data) => {
        if (data && typeof data.pendingCount === 'number') setPendingCount(data.pendingCount);
      },
      onAgentsUpdated: (data) => setAgents(asAgentList(data)),
      onViolationDetected: (v) => {
        if (!v) return;
        const mine = belongsToLot(v, lotRef.current);
        playAlert('Violation');
        toast.show(
          `♿ İhlal: ${v.lotName || v.lotCode || ''} · ${v.slotCode} engelli cebine izinsiz araç park etti!`,
          'danger',
          9000,
        );
        if (mine) {
          setViolations((list) => [{ ...v, _new: true }, ...list.filter((x) => x.id !== v.id)]);
          setSlots((list) => list.map((s) => (s.code === v.slotCode ? { ...s, hasViolation: true, _flash: Date.now() } : s)));
        }
      },
      onViolationResolved: (v) => {
        if (!v) return;
        setViolations((list) => list.filter((x) => x.id !== v.id));
        if (belongsToLot(v, lotRef.current)) {
          setSlots((list) => list.map((s) => (s.code === v.slotCode ? { ...s, hasViolation: false } : s)));
        }
      },
      onReconnected: () => loadSide(),
    },
    { withAuth: true },
  );

  const { lot, summary, zones, slots, recommendation, loading, error, hubStatus, reload, setSlots } = live;
  const violationCodes = violations.map((v) => v.slotCode);

  useEffect(() => {
    setEvents([]);
    setNewBadge(0);
    setBarriers({ Entry: { open: false, event: null }, Exit: { open: false, event: null } });
  }, [lotCode]);

  useEffect(() => {
    loadSide();
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    const timers = closeTimers.current;
    return () => {
      clearInterval(t);
      Object.values(timers).forEach(clearTimeout);
    };
  }, [loadSide]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    storeSound(next);
    if (next) playAlert('Allowed'); // kullanıcı etkileşimiyle ses bağlamını aç
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      screenRef.current?.requestFullscreen?.().catch(() => {});
    }
  };

  const doOverride = async () => {
    if (!slotToEdit) return;
    const occupied = !slotToEdit.isOccupied;
    setOverriding(true);
    try {
      await overrideSlot(slotToEdit.code, occupied, lotCode);
      setSlots((list) => list.map((s) => (s.code === slotToEdit.code ? { ...s, isOccupied: occupied, _flash: Date.now() } : s)));
      toast.success(`${slotToEdit.code} cebi ${occupied ? 'DOLU' : 'BOŞ'} olarak işaretlendi.`);
      setSlotToEdit(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setOverriding(false);
    }
  };

  const rate = summary?.occupancyRate ?? 0;

  return (
    <div ref={screenRef} className={`live-screen ${isFullscreen ? 'fullscreen-mode' : ''}`}>
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div className="d-flex align-items-center gap-3">
          <div className="page-header-icon">
            <i aria-hidden="true" className="bi bi-broadcast" />
          </div>
          <div>
            <h1 className="h3 mb-0">Canlı İzleme</h1>
            <div className="small text-secondary">
              {lot?.name || lotName(lotCode)} · doluluk, bariyer, ihlal ve giriş-çıkış olayları anlık güncellenir.
            </div>
          </div>
        </div>
        <div className="d-flex flex-wrap align-items-center gap-2">
          <LotSelector label="Otopark" />
          <LiveBadge status={hubStatus} />
          <button type="button" className={`btn btn-sm ${soundOn ? 'btn-accent' : 'btn-outline-secondary'}`} onClick={toggleSound} title="Yeni olayda sesli uyarı">
            <i aria-hidden="true" className={`bi ${soundOn ? 'bi-volume-up-fill' : 'bi-volume-mute'} me-1`} />
            Ses {soundOn ? 'açık' : 'kapalı'}
          </button>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={toggleFullscreen}>
            <i aria-hidden="true" className={`bi ${isFullscreen ? 'bi-fullscreen-exit' : 'bi-arrows-fullscreen'} me-1`} />
            {isFullscreen ? 'Küçült' : 'Tam ekran'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            aria-label="Verileri yenile"
            title="Verileri yenile"
            onClick={() => {
              reload();
              loadSide();
            }}
          >
            <i aria-hidden="true" className="bi bi-arrow-clockwise" />
          </button>
        </div>
      </div>

      <ErrorAlert error={error} onRetry={reload} className="mb-3" />

      {/* Özet kartları */}
      <div className="row g-3 mb-3">
        <div className="col-6 col-md-4 col-xl">
          <StatCard icon="bi-check2-circle" label="Boş" value={summary?.free ?? '—'} variant="success" size="lg" loading={loading} />
        </div>
        <div className="col-6 col-md-4 col-xl">
          <StatCard icon="bi-car-front-fill" label="Dolu" value={summary?.occupied ?? '—'} variant="danger" size="lg" loading={loading} />
        </div>
        <div className="col-6 col-md-4 col-xl">
          <StatCard icon="bi-bookmark-star" label="Rezerve" value={summary?.reserved ?? '—'} variant="warning" size="lg" loading={loading} />
        </div>
        <div className="col-6 col-md-4 col-xl">
          <StatCard
            icon="bi-person-wheelchair"
            label="Engelli boş"
            value={summary ? `${summary.disabledFree ?? 0}/${summary.disabledTotal ?? 0}` : '—'}
            sub={violations.length ? `${violations.length} açık ihlal` : 'ihlal yok'}
            variant={violations.length ? 'danger' : 'info'}
            size="lg"
            loading={loading}
          />
        </div>
        <div className="col-6 col-md-6 col-xl">
          <StatCard
            icon="bi-pie-chart"
            label="Doluluk"
            value={summary ? <AnimatedNumber value={rate * 100} format={(v) => `%${Math.round(v)}`} /> : '—'}
            sub={summary ? `${summary.occupied}/${summary.total} cep` : null}
            variant="primary"
            size="lg"
            loading={loading}
          />
        </div>
        <div className="col-12 col-md-6 col-xl">
          <Link to="/operator/onay-kuyrugu" className="text-decoration-none">
            <StatCard
              icon="bi-ui-checks"
              label="Onay bekleyen"
              value={
                <span className="d-inline-flex align-items-center gap-2">
                  {pendingCount}
                  {pendingCount > 0 && <span className="badge rounded-pill text-bg-warning pulse-badge fs-6">İncele</span>}
                </span>
              }
              sub="Düşük güvenli plaka okumaları"
              variant={pendingCount > 0 ? 'warning' : 'secondary'}
              size="lg"
              className="card-hover"
            />
          </Link>
        </div>
      </div>

      <div className="row g-3">
        {/* Kroki */}
        <div className="col-xl-8">
          <div className="card h-100">
            <div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
              <span>
                <i aria-hidden="true" className="bi bi-map me-2 text-accent" />
                Otopark Krokisi
              </span>
              <span className="small text-secondary fw-normal">
                {recommendation ? (
                  <>
                    Önerilen: <strong className="text-accent">{recommendation.zoneCode}</strong> ({recommendation.freeSlots} boş) ·{' '}
                  </>
                ) : null}
                Cebe tıklayın: ayrıntı, araç atama, durum düzeltme
              </span>
            </div>
            <div className="card-body">
              {loading ? (
                <Loading text="Kroki yükleniyor…" />
              ) : (
                <ParkingView
                  lot={lot}
                  lotCode={lotCode}
                  slots={slots}
                  zones={zones}
                  recommendedZone={recommendation?.zoneCode}
                  highlightSlot={recommendation?.slotCode}
                  violationSlots={violationCodes}
                  canManage
                  onOverride={setSlotToEdit}
                  onSlotsPatched={(code, patch) => setSlots((list) => list.map((s) => (s.code === code ? { ...s, ...patch } : s)))}
                />
              )}

              <div className="row g-2 mt-2">
                {zones.map((z) => (
                  <div className="col-sm-6 col-lg-4" key={z.code}>
                    <div className="border rounded-3 px-3 py-2 d-flex justify-content-between align-items-center">
                      <span className="fw-semibold">
                        <span className="badge text-bg-primary me-2">{z.code}</span>
                        <span className="small">{z.name}</span>
                      </span>
                      <span className="fw-bold text-nowrap">
                        {z.freeSlots}
                        <span className="text-secondary fw-normal small">/{z.totalSlots}</span>
                        {z.disabledTotal > 0 && (
                          <span className="badge badge-disabled-soft ms-1" title="Boş engelli yeri">
                            <span aria-hidden="true">♿</span> {z.disabledFree ?? 0}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {agents.length > 0 && (
                <div className="mt-3">
                  <div className="small text-secondary fw-semibold mb-1">
                    <i aria-hidden="true" className="bi bi-cpu me-1" />
                    Görüntü ajanları
                  </div>
                  <div className="d-flex flex-wrap gap-2">
                    {agents.map((a) => (
                      <span key={a.id} className="border rounded-pill px-3 py-1 small d-inline-flex align-items-center gap-2" title={a.lastError || ''}>
                        <span className={`badge rounded-pill text-bg-${agentStatusVariant(a.status)}`}>{a.status || '?'}</span>
                        <strong>{a.id}</strong>
                        {a.fps != null && <span className="text-secondary">{Number(a.fps).toFixed(1)} fps</span>}
                        {a.lastError && <i aria-hidden="true" className="bi bi-exclamation-triangle text-danger" />}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* İhlaller + bariyerler + olay akışı */}
        <div className="col-xl-4 d-flex flex-column gap-3">
          <div className={`card ${violations.length ? 'border-danger' : ''}`}>
            <div className={`card-header d-flex justify-content-between align-items-center ${violations.length ? 'bg-danger-subtle' : ''}`}>
              <span>
                <i aria-hidden="true" className={`bi bi-exclamation-diamond me-2 ${violations.length ? 'text-danger' : 'text-accent'}`} />
                Engelli Yeri İhlalleri
                {violations.length > 0 && <span className="badge rounded-pill text-bg-danger ms-2 pulse-badge">{violations.length}</span>}
              </span>
              <Link to="/operator/ihlaller" className="btn btn-sm btn-light">
                Tümü
              </Link>
            </div>
            <div className="card-body py-2" style={{ maxHeight: 260, overflowY: 'auto' }}>
              {violations.length === 0 ? (
                <div className="text-secondary small py-2 text-center">
                  <i aria-hidden="true" className="bi bi-shield-check text-success me-1" />
                  Bu otoparkta açık ihlal yok.
                </div>
              ) : (
                violations.map((v) => (
                  <div key={v.id} className={`event-item violation-item ${v._new ? 'violation-new' : ''}`}>
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <span className="badge badge-disabled">
                        <span aria-hidden="true">♿</span> {v.slotCode}
                      </span>
                      {v.zoneCode && <span className="small text-secondary">{v.zoneCode} bölgesi</span>}
                      <span className="ms-auto small text-secondary" title={formatDateTime(v.detectedAt)}>
                        {timeAgo(v.detectedAt)}
                      </span>
                    </div>
                    <div className="d-flex gap-2 mt-2">
                      <button
                        type="button"
                        className="btn btn-sm btn-success"
                        onClick={() => {
                          setResolveAs('Resolved');
                          setViolationToResolve(v);
                        }}
                      >
                        <i aria-hidden="true" className="bi bi-check2 me-1" />
                        Çözüldü
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => {
                          setResolveAs('FalseAlarm');
                          setViolationToResolve(v);
                        }}
                      >
                        <i aria-hidden="true" className="bi bi-bell-slash me-1" />
                        Yanlış alarm
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="row g-3">
            <div className="col-6 col-xl-6">
              <BarrierIndicator gate="Entry" open={barriers.Entry.open} event={barriers.Entry.event} size="lg" />
            </div>
            <div className="col-6 col-xl-6">
              <BarrierIndicator gate="Exit" open={barriers.Exit.open} event={barriers.Exit.event} size="lg" />
            </div>
          </div>

          <div className="card flex-grow-1">
            <div className="card-header d-flex justify-content-between align-items-center">
              <span>
                <i aria-hidden="true" className="bi bi-activity me-2 text-accent" />
                Son Geçiş Olayları
                {newBadge > 0 && (
                  <button type="button" className="badge rounded-pill text-bg-danger ms-2 border-0" onClick={() => setNewBadge(0)} title="Okundu say">
                    {newBadge} yeni
                  </button>
                )}
              </span>
              <Link to="/operator/manuel-gecis" className="btn btn-sm btn-light">
                <i aria-hidden="true" className="bi bi-sign-turn-right me-1" />
                Manuel
              </Link>
            </div>
            <div className="card-body event-feed" ref={feedRef} role="log" aria-live="polite" aria-relevant="additions" aria-label="Son geçiş olayları" onMouseEnter={() => setNewBadge(0)}>
              <ErrorAlert error={eventsError} onRetry={loadSide} />
              {events.length === 0 && !eventsError && (
                <div className="text-center text-secondary py-4">
                  <i aria-hidden="true" className="bi bi-hourglass d-block fs-2 mb-2" />
                  Henüz geçiş olayı yok. Kameralar plaka okudukça burada görünecek.
                </div>
              )}
              {events.map((ev) => {
                const info = decisionInfo(ev.decision);
                return (
                  <div key={ev._key || ev.id} data-ev-key={ev._key || undefined} className={`event-item ev-${ev.decision} ${ev._new ? 'ev-new' : ''}`}>
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <span className={`badge text-bg-${ev.gate === 'Exit' ? 'dark' : 'primary'}`}>
                        <i aria-hidden="true" className={`bi ${ev.gate === 'Exit' ? 'bi-box-arrow-right' : 'bi-box-arrow-in-right'} me-1`} />
                        {gateLabel(ev.gate)}
                      </span>
                      <PlateBadge plate={ev.plate} size="sm" />
                      <span className={`badge text-bg-${info.variant}`}>
                        <i aria-hidden="true" className={`bi ${info.icon} me-1`} />
                        {info.label}
                      </span>
                      {ev.isManual && <span className="badge text-bg-light border">Manuel</span>}
                      {ev.isDisabledPermit && (
                        <span className="badge badge-disabled" title="Engelli izinli araç">
                          <span aria-hidden="true">♿</span> İzinli
                        </span>
                      )}
                      <span className="ms-auto small text-secondary text-nowrap" title={formatTime(ev.createdAt, true)}>
                        {timeAgo(ev.createdAt)}
                      </span>
                    </div>
                    <div className="small mt-1 d-flex flex-wrap gap-2 text-secondary">
                      {ev.message && <span className="text-body">{ev.message}</span>}
                      {ev.suggestedZone && (
                        <span>
                          · Önerilen bölge: <strong className="text-accent">{ev.suggestedZone}</strong>
                        </span>
                      )}
                      {ev.suggestedSlot && (
                        <span>
                          · Cep: <strong>{ev.suggestedSlot}</strong>
                        </span>
                      )}
                      {ev.confidence != null && <span>· Güven: {formatPercent(ev.confidence)}</span>}
                      {ev.cameraId && <span>· {ev.cameraId}</span>}
                    </div>
                    {ev.decision === 'PendingReview' && (
                      <Link to="/operator/onay-kuyrugu" className="small">
                        Onay kuyruğuna git →
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="row g-3 mt-0">
        <div className="col-lg-6 col-xl-4 ms-auto">
          <PermitCheckBox compact />
        </div>
      </div>

      <ViolationResolveModal
        violation={violationToResolve}
        initialStatus={resolveAs}
        onClose={() => setViolationToResolve(null)}
        onResolved={(v) => {
          setViolations((list) => list.filter((x) => x.id !== v.id));
          setSlots((list) => list.map((s) => (s.code === v.slotCode ? { ...s, hasViolation: false } : s)));
        }}
      />

      <ConfirmModal
        show={!!slotToEdit}
        title="Cep durumunu düzelt"
        icon="bi-pencil-square"
        variant={slotToEdit?.isOccupied ? 'success' : 'danger'}
        confirmText={slotToEdit?.isOccupied ? 'BOŞ olarak işaretle' : 'DOLU olarak işaretle'}
        busy={overriding}
        onConfirm={doOverride}
        onCancel={() => setSlotToEdit(null)}
      >
        {slotToEdit && (
          <>
            <p className="mb-2">
              <strong>{slotToEdit.code}</strong> ({slotTypeLabel(slotToEdit.type)}
              {slotToEdit.type === 'Disabled' ? ' ♿' : ''}) cebi şu anda <strong>{slotToEdit.isOccupied ? 'DOLU' : 'BOŞ'}</strong>{' '}
              görünüyor. Kamera hatalı algıladıysa durumu el ile düzeltebilirsiniz. Bu işlem denetim kaydına yazılır.
            </p>
            {slotToEdit.isActive === false && (
              <div className="alert alert-secondary py-2 small mb-2">Bu cep yönetici tarafından kullanım dışı bırakılmış.</div>
            )}
            {(() => {
              const v = violations.find((x) => x.slotCode === slotToEdit.code);
              if (!v && !slotToEdit.hasViolation) return null;
              return (
                <div className="alert alert-danger py-2 small mb-0 d-flex align-items-center gap-2">
                  <i aria-hidden="true" className="bi bi-exclamation-triangle-fill" />
                  Bu cepte açık engelli yeri ihlali var.
                  {v && (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger ms-auto"
                      onClick={() => {
                        setSlotToEdit(null);
                        setResolveAs('Resolved');
                        setViolationToResolve(v);
                      }}
                    >
                      İhlali kapat
                    </button>
                  )}
                </div>
              );
            })()}
          </>
        )}
      </ConfirmModal>
    </div>
  );
}
