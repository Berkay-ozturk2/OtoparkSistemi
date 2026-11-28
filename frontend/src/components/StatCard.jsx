import AnimatedNumber from './AnimatedNumber';

/**
 * Özet kartı.
 * variant: 'primary' | 'teal' | 'success' | 'danger' | 'warning' | 'info' | 'secondary'
 * value sayıysa değişimde eski değerden yenisine sayar (azaltılmış harekette anında).
 */
export default function StatCard({ icon = 'bi-bar-chart', label, value, sub, variant = 'primary', size = 'md', loading = false, children, className = '' }) {
  const shown = typeof value === 'number' && Number.isFinite(value) ? <AnimatedNumber value={value} /> : value;
  return (
    <div className={`card stat-card stat-${variant} stat-size-${size} h-100 ${className}`}>
      <div className="card-body d-flex align-items-center gap-3">
        <div className="stat-icon flex-shrink-0" aria-hidden="true">
          <i aria-hidden="true" className={`bi ${icon}`} />
        </div>
        <div className="flex-grow-1 min-w-0">
          <div className="stat-label text-truncate">{label}</div>
          <div className="stat-value">
            {loading ? (
              <span className="placeholder-glow">
                <span className="placeholder col-6" />
                <span className="visually-hidden">Yükleniyor…</span>
              </span>
            ) : (
              shown
            )}
          </div>
          {sub && <div className="stat-sub text-truncate">{sub}</div>}
          {children}
        </div>
      </div>
    </div>
  );
}
