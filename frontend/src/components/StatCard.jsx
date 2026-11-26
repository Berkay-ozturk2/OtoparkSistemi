/**
 * Özet kartı.
 * variant: 'primary' | 'teal' | 'success' | 'danger' | 'warning' | 'info' | 'secondary'
 */
export default function StatCard({ icon = 'bi-bar-chart', label, value, sub, variant = 'primary', size = 'md', loading = false, children, className = '' }) {
  return (
    <div className={`card stat-card stat-${variant} stat-size-${size} h-100 ${className}`}>
      <div className="card-body d-flex align-items-center gap-3">
        <div className="stat-icon flex-shrink-0">
          <i className={`bi ${icon}`} />
        </div>
        <div className="flex-grow-1 min-w-0">
          <div className="stat-label text-truncate">{label}</div>
          <div className="stat-value">
            {loading ? <span className="placeholder-glow"><span className="placeholder col-6" /></span> : value}
          </div>
          {sub && <div className="stat-sub text-truncate">{sub}</div>}
          {children}
        </div>
      </div>
    </div>
  );
}
