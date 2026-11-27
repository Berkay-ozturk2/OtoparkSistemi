import { useMemo } from 'react';
import { formatPercent } from '../../utils/format';

const naturalCode = (a, b) => String(a).localeCompare(String(b), 'tr', { numeric: true });

/** Cepleri bölgeye (bloğa) göre gruplar; sayılar canlı cep listesinden hesaplanır. */
function groupByBlock(slots, zones) {
  const byCode = new Map();
  (zones || []).forEach((z) => byCode.set(z.code, { code: z.code, name: z.name, floor: z.floor, slots: [] }));
  (slots || []).forEach((s) => {
    const code = s.zoneCode || String(s.code || '?').charAt(0);
    if (!byCode.has(code)) byCode.set(code, { code, name: `${code} bloğu`, floor: s.floor, slots: [] });
    byCode.get(code).slots.push(s);
  });
  return Array.from(byCode.values())
    .map((b) => {
      const ordered = [...b.slots].sort((x, y) => naturalCode(x.code, y.code));
      const active = ordered.filter((s) => s.isActive !== false);
      const occupied = active.filter((s) => s.isOccupied).length;
      const reserved = active.filter((s) => !s.isOccupied && s.isReserved).length;
      const disabled = active.filter((s) => s.type === 'Disabled');
      return {
        ...b,
        slots: ordered,
        total: active.length,
        occupied,
        reserved,
        free: active.length - occupied - reserved,
        disabledTotal: disabled.length,
        disabledFree: disabled.filter((s) => !s.isOccupied && !s.isReserved).length,
        rate: active.length ? occupied / active.length : 0,
      };
    })
    .filter((b) => b.slots.length > 0)
    .sort((a, b) => (a.floor ?? 0) - (b.floor ?? 0) || naturalCode(a.code, b.code));
}

function cellState(s) {
  if (s.isActive === false) return 'inactive';
  if (s.isOccupied) return 'occupied';
  if (s.isReserved) return 'reserved';
  return 'free';
}

/**
 * Blok doluluğu: her blok için yüzde, sayılar ve bloktaki ceplerin sırasıyla çizildiği şerit.
 * Şeritte renk tek işaret değildir: boş = içi boş çerçeve, dolu = dolu kutu, rezerve = çizgili, kapalı = soluk tarama.
 */
export default function BlockOccupancy({ slots, zones, floorName, selected, onSelect, loading }) {
  const blocks = useMemo(() => groupByBlock(slots, zones), [slots, zones]);

  if (loading && blocks.length === 0) {
    return (
      <div className="block-grid" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="block-card block-card-skeleton" />
        ))}
      </div>
    );
  }

  if (blocks.length === 0) {
    return <p className="text-secondary mb-0">Bu otopark için blok bilgisi yok. Otoparklar ve Kroki ekranından cep ekleyebilirsiniz.</p>;
  }

  return (
    <div className="block-grid">
      {blocks.map((b) => {
        const level = b.rate >= 0.9 ? 'full' : b.rate >= 0.7 ? 'busy' : 'ok';
        const isSel = selected === b.code;
        return (
          <button
            key={b.code}
            type="button"
            className={`block-card block-${level} ${isSel ? 'is-selected' : ''}`}
            onClick={() => onSelect?.(isSel ? null : b.code)}
            aria-pressed={isSel}
            aria-label={`${b.name}: yüzde ${Math.round(b.rate * 100)} dolu, ${b.occupied} dolu, ${b.free} boş${b.reserved ? `, ${b.reserved} rezerve` : ''}. Krokide göstermek için seçin.`}
          >
            <span className="block-head">
              <span className="block-letter" aria-hidden="true">
                {b.code}
              </span>
              <span className="block-title">
                <span className="block-name">{b.name}</span>
                {floorName && <span className="block-floor">{floorName(b.floor)}</span>}
              </span>
              <span className="block-rate">
                {formatPercent(b.rate)}
                {level === 'full' && <span className="block-rate-note">dolmak üzere</span>}
              </span>
            </span>

            <span className="bay-strip" aria-hidden="true">
              {b.slots.map((s) => (
                <span key={s.code} className={`bay bay-${cellState(s)} ${s.type === 'Disabled' ? 'bay-disabled' : ''}`} />
              ))}
            </span>

            <span className="block-counts">
              <span>
                <strong>{b.occupied}</strong> dolu
              </span>
              <span>
                <strong>{b.free}</strong> boş
              </span>
              {b.reserved > 0 && (
                <span>
                  <strong>{b.reserved}</strong> rezerve
                </span>
              )}
              {b.disabledTotal > 0 && (
                <span className="block-counts-disabled" title="Boş engelli cebi / toplam engelli cebi">
                  <i className="bi bi-person-wheelchair" aria-hidden="true" /> {b.disabledFree}/{b.disabledTotal}
                </span>
              )}
              <span className="block-total">{b.total} cep</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
