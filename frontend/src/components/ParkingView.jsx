import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import ParkingMap, { STATE_LABEL, isDisabledSlot, slotGeometry, slotState } from './ParkingMap';
import SlotDetailCard from './SlotDetailCard';
import Loading from './Loading';
import { isLowEndDevice, webglAvailable } from '../utils/webgl';

// three.js yalnızca 3D açılınca indirilir (2D yedeğe düşen cihaz bu yükü hiç almaz)
const ParkingMap3D = lazy(() => import('./ParkingMap3D'));

const MODE_KEY = 'akillipark_map_mode';
const PAD = 14;

function readMode() {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === '2d' || v === '3d' ? v : null;
  } catch {
    return null;
  }
}

function storeMode(v) {
  try {
    localStorage.setItem(MODE_KEY, v);
  } catch {
    // gizli pencere: yok say
  }
}

/** 3D parçası yüklenemez / çökerse 2D'ye düşmek için */
class Map3DBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err) {
    this.props.onError?.(err);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const FALLBACK_TEXT = {
  nowebgl: 'Bu cihaz veya tarayıcı WebGL desteklemediği için 2D kroki gösteriliyor.',
  slow: (fps) => `3D görünüm bu cihazda yavaş çalıştı (~${fps} FPS); akıcı kullanım için 2D krokiye geçildi.`,
  error: '3D görünüm başlatılamadı; 2D kroki gösteriliyor.',
  lowend: 'Düşük donanımlı cihaz algılandı; 2D kroki gösteriliyor.',
};

/**
 * Otopark krokisi: 3D (three.js) + 2D (SVG) yedek, kat ve blok seçimi, park yeri detay kartı.
 *  canManage  : görevli/yönetici → detay kartında plaka, giriş saati ve araç atama
 *  onOverride : (slot) => void — "Durumu düzelt"
 *  onSlotsPatched : (code, patch) => void — atama sonrası canlı listeyi anında güncellemek için
 */
export default function ParkingView({
  lot,
  lotCode,
  slots = [],
  zones = [],
  recommendedZone,
  highlightSlot,
  violationSlots,
  canManage = false,
  onOverride,
  onSlotsPatched,
}) {
  const canWebGL = useMemo(() => webglAvailable(), []);
  const [mode, setMode] = useState(() => {
    if (!canWebGL) return '2d';
    const stored = readMode();
    if (stored) return stored;
    return isLowEndDevice() ? '2d' : '3d';
  });
  const [fallback, setFallback] = useState(() => {
    if (!canWebGL) return { reason: 'nowebgl' };
    if (!readMode() && isLowEndDevice()) return { reason: 'lowend' };
    return null;
  });
  const [floorState, setFloorState] = useState(null);
  const [blockCode, setBlockCode] = useState('');
  const [selectedCode, setSelectedCode] = useState(null);

  const viewW = Number(lot?.mapWidth) > 0 ? Number(lot.mapWidth) : 1000;
  const viewH = Number(lot?.mapHeight) > 0 ? Number(lot.mapHeight) : 600;
  const lotKey = lot?.code || lotCode;

  // Otopark değişince seçim/blok/kat sıfırlanır
  useEffect(() => {
    setFloorState(null);
    setBlockCode('');
    setSelectedCode(null);
  }, [lotKey]);

  const zoneByCode = useMemo(() => Object.fromEntries(zones.map((z) => [z.code, z])), [zones]);
  const floorOf = useCallback(
    (s) => (s.floor != null ? Number(s.floor) : Number(zoneByCode[s.zoneCode]?.floor ?? 0)),
    [zoneByCode],
  );

  const floors = useMemo(() => {
    if (Array.isArray(lot?.floors) && lot.floors.length) {
      return lot.floors.map((f) => ({ floor: Number(f.floor), name: f.name || `Kat ${f.floor}` }));
    }
    const set = new Set(slots.map(floorOf));
    return Array.from(set)
      .sort((a, b) => a - b)
      .map((f) => ({ floor: f, name: f === 0 ? 'Zemin' : `Kat ${f}` }));
  }, [lot, slots, floorOf]);
  const multiFloor = floors.length > 1;
  const floorCodes = floors.map((f) => f.floor);

  const targetFloor = useMemo(() => {
    const s = highlightSlot && slots.find((x) => x.code === highlightSlot);
    return s ? floorOf(s) : null;
  }, [highlightSlot, slots, floorOf]);

  let floor;
  if (floorState != null && floorCodes.includes(floorState)) floor = floorState;
  else if (targetFloor != null && floorCodes.includes(targetFloor)) floor = targetFloor;
  else floor = floorCodes.includes(0) ? 0 : floorCodes[0] ?? 0;
  const floorName = (f) => floors.find((x) => x.floor === f)?.name || (f === 0 ? 'Zemin' : `Kat ${f}`);

  const violationSet = useMemo(() => new Set(violationSlots || []), [violationSlots]);

  // Aktif katın cepleri (3D için) + blok kutuları
  const { items, blocks, floorStats } = useMemo(() => {
    const list = [];
    const boxes = {};
    const perFloor = {};
    slots.forEach((s) => {
      if (!s?.code) return;
      const f = floorOf(s);
      const st = slotState(s);
      const pf = perFloor[f] || (perFloor[f] = { free: 0, disabledFree: 0 });
      if (st === 'free') {
        if (isDisabledSlot(s)) pf.disabledFree += 1;
        else pf.free += 1;
      }
      if (multiFloor && f !== floor) return;
      const g = slotGeometry(s);
      const zone = s.zoneCode || String(s.code).charAt(0);
      const b = boxes[zone] || (boxes[zone] = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, free: 0, total: 0 });
      b.minX = Math.min(b.minX, g.x - PAD);
      b.minY = Math.min(b.minY, g.y - PAD);
      b.maxX = Math.max(b.maxX, g.x + g.w + PAD);
      b.maxY = Math.max(b.maxY, g.y + g.h + PAD);
      b.total += 1;
      if (st === 'free') b.free += 1;
      list.push({ slot: s, g, zone, st, dis: isDisabledSlot(s), viol: !!s.hasViolation || violationSet.has(s.code) });
    });
    return { items: list, blocks: boxes, floorStats: perFloor };
  }, [slots, floorOf, multiFloor, floor, violationSet]);

