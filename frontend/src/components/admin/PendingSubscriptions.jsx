import PlateBadge from '../PlateBadge';
import { formatCurrency, formatDate, planLabel, timeAgo } from '../../utils/format';

/**
 * Bekleyen abonelik başvuruları: her satırda onayla / reddet.
 * Dar ekranda satır, bilgiler üstte ve düğmeler altta olacak şekilde kırılır.
 */
export default function PendingSubscriptions({ items, busyId, onApprove, onReject, emptyText = 'Bekleyen başvuru yok.' }) {
  if (!items || items.length === 0) {
    return (
      <div className="pending-empty">
        <i className="bi bi-inbox" aria-hidden="true" />
        <span>{emptyText}</span>
      </div>
    );
  }

  return (
    <ul className="pending-list" aria-label="Bekleyen abonelik başvuruları">
      {items.map((s) => {
        const busy = busyId === s.id;
        return (
          <li key={s.id} className={`pending-row ${busy ? 'is-busy' : ''}`}>
            <div className="pending-main">
              <PlateBadge plate={s.plate} size="sm" />
              <div className="pending-who min-w-0">
                <div className="fw-semibold text-truncate">{s.holderName}</div>
                <div className="pending-meta">
                  <span>{s.lotName}</span>
                  <span>{formatDate(s.startDate)} başlangıç</span>
                  <span title={new Date(s.createdAt).toLocaleString('tr-TR')}>{timeAgo(s.createdAt)} başvurdu</span>
                </div>
              </div>
              <div className="pending-plan">
                <span className={`plan-tag plan-${s.plan === 'Yearly' ? 'yearly' : 'monthly'}`}>{planLabel(s.plan)}</span>
                <span className="pending-price">{formatCurrency(s.price)}</span>
              </div>
            </div>
            <div className="pending-actions">
              <button type="button" className="btn btn-sm btn-light" onClick={() => onReject(s)} disabled={busy}>
                <i className="bi bi-x-lg me-1" aria-hidden="true" />
                Reddet
              </button>
              <button type="button" className="btn btn-sm btn-success" onClick={() => onApprove(s)} disabled={busy}>
                {busy ? (
                  <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />
                ) : (
                  <i className="bi bi-check-lg me-1" aria-hidden="true" />
                )}
                Onayla
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
