import { addDays, toDateInput } from '../utils/format';

export const PRESETS = [
  { key: 'today', label: 'Bugün', days: 0 },
  { key: '7', label: 'Son 7 gün', days: 6 },
  { key: '30', label: 'Son 30 gün', days: 29 },
  { key: '90', label: 'Son 90 gün', days: 89 },
];

export function presetRange(days) {
  const today = new Date();
  return { from: toDateInput(addDays(today, -days)), to: toDateInput(today) };
}

/** Rapor sayfaları için tarih aralığı seçici */
export default function DateRangeBar({ from, to, onChange, onSubmit, busy, children }) {
  const invalid = from && to && from > to;
  return (
    <form
      className="card mb-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) onSubmit();
      }}
    >
      <div className="card-body">
        <div className="row g-2 align-items-end">
          <div className="col-6 col-md-3 col-xl-2">
            <label className="form-label small fw-semibold mb-1" htmlFor="dr-from">
              Başlangıç
            </label>
            <input id="dr-from" type="date" className={`form-control ${invalid ? 'is-invalid' : ''}`} value={from} max={to} onChange={(e) => onChange({ from: e.target.value, to })} />
          </div>
          <div className="col-6 col-md-3 col-xl-2">
            <label className="form-label small fw-semibold mb-1" htmlFor="dr-to">
              Bitiş
            </label>
            <input id="dr-to" type="date" className={`form-control ${invalid ? 'is-invalid' : ''}`} value={to} min={from} onChange={(e) => onChange({ from, to: e.target.value })} />
          </div>
          {children}
          <div className="col-12 col-md-auto">
            <button type="submit" className="btn btn-primary w-100" disabled={busy || invalid}>
              {busy ? <span className="spinner-border spinner-border-sm me-2" /> : <i aria-hidden="true" className="bi bi-funnel me-2" />}
              Raporla
            </button>
          </div>
          <div className="col-12 col-xl d-flex flex-wrap gap-1 justify-content-xl-end">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => {
                  const r = presetRange(p.days);
                  onChange(r);
                  onSubmit(r);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {invalid && <div className="text-danger small mt-2">Başlangıç tarihi bitiş tarihinden sonra olamaz.</div>}
      </div>
    </form>
  );
}
