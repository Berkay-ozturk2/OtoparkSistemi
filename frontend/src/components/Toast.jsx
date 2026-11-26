import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);

const ICONS = {
  success: 'bi-check-circle-fill',
  danger: 'bi-x-circle-fill',
  warning: 'bi-exclamation-triangle-fill',
  info: 'bi-info-circle-fill',
};

/** Basit bildirim (toast) sağlayıcısı */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message, variant = 'success', timeout = 4000) => {
      idRef.current += 1;
      const id = idRef.current;
      setToasts((list) => [...list.slice(-4), { id, message, variant }]);
      if (timeout) setTimeout(() => dismiss(id), timeout);
      return id;
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      show,
      success: (m) => show(m, 'success'),
      error: (m) => show(typeof m === 'string' ? m : m?.message || 'Hata oluştu', 'danger', 6000),
      warning: (m) => show(m, 'warning'),
      info: (m) => show(m, 'info'),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container position-fixed bottom-0 end-0 p-3" style={{ zIndex: 1100 }}>
        {toasts.map((t) => (
          <div key={t.id} className={`toast show app-toast toast-${t.variant}`} role="status" aria-live="polite">
            <div className="d-flex align-items-center p-3 gap-2">
              <i className={`bi ${ICONS[t.variant] || ICONS.info} fs-5`} />
              <div className="flex-grow-1">{t.message}</div>
              <button type="button" className="btn-close ms-2" aria-label="Kapat" onClick={() => dismiss(t.id)} />
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast, ToastProvider içinde kullanılmalıdır.');
  return ctx;
}
