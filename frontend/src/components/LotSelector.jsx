import { useEffect, useRef, useState } from 'react';
import { useLot } from '../lot/LotContext';
import { formatPercent } from '../utils/format';

/** Boş yer rozeti rengi: 0 → kırmızı, az → sarı, aksi → yeşil */
export function freeBadgeClass(free, total) {
  if (free == null) return 'text-bg-secondary';
  if (free <= 0) return 'text-bg-danger';
  if (total && free / total < 0.15) return 'text-bg-warning';
  return 'text-bg-success';
}

/**
 * Otopark seçici (açılır menü): ad + boş yer rozeti + ♿ boş engelli yer.
 *
 *  value / onChange : verilirse kontrollü çalışır (filtreler için); verilmezse genel seçili otoparkı (LotContext) değiştirir
 *  allowAll         : "Tüm otoparklar" seçeneği ekler (değer '')
 *  variant          : 'navbar' (koyu zemin) | 'light' (kart/sayfa içinde)
 *  includeInactive  : verilen `lots` listesini kullan (ör. yönetici listesi, pasifler dâhil)
 */
export default function LotSelector({
  value,
  onChange,
  allowAll = false,
  allLabel = 'Tüm otoparklar',
  variant = 'light',
  size = 'sm',
  lots: lotsOverride,
  className = '',
  align = 'end',
  label,
}) {
  const ctx = useLot();
  const lots = lotsOverride || ctx.lots;
  const controlled = typeof onChange === 'function';
  const selected = controlled ? value ?? '' : ctx.lotCode;
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (code) => {
    if (controlled) onChange(code);
    else ctx.setLotCode(code);
    setOpen(false);
  };

  const current = lots.find((l) => l.code === selected);
  const isAll = allowAll && !selected;
  const btnName = isAll ? allLabel : current?.name || selected || 'Otopark seçin';

  return (
    <div className={`dropdown lot-selector lot-selector-${variant} ${open ? 'show' : ''} ${className}`} ref={ref}>
      <button
        type="button"
        className={`btn btn-${size} lot-selector-btn d-flex align-items-center gap-2 text-start`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        title="Otopark seçin"
      >
        <i className={`bi ${isAll ? 'bi-collection' : 'bi-buildings'} flex-shrink-0`} />
        <span className="d-flex flex-column lh-sm min-w-0">
          {label && <span className="lot-selector-label">{label}</span>}
          <span className="fw-semibold text-truncate lot-selector-name">{btnName}</span>
        </span>
        {!isAll && current && (
          <span className="d-inline-flex gap-1 flex-shrink-0">
            <span className={`badge rounded-pill ${freeBadgeClass(current.freeSlots, current.totalSlots)}`} title="Normal araçlar için boş yer">
              {current.freeSlots ?? '—'} boş
            </span>
            {current.disabledTotal > 0 && (
              <span className="badge rounded-pill badge-disabled" title="Boş engelli park yeri">
                <span aria-hidden="true">♿</span> {current.disabledFree ?? 0}
              </span>
            )}
          </span>
        )}
        <i className="bi bi-chevron-down small ms-auto flex-shrink-0" />
      </button>

      <ul className={`dropdown-menu ${align === 'end' ? 'dropdown-menu-end' : ''} shadow lot-selector-menu ${open ? 'show' : ''}`} role="listbox">
        {allowAll && (
          <li>
            <button type="button" className={`dropdown-item d-flex align-items-center gap-2 ${isAll ? 'active' : ''}`} onClick={() => pick('')}>
              <i className="bi bi-collection" />
              <span className="fw-semibold">{allLabel}</span>
            </button>
          </li>
        )}
        {allowAll && lots.length > 0 && (
          <li>
            <hr className="dropdown-divider" />
          </li>
        )}
        {lots.length === 0 && <li className="px-3 py-2 small text-secondary">Otopark listesi alınamadı.</li>}
        {lots.map((l) => {
          const rate = l.occupancyRate ?? (l.totalSlots ? 1 - (l.freeSlots ?? 0) / l.totalSlots : 0);
          const active = l.code === selected;
          return (
            <li key={l.code}>
              <button
                type="button"
                role="option"
                aria-selected={active}
                className={`dropdown-item lot-option ${active ? 'active' : ''} ${l.isActive === false ? 'opacity-75' : ''}`}
                onClick={() => pick(l.code)}
              >
                <div className="d-flex align-items-center gap-2">
                  <span className="fw-semibold text-truncate">{l.name}</span>
                  {l.isActive === false && <span className="badge text-bg-secondary">Pasif</span>}
                  <span className="ms-auto d-inline-flex gap-1">
                    <span className={`badge rounded-pill ${freeBadgeClass(l.freeSlots, l.totalSlots)}`}>{l.freeSlots ?? '—'} boş</span>
                    {l.disabledTotal > 0 && (
                      <span className="badge rounded-pill badge-disabled">
                        <span aria-hidden="true">♿</span> {l.disabledFree ?? 0}
                      </span>
                    )}
                  </span>
                </div>
                {l.address && <div className="small lot-option-sub text-truncate">{l.address}</div>}
                {l.totalSlots > 0 && (
                  <div className="d-flex align-items-center gap-2 mt-1">
                    <div className="progress lot-mini-progress flex-grow-1">
                      <div
                        className={`progress-bar ${rate >= 0.9 ? 'bg-danger' : rate >= 0.6 ? 'bg-warning' : 'bg-success'}`}
                        style={{ width: `${Math.round(rate * 100)}%` }}
                      />
                    </div>
                    <span className="small lot-option-sub">{formatPercent(rate)}</span>
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
