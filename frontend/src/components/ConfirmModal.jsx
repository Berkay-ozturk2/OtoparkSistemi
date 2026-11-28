import Modal from './Modal';

/** Onay penceresi */
export default function ConfirmModal({
  show,
  title = 'İşlemi onaylayın',
  children,
  message,
  confirmText = 'Onayla',
  cancelText = 'Vazgeç',
  variant = 'primary',
  icon = 'bi-question-circle',
  busy = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      show={show}
      title={title}
      icon={icon}
      onClose={busy ? undefined : onCancel}
      staticBackdrop={busy}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onCancel} disabled={busy}>
            {cancelText}
          </button>
          <button type="button" className={`btn btn-${variant}`} onClick={onConfirm} disabled={busy}>
            {busy && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}
            {confirmText}
          </button>
        </>
      }
    >
      {message && <p className="mb-0">{message}</p>}
      {children}
    </Modal>
  );
}
