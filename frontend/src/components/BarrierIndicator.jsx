import { useEffect, useRef } from 'react';
import PlateBadge from './PlateBadge';
import { DUR, EASE, dur, gsap } from '../utils/motion';
import { decisionInfo, formatTime, gateLabel } from '../utils/format';

/**
 * Animasyonlu bariyer göstergesi.
 *  gate   : 'Entry' | 'Exit'
 *  open   : bool (Allowed → AÇIK)
 *  event  : son GateEvent (plaka, karar, mesaj)
 */
export default function BarrierIndicator({ gate = 'Entry', open = false, event, size = 'md', className = '' }) {
  const info = event ? decisionInfo(event.decision) : null;
  const readRef = useRef(null);
  const eventKey = event ? `${event.id ?? ''}-${event.createdAt ?? ''}` : null;

  // Yeni okuma: plaka satırı kısa bir kayma + belirme ile yenilenir
  useEffect(() => {
    if (!eventKey || !readRef.current) return undefined;
    const t = gsap.fromTo(readRef.current, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: dur(DUR.ui), ease: EASE.out, clearProps: 'transform,visibility' });
    return () => t.progress(1).kill();
  }, [eventKey]);
  return (
    <div className={`card barrier-card barrier-${size} ${open ? 'is-open' : 'is-closed'} ${className}`}>
      <div className="card-body">
        <div className="d-flex align-items-center justify-content-between mb-2">
          <div className="fw-semibold d-flex align-items-center gap-2">
            <i aria-hidden="true" className={`bi ${gate === 'Exit' ? 'bi-box-arrow-right' : 'bi-box-arrow-in-right'} text-primary`} />
            {gateLabel(gate)} Bariyeri
          </div>
          <span className={`badge rounded-pill barrier-state ${open ? 'text-bg-success' : 'text-bg-secondary'}`}>
            {open ? 'AÇIK' : 'KAPALI'}
          </span>
        </div>

        <svg viewBox="0 0 220 90" className="barrier-svg" aria-hidden="true">
          <rect x="0" y="80" width="220" height="10" rx="3" className="barrier-ground" />
          <rect x="16" y="30" width="26" height="52" rx="5" className="barrier-post" />
          <circle cx="29" cy="40" r="5" className="barrier-light" />
          <g className="barrier-arm">
            <rect x="29" y="34" width="180" height="12" rx="6" className="barrier-pole" />
            {[0, 1, 2, 3, 4].map((i) => (
              <rect key={i} x={50 + i * 34} y="34" width="16" height="12" className="barrier-stripe" />
            ))}
          </g>
          <circle cx="29" cy="40" r="4" className="barrier-hub" />
        </svg>

        {event ? (
          <div className="mt-2" ref={readRef}>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <PlateBadge plate={event.plate} size="sm" />
              <span className={`badge text-bg-${info.variant}`}>
                <i aria-hidden="true" className={`bi ${info.icon} me-1`} />
                {info.label}
              </span>
              <span className="text-secondary small ms-auto">{formatTime(event.createdAt, true)}</span>
            </div>
            {event.message && <div className="small mt-1 text-truncate" title={event.message}>{event.message}</div>}
          </div>
        ) : (
          <div className="text-secondary small mt-2">Henüz geçiş yok.</div>
        )}
      </div>
    </div>
  );
}
