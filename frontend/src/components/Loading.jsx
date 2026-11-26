/** Yükleme göstergesi. inline=true ise satır içi küçük spinner. */
export default function Loading({ text = 'Yükleniyor…', inline = false, className = '' }) {
  if (inline) {
    return (
      <span className={`d-inline-flex align-items-center gap-2 text-secondary ${className}`}>
        <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
        <span>{text}</span>
      </span>
    );
  }
  return (
    <div className={`loading-block text-center text-secondary py-5 ${className}`} role="status">
      <div className="spinner-border text-primary mb-3" style={{ width: '2.5rem', height: '2.5rem' }} aria-hidden="true" />
      <div>{text}</div>
    </div>
  );
}
