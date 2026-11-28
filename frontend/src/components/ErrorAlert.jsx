/**
 * Hata kutusu. error: string | Error | ApiError
 * Ağ hatasında (status 0) "Sunucuya ulaşılamıyor" vurgusu yapılır.
 */
export default function ErrorAlert({ error, onRetry, onClose, className = '', title }) {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error.message || 'Beklenmeyen bir sorun oluştu. Sayfayı yenileyip tekrar deneyin.';
  const isNetwork = typeof error === 'object' && error.status === 0;

  return (
    <div className={`alert ${isNetwork ? 'alert-warning' : 'alert-danger'} d-flex align-items-start gap-3 ${className}`} role="alert">
      <i aria-hidden="true" className={`bi ${isNetwork ? 'bi-wifi-off' : 'bi-exclamation-triangle-fill'} fs-4 flex-shrink-0`} />
      <div className="flex-grow-1">
        {(title || isNetwork) && <div className="fw-semibold">{title || 'Sunucuya ulaşılamıyor'}</div>}
        <div>{message}</div>
        {onRetry && (
          <button type="button" className="btn btn-sm btn-outline-dark mt-2" onClick={onRetry}>
            <i aria-hidden="true" className="bi bi-arrow-clockwise me-1" />
            Tekrar dene
          </button>
        )}
      </div>
      {onClose && <button type="button" className="btn-close" aria-label="Kapat" onClick={onClose} />}
    </div>
  );
}
