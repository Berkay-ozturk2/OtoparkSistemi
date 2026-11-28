import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bootstrap görünümlü, React ile kontrol edilen modal (bootstrap JS gerekmez).
 * Erişilebilirlik: açılınca odak pencereye taşınır, Tab pencere içinde döner, kapanınca odak geri döner.
 * size: undefined | 'sm' | 'lg' | 'xl'
 */
export default function Modal({ show, title, icon, onClose, children, footer, size, staticBackdrop = false }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Odak: aç → ilk alan, kapat → açan öğe
  useEffect(() => {
    if (!show) return undefined;
    const opener = document.activeElement;
    const root = dialogRef.current;
    const first = root?.querySelector(`.modal-body ${FOCUSABLE}`) || root?.querySelector(FOCUSABLE);
    (first || root)?.focus();
    document.body.classList.add('modal-open');
    return () => {
      document.body.classList.remove('modal-open');
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
  }, [show]);

  useEffect(() => {
    if (!show) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !staticBackdrop) {
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [show, staticBackdrop]);

  if (!show) return null;

  return createPortal(
    <>
      <div
        ref={dialogRef}
        className="modal fade show d-block"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !staticBackdrop) onClose?.();
        }}
      >
        <div className={`modal-dialog modal-dialog-centered modal-dialog-scrollable ${size ? `modal-${size}` : ''}`}>
          <div className="modal-content border-0 shadow-lg">
            <div className="modal-header">
              <h2 id={titleId} className="modal-title h5 d-flex align-items-center gap-2">
                {icon && <i className={`bi ${icon} text-primary`} aria-hidden="true" />}
                {title}
              </h2>
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
