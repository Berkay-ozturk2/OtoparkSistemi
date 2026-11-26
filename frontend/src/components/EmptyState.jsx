/** Boş liste / sonuç yok durumu */
export default function EmptyState({ icon = 'bi-inbox', title = 'Kayıt bulunamadı', children, action, className = '' }) {
  return (
    <div className={`empty-state text-center py-5 px-3 ${className}`}>
      <div className="empty-icon mb-3">
        <i className={`bi ${icon}`} />
      </div>
      <div className="fw-semibold fs-5">{title}</div>
      {children && <div className="text-secondary mt-1">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
