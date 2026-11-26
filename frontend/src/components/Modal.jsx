import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Bootstrap görünümlü, React ile kontrol edilen modal (bootstrap JS gerekmez).
 * size: undefined | 'sm' | 'lg' | 'xl'
 */
export default function Modal({ show, title, icon, onClose, children, footer, size, staticBackdrop = false }) {
  useEffect(() => {
    if (!show) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !staticBackdrop) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [show, onClose, staticBackdrop]);

  if (!show) return null;

  return createPortal(
    <>
      <div
        className="modal fade show d-block"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !staticBackdrop) onClose?.();
        }}
      >
        <div className={`modal-dialog modal-dialog-centered modal-dialog-scrollable ${size ? `modal-${size}` : ''}`}>
          <div className="modal-content border-0 shadow-lg">
            <div className="modal-header">
              <h5 className="modal-title d-flex align-items-center gap-2">
                {icon && <i className={`bi ${icon} text-primary`} />}
                {title}
              </h5>
              {onClose && <button type="button" className="btn-close" aria-label="Kapat" onClick={onClose} />}
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-footer">{footer}</div>}
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" />
    </>,
    document.body,
  );
}
