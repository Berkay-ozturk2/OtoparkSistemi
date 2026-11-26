import PlateBadge from './PlateBadge';
import { decisionInfo, formatTime, gateLabel } from '../utils/format';

/**
 * Animasyonlu bariyer göstergesi.
 *  gate   : 'Entry' | 'Exit'
 *  open   : bool (Allowed → AÇIK)
 *  event  : son GateEvent (plaka, karar, mesaj)
 */
export default function BarrierIndicator({ gate = 'Entry', open = false, event, size = 'md', className = '' }) {
  const info = event ? decisionInfo(event.decision) : null;
  return (
    <div className={`card barrier-card barrier-${size} ${open ? 'is-open' : 'is-closed'} ${className}`}>
      <div className="card-body">
        <div className="d-flex align-items-center justify-content-between mb-2">
          <div className="fw-semibold d-flex align-items-center gap-2">
            <i className={`bi ${gate === 'Exit' ? 'bi-box-arrow-right' : 'bi-box-arrow-in-right'} text-primary`} />
            {gateLabel(gate)} Bariyeri
          </div>
          <span className={`badge rounded-pill barrier-state ${open ? 'text-bg-success' : 'text-bg-secondary'}`}>
            {open ? 'AÇIK' : 'KAPALI'}
          </span>
        </div>

        <svg viewBox="0 0 220 90" className="barrier-svg" aria-hidden="true">
          <rect x="0" y="80" width="220" height="10" rx="3" fill="#cbd5e1" />
          <rect x="16" y="30" width="26" height="52" rx="5" fill="#13315c" />
          <circle cx="29" cy="40" r="5" className="barrier-light" />
          <g className="barrier-arm">
            <rect x="29" y="34" width="180" height="12" rx="6" fill="#fff" stroke="#94a3b8" />
            {[0, 1, 2, 3, 4].map((i) => (
              <rect key={i} x={50 + i * 34} y="34" width="16" height="12" fill="#ef4444" />
            ))}
          </g>
          <circle cx="29" cy="40" r="4" fill="#0b2545" />
        </svg>

        {event ? (
          <div className="mt-2">
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <PlateBadge plate={event.plate} size="sm" />
              <span className={`badge text-bg-${info.variant}`}>
                <i className={`bi ${info.icon} me-1`} />
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
