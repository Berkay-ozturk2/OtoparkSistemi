import { useEffect, useState } from 'react';
import Modal from './Modal';
import { resolveViolation } from '../api/operator';
import { useToast } from './Toast';
import { formatDateTime } from '../utils/format';

/**
 * İhlali kapatma penceresi: "Çözüldü" veya "Yanlış alarm" + not.
 * POST /api/operator/violations/{id}/resolve { status, note }
 */
export default function ViolationResolveModal({ violation, initialStatus = 'Resolved', onClose, onResolved }) {
  const toast = useToast();
  const [status, setStatus] = useState(initialStatus);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (violation) {
      setStatus(initialStatus);
      setNote('');
    }
  }, [violation, initialStatus]);

  const submit = async () => {
    setBusy(true);
    try {
      await resolveViolation(violation.id, { status, note: note.trim() || null });
      toast.success(status === 'FalseAlarm' ? 'İhlal yanlış alarm olarak kapatıldı.' : 'İhlal çözüldü olarak işaretlendi.');
      onResolved?.(violation, status);
      onClose?.();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      show={!!violation}
      title="İhlali kapat"
      icon="bi-exclamation-diamond"
      onClose={busy ? undefined : onClose}
      staticBackdrop={busy}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>
            Vazgeç
          </button>
          <button type="button" className={`btn ${status === 'FalseAlarm' ? 'btn-secondary' : 'btn-success'}`} onClick={submit} disabled={busy}>
            {busy && <span className="spinner-border spinner-border-sm me-2" />}
            {status === 'FalseAlarm' ? 'Yanlış alarm olarak kapat' : 'Çözüldü olarak kapat'}
          </button>
        </>
      }
    >
      {violation && (
        <>
          <p className="mb-3">
            <strong>{violation.lotName || violation.lotCode}</strong> · <strong>{violation.slotCode}</strong> engelli cebi
            {violation.zoneCode && <> ({violation.zoneCode} bölgesi)</>} — tespit: {formatDateTime(violation.detectedAt)}
          </p>
          <div className="btn-group w-100 mb-3" role="group">
            <input type="radio" className="btn-check" id="vr-resolved" checked={status === 'Resolved'} onChange={() => setStatus('Resolved')} />
            <label className="btn btn-outline-success" htmlFor="vr-resolved">
              <i className="bi bi-check-circle me-1" />
              Çözüldü
            </label>
            <input type="radio" className="btn-check" id="vr-false" checked={status === 'FalseAlarm'} onChange={() => setStatus('FalseAlarm')} />
            <label className="btn btn-outline-secondary" htmlFor="vr-false">
              <i className="bi bi-bell-slash me-1" />
              Yanlış alarm
            </label>
          </div>
          <div className="form-text mb-2">
            {status === 'FalseAlarm'
              ? 'Araç izinli olduğu hâlde oturum eşleşmediyse (ör. plaka okunamadı) yanlış alarm seçin.'
              : 'Araç sahibi uyarıldı / araç taşındı / ceza işlemi yapıldı ise çözüldü seçin.'}
          </div>
          <label htmlFor="vr-note" className="form-label fw-semibold">
            Not <span className="text-secondary fw-normal">(isteğe bağlı)</span>
          </label>
          <textarea id="vr-note" className="form-control" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </>
      )}
    </Modal>
  );
}