  const decor = useMemo(() => {
    const list = Array.isArray(lot?.decor) ? lot.decor : [];
    return list.filter((d) => d && (d.floor == null || !multiFloor || Number(d.floor) === floor));
  }, [lot, multiFloor, floor]);

  const blockList = Object.entries(blocks).sort(([a], [b]) => a.localeCompare(b, 'tr'));
  const activeBlock = blockCode && blocks[blockCode] ? blockCode : '';

  const selected = selectedCode ? slots.find((s) => s.code === selectedCode) : null;
  const zoneLabel = (s) => {
    const z = zoneByCode[s.zoneCode];
    const name = z?.name || `${s.zoneCode} bölgesi`;
    return multiFloor ? `${name} · ${floorName(floorOf(s))}` : name;
  };

  const switchMode = (m) => {
    setMode(m);
    storeMode(m);
    setFallback(m === '3d' ? null : fallback?.reason === 'nowebgl' ? fallback : null);
  };

  const fallTo2D = (reason, fps) => {
    setMode('2d');
    setFallback({ reason, fps });
  };

  const selectFloor = (f) => {
    setFloorState(f);
    setBlockCode('');
  };

  const fallbackText = fallback && (fallback.reason === 'slow' ? FALLBACK_TEXT.slow(fallback.fps) : FALLBACK_TEXT[fallback.reason]);

