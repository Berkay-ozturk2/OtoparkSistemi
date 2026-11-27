import PlateBadge from '../PlateBadge';
import { formatTime, formatDate } from '../../utils/format';

const isToday = (v) => new Date(v).toDateString() === new Date().toDateString();

/**
 * Son giriş-çıkış kayıtları: saat, yön, plaka, blok.
 * Yön hem okla hem metinle gösterilir; reddedilen / onay bekleyen geçişler ayrıca işaretlenir.
 */
export default function RecentGateEvents({ events, showLot = false }) {
  if (!events || events.length === 0) {
    return (
      <div className="pending-empty">
        <i className="bi bi-sign-turn-right" aria-hidden="true" />
        <span>Henüz giriş-çıkış kaydı yok.</span>
      </div>
    );
  }

  return (
    <div className="table-responsive">
      <table className="table table-sm gate-log mb-0">
        <thead>
          <tr>
            <th scope="col">Saat</th>
            <th scope="col">Yön</th>
            <th scope="col">Plaka</th>
            <th scope="col" className="text-end">
              Blok
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => {
            const exit = ev.gate === 'Exit';
            const flagged = ev.decision === 'Denied' || ev.decision === 'PendingReview';
            return (
              <tr key={ev.id} className={flagged ? 'gate-flagged' : ''}>
                <td className="gate-time">
                  {formatTime(ev.createdAt)}
                  {!isToday(ev.createdAt) && <span className="gate-day">{formatDate(ev.createdAt)}</span>}
                </td>
                <td>
                  <span className={`gate-dir ${exit ? 'gate-exit' : 'gate-entry'}`}>
                    <i className={`bi ${exit ? 'bi-box-arrow-right' : 'bi-box-arrow-in-right'}`} aria-hidden="true" />
                    <span className="gate-dir-text">{exit ? 'Çıkış' : 'Giriş'}</span>
                  </span>
                  {ev.decision === 'Denied' && <span className="gate-note">reddedildi</span>}
                  {ev.decision === 'PendingReview' && <span className="gate-note">onay bekliyor</span>}
                </td>
                <td>
                  <PlateBadge plate={ev.plate} size="sm" />
                  {showLot && ev.lotCode && <span className="gate-lot">{ev.lotCode}</span>}
                </td>
                <td className="text-end">
                  {ev.zoneCode ? <span className="gate-block">{ev.zoneCode}</span> : <span className="text-secondary">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
