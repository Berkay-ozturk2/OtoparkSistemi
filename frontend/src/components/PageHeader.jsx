/** Sayfa başlığı: ikon + başlık + açıklama + sağda eylemler */
export default function PageHeader({ icon, title, subtitle, actions, badge }) {
  return (
    <div className="page-header d-flex flex-wrap align-items-center justify-content-between gap-3 mb-4">
      <div className="d-flex align-items-center gap-3 min-w-0">
        {icon && (
          <div className="page-header-icon flex-shrink-0">
            <i className={`bi ${icon}`} />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="h3 mb-0 d-flex align-items-center gap-2 flex-wrap">
            {title}
            {badge}
          </h1>
          {subtitle && <div className="text-secondary small mt-1">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="d-flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