  return (
    <div className="parking-view">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <div className="btn-group btn-group-sm" role="group" aria-label="Kroki görünümü">
          <button
            type="button"
            className={`btn ${mode === '3d' ? 'btn-accent' : 'btn-outline-secondary'}`}
            onClick={() => switchMode('3d')}
            disabled={!canWebGL}
            aria-pressed={mode === '3d'}
            title={canWebGL ? '3D görünüm' : 'Bu cihaz WebGL desteklemiyor'}
          >
            <i aria-hidden="true" className="bi bi-box me-1" />
            3D
          </button>
          <button
            type="button"
            className={`btn ${mode === '2d' ? 'btn-accent' : 'btn-outline-secondary'}`}
            onClick={() => switchMode('2d')}
            aria-pressed={mode === '2d'}
            title="2D kroki"
          >
            <i aria-hidden="true" className="bi bi-grid-3x3 me-1" />
            2D
          </button>
        </div>

        {mode === '3d' && multiFloor && (
          <ul className="nav nav-pills pm-floor-tabs flex-wrap" role="tablist" aria-label="Katlar">
            {floors.map((f) => {
              const s = floorStats[f.floor] || { free: 0, disabledFree: 0 };
              return (
                <li className="nav-item" key={f.floor}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={f.floor === floor}
                    className={`nav-link py-1 px-3 ${f.floor === floor ? 'active' : ''}`}
                    onClick={() => selectFloor(f.floor)}
                  >
                    <i aria-hidden="true" className="bi bi-layers me-1" />
                    {f.name}
                    <span className="badge rounded-pill text-bg-light ms-2">{s.free}</span>
                    {s.disabledFree > 0 && (
                      <span className="badge rounded-pill badge-disabled ms-1">
                        <span aria-hidden="true">♿</span> {s.disabledFree}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {mode === '3d' && blockList.length > 1 && (
          <div className="d-flex flex-wrap align-items-center gap-1 ms-auto" role="group" aria-label="Blok seçimi">
            <span className="small text-secondary me-1">Blok:</span>
            <button
              type="button"
              className={`btn btn-sm ${!activeBlock ? 'btn-dark' : 'btn-light border'}`}
              onClick={() => setBlockCode('')}
              aria-pressed={!activeBlock}
            >
              Tümü
            </button>
            {blockList.map(([code, b]) => (
              <button
                key={code}
                type="button"
                className={`btn btn-sm ${activeBlock === code ? 'btn-dark' : 'btn-light border'} ${recommendedZone === code ? 'pv-rec' : ''}`}
                onClick={() => setBlockCode(code)}
                aria-pressed={activeBlock === code}
                aria-label={`${zoneByCode[code]?.name || `${code} bloğu`}: ${b.free} boş, toplam ${b.total}`}
                title={`${zoneByCode[code]?.name || code} — ${b.free}/${b.total} boş`}
              >
                {code}
                <span className="ms-1 opacity-75" aria-hidden="true">
                  {b.free}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* 3D sahnede klavye ve ekran okuyucu ile park yeri seçimi (WCAG 2.1.1) */}
        {mode === '3d' && items.length > 0 && (
          <div className="pv-slot-picker">
            <label className="visually-hidden" htmlFor={`pv-slot-${lotKey}`}>
              Park yeri seç
            </label>
            <select
              id={`pv-slot-${lotKey}`}
              className="form-select form-select-sm"
              value={selectedCode || ''}
              onChange={(e) => setSelectedCode(e.target.value || null)}
            >
              <option value="">Park yeri seç…</option>
              {items.map((it) => (
                <option key={it.slot.code} value={it.slot.code}>
                  {it.slot.code} · {it.dis ? '♿ engelli · ' : ''}
                  {STATE_LABEL[it.st]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {fallbackText && mode === '2d' && (
        <div className="alert alert-info py-2 px-3 small d-flex flex-wrap align-items-center gap-2 mb-2" role="status">
          <i aria-hidden="true" className="bi bi-info-circle" />
          <span>{fallbackText}</span>
          {canWebGL && (
            <button type="button" className="btn btn-sm btn-link p-0 ms-auto" onClick={() => switchMode('3d')}>
              3D'yi yine de dene
            </button>
          )}
        </div>
      )}

      <div className={`parking-view-body ${selected ? 'has-detail' : ''}`}>
        <div className="parking-view-map">
          {mode === '3d' ? (
            <Map3DBoundary key={lotKey} onError={() => fallTo2D('error')}>
              <Suspense fallback={<Loading text="3D kroki yükleniyor…" />}>
                <ParkingMap3D
                  sceneKey={`${lotKey}-${floor}`}
                  viewW={viewW}
                  viewH={viewH}
                  items={items}
                  decor={decor}
                  focusBox={activeBlock ? blocks[activeBlock] : null}
                  selectedSlot={selectedCode}
                  highlightSlot={highlightSlot}
                  zoneName={zoneLabel}
                  onSlotClick={(s) => setSelectedCode(s.code)}
                  onLowPerformance={(fps) => fallTo2D('slow', fps)}
                  onError={() => fallTo2D('error')}
                />
              </Suspense>
              <Legend3D items={items} recommendedZone={recommendedZone} />
            </Map3DBoundary>
          ) : (
            <ParkingMap
              lot={lot}
              slots={slots}
              zones={zones}
              recommendedZone={recommendedZone}
              highlightSlot={highlightSlot}
              selectedSlot={selectedCode}
              violationSlots={violationSlots}
              onSlotClick={(s) => setSelectedCode(s.code)}
              floor={multiFloor ? floor : undefined}
              onFloorChange={selectFloor}
            />
          )}
        </div>
        {selected && (
          <SlotDetailCard
            slot={selected}
            lotCode={lotKey}
            canManage={canManage}
            zoneLabel={zoneLabel(selected)}
            onClose={() => setSelectedCode(null)}
            onOverride={onOverride}
            onPatched={onSlotsPatched}
          />
        )}
      </div>
    </div>
  );
}

function Legend3D({ items, recommendedZone }) {
  const c = { free: 0, occupied: 0, reserved: 0, disabled: 0, violation: 0, inactive: 0 };
  items.forEach((it) => {
    if (it.dis && it.st === 'free') c.disabled += 1;
    else c[it.st] += 1;
    if (it.viol) c.violation += 1;
  });
  return (
    <div className="parking-legend d-flex flex-wrap gap-3 justify-content-center mt-2 small">
      <span>
        <span className="legend-dot free" /> Boş ({c.free})
      </span>
      <span>
        <span className="legend-dot occupied" /> Dolu ({c.occupied})
      </span>
      <span>
        <span className="legend-dot reserved" /> Rezerve ({c.reserved})
      </span>
      <span>
        <span className="legend-dot disabled-free" /> ♿ Engelli boş ({c.disabled})
      </span>
      <span className={c.violation ? 'text-danger fw-semibold' : ''}>
        <span className="legend-dot violation" /> İhlal ({c.violation})
      </span>
      <span>
        <span className="legend-dot inactive" /> Kullanım dışı ({c.inactive})
      </span>
      {recommendedZone && <span className="text-secondary">Önerilen blok: {recommendedZone}</span>}
    </div>
  );
}
