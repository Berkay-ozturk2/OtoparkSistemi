import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatDateTime } from '../utils/format';

// Sözleşme bölüm 10 (eski tek otopark): 1000×600 tuval; A y=60, B y=260, C y=460; cep 80×120, x = 60 + (i-1)×88
// Sözleşme bölüm 11: her otoparkın kendi tuvali (lot.mapWidth × lot.mapHeight) ve süsleri (decor) vardır.
const DEFAULT_W = 1000;
const DEFAULT_H = 600;
const ROW_Y = { A: 60, B: 260, C: 460 };
const PAD = 14;
const ZOOM_STEPS = [1, 1.5, 2, 3, 4];

// Renkler theme/tokens.css'ten gelir; SVG'de var() yalnızca style ile çalışır
const DISABLED_COLOR = 'var(--ap-slot-disabled)';
const FG_COLOR = 'var(--ap-slot-disabled-fg)';

/** Koordinatı olmayan cepler için eski sözleşmedeki formülle yedek konum hesaplar */
export function slotGeometry(slot) {
  const w = Number(slot.mapW);
  const h = Number(slot.mapH);
  if (w > 0 && h > 0) {
    return { x: Number(slot.mapX) || 0, y: Number(slot.mapY) || 0, w, h };
  }
  const zone = slot.zoneCode || String(slot.code || 'A').charAt(0);
  const idx = parseInt(String(slot.code || '').replace(/\D/g, ''), 10) || 1;
  return { x: 60 + (idx - 1) * 88, y: ROW_Y[zone] ?? 60, w: 80, h: 120 };
}

/** Cep durumu: 'inactive' | 'occupied' | 'reserved' | 'free' */
export function slotState(slot) {
  if (slot.isActive === false) return 'inactive';
  if (slot.isOccupied) return 'occupied';
  if (slot.isReserved) return 'reserved';
  return 'free';
}

export const isDisabledSlot = (slot) => slot?.type === 'Disabled';

export const STATE_LABEL = { occupied: 'Dolu', reserved: 'Rezerve', free: 'Boş', inactive: 'Kullanım dışı' };
export const SLOT_TYPE_LABEL = { Standard: 'Standart', Disabled: 'Engelli (♿)' };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Tekerlekli sandalye simgesi (yazı tipinden bağımsız SVG; Windows'ta da aynı görünür).
 * 24×24 birimlik çizim, (cx, cy) merkezli ve `size` boyutunda ölçeklenir.
 */
export function WheelchairIcon({ cx, cy, size, color = FG_COLOR }) {
  const k = size / 24;
  return (
    <g transform={`translate(${cx - size / 2} ${cy - size / 2}) scale(${k})`} className="pm-wheelchair" aria-hidden="true">
      <circle cx="12.5" cy="3.2" r="2.3" style={{ fill: color }} />
      <g fill="none" style={{ stroke: color }} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11.5 7.2 V13.2 H17 L19.6 19" />
        <path d="M11.5 10 H16" />
        <path d="M8.3 11.6 A5.6 5.6 0 1 0 15.8 18.4" />
      </g>
    </g>
  );
}

/** Kroki süsü: yol, giriş/çıkış, bina, asansör, bölge etiketi, yeşil alan */
function Decor({ d, idx, viewW, viewH }) {
  const x = Number(d.x) || 0;
  const y = Number(d.y) || 0;
  const w = Math.max(1, Number(d.w) || 0);
  const h = Math.max(1, Number(d.h) || 0);
  const short = Math.min(w, h);
  const cx = x + w / 2;
  const cy = y + h / 2;

  switch (d.type) {
    case 'road': {
      const horizontal = w >= h;
      const lineW = clamp(short * 0.05, 2, 5);
      return (
        <g className="pm-road">
          <rect x={x} y={y} width={w} height={h} rx={clamp(short * 0.12, 2, 10)} className="pm-road-bg" />
          {short >= 24 &&
            (horizontal ? (
              <line x1={x + 12} x2={x + w - 12} y1={cy} y2={cy} className="pm-road-line" strokeWidth={lineW} strokeDasharray="22 16" />
            ) : (
              <line x1={cx} x2={cx} y1={y + 12} y2={y + h - 12} className="pm-road-line" strokeWidth={lineW} strokeDasharray="22 16" />
            ))}
          {d.text && (
            <text x={cx} y={cy - lineW - 4} textAnchor="middle" className="pm-road-text" fontSize={clamp(short * 0.28, 9, 14)}>
              {d.text}
            </text>
          )}
        </g>
      );
    }
    case 'entry':
    case 'exit': {
      const isEntry = d.type === 'entry';
      const gateCls = isEntry ? 'pm-gate-entry' : 'pm-gate-exit';
      const label = d.text || (isEntry ? 'GİRİŞ' : 'ÇIKIŞ');
      // Ok yönü: giriş tuval merkezine doğru, çıkış merkezden dışarı doğru
      let dx = viewW / 2 - cx;
      let dy = viewH / 2 - cy;
      if (!isEntry) {
        dx = -dx;
        dy = -dy;
      }
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      const vertical = h > w * 1.4;
      const a = clamp(short * 0.55, 10, 26); // ok boyutu
      const long = vertical ? h : w;
      // Yazı, işaretin içine sığacak şekilde küçültülür
      const fs = Math.max(7, Math.min(clamp(short * 0.42, 10, 20), (long - a - 18) / (label.length * 0.66)));
      const arrowPaths = {
        right: `M0 ${-a / 2} L${a * 0.75} 0 L0 ${a / 2} Z`,
        left: `M${a * 0.75} ${-a / 2} L0 0 L${a * 0.75} ${a / 2} Z`,
        down: `M${-a / 2} 0 L0 ${a * 0.75} L${a / 2} 0 Z`,
        up: `M${-a / 2} ${a * 0.75} L0 0 L${a / 2} ${a * 0.75} Z`,
      };
      const arrowBox = dir === 'left' || dir === 'right' ? { bw: a * 0.75, bh: a } : { bw: a, bh: a * 0.75 };
      let arrowX;
      let arrowY;
      let textEl;
      if (vertical) {
        arrowX = cx - (dir === 'left' || dir === 'right' ? arrowBox.bw / 2 : 0);
        arrowY = y + 8 + (dir === 'up' || dir === 'down' ? 0 : arrowBox.bh / 2);
        const ty = (y + 8 + arrowBox.bh + y + h) / 2;
        textEl = (
          <text x={cx} y={ty} textAnchor="middle" dominantBaseline="central" className="pm-gate-text" fontSize={fs} transform={`rotate(-90 ${cx} ${ty})`}>
            {label}
          </text>
        );
      } else {
        const estText = label.length * fs * 0.62;
        const total = arrowBox.bw + 6 + estText;
        const startX = cx - total / 2;
        arrowX = startX + (dir === 'up' || dir === 'down' ? arrowBox.bw / 2 : 0);
        arrowY = cy - (dir === 'up' || dir === 'down' ? arrowBox.bh / 2 : 0);
        textEl = (
          <text x={startX + arrowBox.bw + 6} y={cy} dominantBaseline="central" className="pm-gate-text" fontSize={fs}>
            {label}
          </text>
        );
      }
      return (
        <g className={`pm-${d.type}`}>
          <title>{isEntry ? 'Giriş' : 'Çıkış'}</title>
          <rect x={x} y={y} width={w} height={h} rx={clamp(short * 0.25, 4, 12)} className={gateCls} />
          <path d={arrowPaths[dir]} transform={`translate(${arrowX} ${arrowY})`} className="pm-gate-arrow" />
          {textEl}
        </g>
      );
    }
    case 'building': {
      const fs = clamp(short * 0.16, 11, 28);
      return (
        <g className="pm-building">
          <rect x={x} y={y} width={w} height={h} rx="8" className="pm-building-bg" strokeWidth="2" />
          <rect x={x + 6} y={y + 6} width={w - 12} height={h - 12} rx="5" className="pm-building-inner" strokeDasharray="6 6" />
          {d.text && (
            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" className="pm-building-text" fontSize={fs}>
              {d.text}
            </text>
          )}
        </g>
      );
    }
    case 'elevator': {
      const s = clamp(short * 0.55, 12, 40);
      const hasRoom = h >= s + 22;
      const iy = hasRoom ? cy - 8 : cy;
      return (
        <g className="pm-elevator">
          <title>{d.text || 'Asansör'}</title>
          <rect x={x} y={y} width={w} height={h} rx="6" className="pm-elevator-bg" strokeWidth="2" />
          <rect x={cx - s / 2} y={iy - s / 2} width={s} height={s} rx={s * 0.15} className="pm-elevator-box" />
          <path d={`M${cx - s * 0.22} ${iy - s * 0.06} L${cx} ${iy - s * 0.34} L${cx + s * 0.22} ${iy - s * 0.06} Z`} className="pm-elevator-arrow" />
          <path d={`M${cx - s * 0.22} ${iy + s * 0.06} L${cx} ${iy + s * 0.34} L${cx + s * 0.22} ${iy + s * 0.06} Z`} className="pm-elevator-arrow" />
          {hasRoom && (
            <text x={cx} y={iy + s / 2 + 13} textAnchor="middle" className="pm-elevator-text" fontSize="11">
              {d.text || 'Asansör'}
            </text>
          )}
        </g>
      );
    }
    case 'label': {
      const r = clamp(short / 2, 12, 34);
      // Uzun etiketler (açıklama satırları) daire rozete sığmaz: düz metin olarak yazılır
      if (String(d.text || '').length > 3) {
        return (
          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" className="pm-note-text" fontSize={clamp(h * 0.5, 10, 16)}>
            {d.text}
          </text>
        );
      }
      return (
        <g className="pm-label">
          <circle cx={cx} cy={cy} r={r} className="pm-zone-badge" />
          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" className="pm-zone-letter" fontSize={r * 1.05}>
            {d.text}
          </text>
        </g>
      );
    }
    case 'green': {
      // Basit ağaçlar: alan içinde düzenli dağıtılmış daireler (deterministik)
      const trees = [];
      const step = clamp(short * 0.45, 22, 60);
      const r = clamp(step * 0.32, 5, 16);
      for (let tx = x + step / 2; tx < x + w; tx += step) {
        for (let ty = y + step / 2; ty < y + h; ty += step) {
          trees.push([tx, ty]);
        }
      }
      return (
        <g className="pm-green">
          <rect x={x} y={y} width={w} height={h} rx="10" className="pm-green-bg" strokeWidth="2" />
          {trees.slice(0, 60).map(([tx, ty]) => (
            <circle key={`t-${idx}-${tx}-${ty}`} cx={tx} cy={ty} r={r} className="pm-tree" />
          ))}
          {d.text && (
            <text x={cx} y={y + h - 8} textAnchor="middle" className="pm-green-text" fontSize={clamp(short * 0.18, 10, 14)}>
              {d.text}
            </text>
          )}
        </g>
      );
    }
    default:
      return null;
  }
}

/** Eski backend (otopark düzeni yok): bölge sıraları arasına yol + giriş/çıkış süsleri üretir */
function fallbackDecor(zoneEntries, viewW) {
  const out = [
    { type: 'entry', x: 60, y: 4, w: 130, h: 30, text: 'GİRİŞ' },
    { type: 'exit', x: viewW - 190, y: 4, w: 130, h: 30, text: 'ÇIKIŞ' },
  ];
  for (let i = 0; i < zoneEntries.length - 1; i += 1) {
    const top = zoneEntries[i][1].maxY + PAD;
    const bottom = zoneEntries[i + 1][1].minY - PAD;
    if (bottom - top > 12) out.push({ type: 'road', x: 50, y: top, w: viewW - 60, h: bottom - top });
  }
  return out;
}

/** Dolu cep içindeki araç çizimi (dikey veya yatay cep) */
function CarShape({ g }) {
  const portrait = g.h >= g.w;
  if (portrait) {
    const mx = g.w * 0.2;
    const top = g.y + g.h * 0.27;
    const bh = g.h * 0.64;
    return (
      <g className="pm-car">
        <rect x={g.x + mx} y={top} width={g.w - 2 * mx} height={bh} rx={g.w * 0.12} />
        <rect x={g.x + mx + 6} y={top + bh * 0.12} width={g.w - 2 * mx - 12} height={bh * 0.2} rx="4" className="pm-car-glass" />
        <rect x={g.x + mx + 6} y={top + bh * 0.72} width={g.w - 2 * mx - 12} height={bh * 0.14} rx="4" className="pm-car-glass" />
      </g>
    );
  }
  const my = g.h * 0.2;
  const left = g.x + g.w * 0.27;
  const bw = g.w * 0.64;
  return (
    <g className="pm-car">
      <rect x={left} y={g.y + my} width={bw} height={g.h - 2 * my} rx={g.h * 0.12} />
      <rect x={left + bw * 0.12} y={g.y + my + 6} width={bw * 0.2} height={g.h - 2 * my - 12} rx="4" className="pm-car-glass" />
      <rect x={left + bw * 0.72} y={g.y + my + 6} width={bw * 0.14} height={g.h - 2 * my - 12} rx="4" className="pm-car-glass" />
    </g>
  );
}

/**
 * SVG otopark krokisi (çoklu otopark, katlar, engelli cepler, ihlaller).
 *  lot              : ParkingLot { code, name, mapWidth, mapHeight, floors, decor } — yoksa eski 1000×600 düzen
 *  slots            : [Slot]
 *  zones            : [{ code, name, floor, freeSlots, totalSlots }] (etiket, kat ve tooltip için)
 *  recommendedZone  : 'A' — vurgulanan önerilen bölge
 *  highlightSlot    : 'A03' — vurgulanan cep (ör. önerilen cep)
 *  highlightZone    : 'B' — farklı renkte vurgulanan bölge (ör. "aracınız burada")
 *  selectedSlot     : 'A05' — seçili cep (yönetici düzenleme paneli)
 *  violationSlots   : ['A01'] — hasViolation dışında ayrıca ihlal olarak vurgulanacak cepler
 *  onSlotClick      : (slot) => void — verilirse cepler tıklanabilir
 *  floor/onFloorChange : isteğe bağlı kontrollü kat seçimi
 */
export default function ParkingMap({
  lot,
  slots = [],
  zones = [],
  recommendedZone,
  highlightSlot,
  highlightZone,
  selectedSlot,
  violationSlots,
  onSlotClick,
  showLegend = true,
  showControls = true,
  className = '',
  minWidth = 620,
  floor: floorProp,
  onFloorChange,
}) {
  const viewW = Number(lot?.mapWidth) > 0 ? Number(lot.mapWidth) : DEFAULT_W;
  const viewH = Number(lot?.mapHeight) > 0 ? Number(lot.mapHeight) : DEFAULT_H;
  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState(null);
  const [floorState, setFloorState] = useState(null);
  const zoomAnchor = useRef(null);
  const drag = useRef(null);
  const suppressClick = useRef(false);

  const zoneByCode = useMemo(() => {
    const m = {};
    zones.forEach((z) => {
      m[z.code] = z;
    });
    return m;
  }, [zones]);

  const violationSet = useMemo(() => new Set(violationSlots || []), [violationSlots]);

  const floorOf = (s) => {
    if (s.floor != null) return Number(s.floor);
    const zf = zoneByCode[s.zoneCode]?.floor;
    return zf != null ? Number(zf) : 0;
  };

  // Kat listesi: otopark tanımından, yoksa ceplerden
  const floors = useMemo(() => {
    if (Array.isArray(lot?.floors) && lot.floors.length) {
      return lot.floors.map((f) => ({ floor: Number(f.floor), name: f.name || `Kat ${f.floor}` }));
    }
    const set = new Set(slots.map((s) => (s.floor != null ? Number(s.floor) : Number(zoneByCode[s.zoneCode]?.floor ?? 0))));
    return Array.from(set)
      .sort((a, b) => a - b)
      .map((f) => ({ floor: f, name: f === 0 ? 'Zemin' : `Kat ${f}` }));
    // eslint-disable-next-line
  }, [lot, slots, zoneByCode]);

  const multiFloor = floors.length > 1;

  // Vurgulanan cep/bölge hangi kattaysa o kata geç
  const targetFloor = useMemo(() => {
    if (highlightSlot) {
      const s = slots.find((x) => x.code === highlightSlot);
      if (s) return floorOf(s);
    }
    if (highlightZone && zoneByCode[highlightZone]?.floor != null) return Number(zoneByCode[highlightZone].floor);
    if (recommendedZone && zoneByCode[recommendedZone]?.floor != null) return Number(zoneByCode[recommendedZone].floor);
    return null;
    // eslint-disable-next-line
  }, [highlightSlot, highlightZone, recommendedZone, slots, zoneByCode]);

  useEffect(() => {
    setFloorState(null);
  }, [targetFloor, lot?.code]);

  const floorCodes = floors.map((f) => f.floor);
  let activeFloor;
  if (floorProp != null) activeFloor = Number(floorProp);
  else if (floorState != null && floorCodes.includes(floorState)) activeFloor = floorState;
  else if (targetFloor != null && floorCodes.includes(targetFloor)) activeFloor = targetFloor;
  else activeFloor = floorCodes.includes(0) ? 0 : floorCodes[0] ?? 0;

  const selectFloor = (f) => {
    setFloorState(f);
    setHover(null);
    onFloorChange?.(f);
  };

  const { zoneBoxes, counts, items, floorStats } = useMemo(() => {
    const boxes = {};
    const c = { free: 0, occupied: 0, reserved: 0, disabledFree: 0, disabledOccupied: 0, violation: 0, inactive: 0 };
    const perFloor = {};
    const list = [];
    slots.forEach((s) => {
      if (!s || !s.code) return;
      const st = slotState(s);
      const dis = isDisabledSlot(s);
      const viol = !!s.hasViolation || violationSet.has(s.code);
      const f = floorOf(s);
      // Lejant sayaçları (tüm katlar)
      if (st === 'inactive') c.inactive += 1;
      else if (dis && st === 'occupied') c.disabledOccupied += 1;
      else if (dis && st === 'free') c.disabledFree += 1;
      else c[st] += 1;
      if (viol) c.violation += 1;
      const pf = perFloor[f] || (perFloor[f] = { free: 0, disabledFree: 0, total: 0 });
      pf.total += 1;
      if (st === 'free') {
        if (dis) pf.disabledFree += 1;
        else pf.free += 1;
      }
      if (f !== activeFloor && multiFloor) return;
      const g = slotGeometry(s);
      const zone = s.zoneCode || String(s.code).charAt(0);
      const b = boxes[zone];
      if (!b) {
        boxes[zone] = { minX: g.x, minY: g.y, maxX: g.x + g.w, maxY: g.y + g.h, free: 0, total: 0 };
      } else {
        b.minX = Math.min(b.minX, g.x);
        b.minY = Math.min(b.minY, g.y);
        b.maxX = Math.max(b.maxX, g.x + g.w);
        b.maxY = Math.max(b.maxY, g.y + g.h);
      }
      boxes[zone].total += 1;
      if (st === 'free') boxes[zone].free += 1;
      list.push({ slot: s, g, zone, st, dis, viol });
    });
    list.sort((a, b) => a.slot.code.localeCompare(b.slot.code, 'tr'));
    return { zoneBoxes: boxes, counts: c, items: list, floorStats: perFloor };
    // eslint-disable-next-line
  }, [slots, violationSet, activeFloor, multiFloor, zoneByCode]);

  const zoneEntries = Object.entries(zoneBoxes).sort(([a], [b]) => a.localeCompare(b));

  const decor = useMemo(() => {
    if (!lot) return fallbackDecor(zoneEntries, viewW);
    const list = Array.isArray(lot.decor) ? lot.decor : [];
    return list.filter((d) => d && (d.floor == null || !multiFloor || Number(d.floor) === activeFloor));
    // eslint-disable-next-line
  }, [lot, activeFloor, multiFloor, viewW, zoneEntries.length]);

  const hasLabels = decor.some((d) => d.type === 'label');
  const now = Date.now();
  const clickable = typeof onSlotClick === 'function';

  // ---- Yakınlaştırma (SVG genişliği ölçeklenir; kaydırma ile gezinilir) ----
  const changeZoom = (next) => {
    const el = scrollRef.current;
    if (el) {
      zoomAnchor.current = {
        fx: (el.scrollLeft + el.clientWidth / 2) / Math.max(1, el.scrollWidth),
        fy: (el.scrollTop + el.clientHeight / 2) / Math.max(1, el.scrollHeight),
      };
    }
    setHover(null);
    setZoom(next);
  };
  const zoomIn = () => changeZoom(ZOOM_STEPS.find((z) => z > zoom) ?? zoom);
  const zoomOut = () => changeZoom([...ZOOM_STEPS].reverse().find((z) => z < zoom) ?? 1);
  const zoomFit = () => changeZoom(1);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = zoomAnchor.current;
    if (!el || !a) return;
    el.scrollLeft = a.fx * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = a.fy * el.scrollHeight - el.clientHeight / 2;
    zoomAnchor.current = null;
  }, [zoom]);

  // Yakınlaştırılmışken fareyle sürükleyerek kaydırma
  const onPointerDown = (e) => {
    if (zoom <= 1 || e.button !== 0) return;
    const el = scrollRef.current;
    drag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, moved: false };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 5) d.moved = true;
    if (d.moved) {
      scrollRef.current.scrollLeft = d.sl - dx;
      scrollRef.current.scrollTop = d.st - dy;
    }
  };
  const endDrag = () => {
    if (drag.current?.moved) {
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
    drag.current = null;
  };

  const showTip = (e, item) => {
    const root = rootRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    setHover({ item, x: e.clientX - r.left, y: e.clientY - r.top, w: r.width });
  };

  const fireClick = (slot) => {
    if (suppressClick.current) return;
    onSlotClick?.(slot);
  };

  const currentFloorName = floors.find((f) => f.floor === activeFloor)?.name;

  return (
    <div className={`parking-map ${className}`} ref={rootRef}>
      {(multiFloor || showControls) && (
        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
          {multiFloor && (
            <ul className="nav nav-pills pm-floor-tabs flex-wrap" role="tablist" aria-label="Katlar">
              {floors.map((f) => {
                const st = floorStats[f.floor] || { free: 0, disabledFree: 0 };
                return (
                  <li className="nav-item" key={f.floor}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={f.floor === activeFloor}
                      className={`nav-link py-1 px-3 ${f.floor === activeFloor ? 'active' : ''}`}
                      onClick={() => selectFloor(f.floor)}
                    >
                      <i className="bi bi-layers me-1" />
                      {f.name}
                      <span className="badge rounded-pill text-bg-light ms-2">{st.free}</span>
                      {st.disabledFree > 0 && (
                        <span className="badge rounded-pill badge-disabled ms-1">
                          <span aria-hidden="true">♿</span> {st.disabledFree}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {showControls && (
            <div className="btn-group btn-group-sm ms-auto pm-zoom" role="group" aria-label="Yakınlaştırma">
              <button type="button" className="btn btn-light border" onClick={zoomOut} disabled={zoom <= 1} title="Uzaklaştır">
                <i className="bi bi-dash-lg" />
              </button>
              <span className="btn btn-light border disabled pm-zoom-level" aria-live="polite">
                %{Math.round(zoom * 100)}
              </span>
              <button type="button" className="btn btn-light border" onClick={zoomIn} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} title="Yakınlaştır">
                <i className="bi bi-plus-lg" />
              </button>
              <button type="button" className="btn btn-light border" onClick={zoomFit} disabled={zoom === 1} title="Sığdır">
                <i className="bi bi-arrows-angle-contract me-1" />
                Sığdır
              </button>
            </div>
          )}
        </div>
      )}

      <div
        className={`parking-map-scroll ${zoom > 1 ? 'pm-zoomed' : ''}`}
        ref={scrollRef}
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={endDrag}
        onMouseLeave={() => {
          endDrag();
          setHover(null);
        }}
      >
        <svg
          viewBox={`0 0 ${viewW} ${viewH}`}
          role="img"
          aria-label={`${lot?.name || 'Otopark'} krokisi${currentFloorName && multiFloor ? ` — ${currentFloorName}` : ''}`}
          style={{ width: `${zoom * 100}%`, minWidth: minWidth * zoom }}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <pattern id="pm-asphalt" width="12" height="12" patternUnits="userSpaceOnUse">
              <rect width="12" height="12" className="pm-ground" />
              <circle cx="3" cy="3" r="0.8" className="pm-ground-dot" />
              <circle cx="9" cy="8" r="0.8" className="pm-ground-dot" />
            </pattern>
            <pattern id="pm-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="10" height="10" className="pm-hatch-bg" />
              <line x1="0" y1="0" x2="0" y2="10" className="pm-hatch-line" strokeWidth="4" />
            </pattern>
            {/* Rezerve cepler: rengin yanında ikinci işaret olarak çapraz çizgi deseni */}
            <pattern id="pm-stripes" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="14" className="pm-stripe-line" />
            </pattern>
          </defs>

          <rect x="0" y="0" width={viewW} height={viewH} rx="18" fill="url(#pm-asphalt)" />

          {/* 1) Süsler: yollar, binalar, yeşil alanlar, giriş/çıkış, asansör, etiketler */}
          {decor.map((d, i) => (
            <Decor key={`decor-${i}`} d={d} idx={i} viewW={viewW} viewH={viewH} />
          ))}

          {/* 2) Vurgulanan bölge alanları */}
          {zoneEntries.map(([code, b]) => {
            const isRec = recommendedZone && code === recommendedZone;
            const isHi = highlightZone && code === highlightZone;
            const x = b.minX - PAD;
            const y = b.minY - PAD;
            const w = b.maxX - b.minX + PAD * 2;
            const h = b.maxY - b.minY + PAD * 2;
            const showBadge = !hasLabels;
            const badgeX = x - 26 >= 22 ? x - 26 : x + 22;
            const badgeY = x - 26 >= 22 ? y + h / 2 : y - 4;
            return (
              <g key={`zone-${code}`}>
                {(isRec || isHi) && (
                  <rect x={x} y={y} width={w} height={h} rx="14" className={`pm-zone ${isRec ? 'pm-zone-rec' : ''} ${isHi ? 'pm-zone-hi' : ''}`} />
                )}
                {showBadge && (
                  <g>
                    <circle cx={badgeX} cy={badgeY} r="21" className={`pm-zone-badge ${isRec ? 'rec' : ''} ${isHi ? 'hi' : ''}`} />
                    <text x={badgeX} y={badgeY} textAnchor="middle" dominantBaseline="central" className="pm-zone-letter" fontSize="22">
                      {code}
                    </text>
                    <title>{`${zoneByCode[code]?.name || `${code} bölgesi`} — ${b.free}/${b.total} boş`}</title>
                  </g>
                )}
              </g>
            );
          })}

          {/* 3) Cepler */}
          {items.map((it) => {
            const { slot, g, st, dis, viol } = it;
            const isHiSlot = highlightSlot && slot.code === highlightSlot;
            const isSel = selectedSlot && slot.code === selectedSlot;
            const flash = slot._flash && now - slot._flash < 3000;
            const short = Math.min(g.w, g.h);
            const portrait = g.h >= g.w;
            // Cep kodu cebe sığacak şekilde küçültülür; sığmazsa yalnızca numarası yazılır
            const room = portrait ? g.w * 0.9 : g.w * 0.42;
            let codeText = slot.code;
            let codeFs = Math.min(clamp(short * 0.21, 8, 17), room / (codeText.length * 0.62));
            if (codeFs < 7) {
              codeText = slot.code.split('-').pop().replace(/^[A-Za-z]+/, '') || slot.code.slice(-2);
              codeFs = Math.min(clamp(short * 0.21, 8, 17), room / (codeText.length * 0.62));
            }
            const iconSize = clamp(short * 0.5, 12, 46);
            const iconCy = g.y + g.h / 2 + (portrait ? codeFs * 0.45 : 0);
            const iconCx = g.x + g.w / 2 + (portrait ? 0 : g.w * 0.12);
            const cls = [
              'pm-slot',
              `pm-${st}`,
              dis ? 'pm-disabled' : '',
              viol ? 'pm-violation' : '',
              isHiSlot ? 'pm-slot-hi' : '',
              isSel ? 'pm-slot-sel' : '',
              flash ? 'pm-flash' : '',
              clickable ? 'pm-clickable' : '',
            ]
              .filter(Boolean)
              .join(' ');
            const label = `${slot.code}, ${dis ? 'engelli cebi' : 'standart cep'}, ${STATE_LABEL[st]}${viol ? ', ihlal' : ''}`;
            return (
              <g
                key={`${slot.code}-${slot._flash || 0}`}
                className={cls}
                onClick={clickable ? () => fireClick(slot) : undefined}
                onMouseEnter={(e) => showTip(e, it)}
                onMouseMove={(e) => showTip(e, it)}
                onMouseLeave={() => setHover(null)}
                role={clickable ? 'button' : 'img'}
                aria-label={label}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSlotClick(slot);
                        }
                      }
                    : undefined
                }
              >
                <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={clamp(short * 0.1, 3, 8)} className="pm-slot-rect" />
                {st === 'reserved' && (
                  <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={clamp(short * 0.1, 3, 8)} fill="url(#pm-stripes)" className="pm-slot-pattern" />
                )}
                {dis && st !== 'inactive' && short > 20 && (
                  <rect
                    x={g.x + 5}
                    y={g.y + 5}
                    width={g.w - 10}
                    height={g.h - 10}
                    rx={Math.max(1, clamp(short * 0.1, 3, 8) - 3)}
                    className="pm-disabled-inner"
                  />
                )}
                <text
                  x={portrait ? g.x + g.w / 2 : g.x + 5}
                  y={portrait ? g.y + codeFs + 4 : g.y + g.h / 2}
                  textAnchor={portrait ? 'middle' : 'start'}
                  dominantBaseline={portrait ? 'auto' : 'central'}
                  className="pm-slot-code"
                  fontSize={codeFs}
                >
                  {codeText}
                </text>

                {st === 'inactive' ? (
                  <g className="pm-inactive-x" strokeWidth={clamp(short * 0.06, 2, 5)} strokeLinecap="round">
                    <line x1={iconCx - iconSize / 3} y1={iconCy - iconSize / 3} x2={iconCx + iconSize / 3} y2={iconCy + iconSize / 3} />
                    <line x1={iconCx + iconSize / 3} y1={iconCy - iconSize / 3} x2={iconCx - iconSize / 3} y2={iconCy + iconSize / 3} />
                  </g>
                ) : dis ? (
                  <WheelchairIcon cx={iconCx} cy={iconCy} size={iconSize} color={st === 'free' ? DISABLED_COLOR : FG_COLOR} />
                ) : st === 'occupied' ? (
                  <CarShape g={g} />
                ) : (
                  <text
                    x={iconCx}
                    y={iconCy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className={`pm-slot-mark ${st === 'free' ? 'pm-p' : ''}`}
                    fontSize={clamp(short * 0.45, 12, 40)}
                  >
                    {st === 'reserved' ? 'R' : 'P'}
                  </text>
                )}

                {viol && (
                  <g className="pm-viol-mark">
                    <rect x={g.x - 2} y={g.y - 2} width={g.w + 4} height={g.h + 4} rx={clamp(short * 0.1, 3, 8) + 2} className="pm-viol-ring" />
                    <circle cx={g.x + g.w - 2} cy={g.y + 2} r={clamp(short * 0.17, 8, 14)} className="pm-viol-dot" strokeWidth="2" />
                    <text
                      x={g.x + g.w - 2}
                      y={g.y + 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="pm-viol-text"
                      fontWeight="900"
                      fontSize={clamp(short * 0.22, 10, 18)}
                    >
                      !
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* 4) Bölge etiketleri (önerilen / aracınız burada) */}
          {zoneEntries.map(([code, b]) => {
            const isRec = recommendedZone && code === recommendedZone;
            const isHi = highlightZone && code === highlightZone;
            if (!isRec && !isHi) return null;
            const cx = (b.minX + b.maxX) / 2;
            const y = Math.max(16, b.minY - PAD);
            return (
              <g key={`tag-${code}`} pointerEvents="none">
                <rect x={cx - 85} y={y - 13} width="170" height="26" rx="13" className={isHi ? 'pm-tag-hi' : 'pm-tag-rec'} />
                <text x={cx} y={y} textAnchor="middle" dominantBaseline="central" className="pm-tag-text">
                  {isHi ? 'ARACINIZ BURADA' : 'ÖNERİLEN BÖLGE'}
                </text>
              </g>
            );
          })}

          {items.length === 0 && (
            <text x={viewW / 2} y={viewH / 2} textAnchor="middle" className="pm-empty">
              {multiFloor ? 'Bu katta cep bulunamadı' : 'Cep bilgisi bulunamadı'}
            </text>
          )}
        </svg>
      </div>

      {hover && (
        <div
          className="pm-tooltip shadow"
          style={{
            left: Math.min(hover.x + 14, Math.max(0, hover.w - 220)),
            top: hover.y + 16,
          }}
          role="tooltip"
        >
          <div className="d-flex align-items-center gap-2 mb-1">
            <strong className="fs-6">{hover.item.slot.code}</strong>
            <span className={`badge pm-tip-state pm-tip-${hover.item.st}`}>{STATE_LABEL[hover.item.st]}</span>
          </div>
          <div>
            Tür: <strong>{SLOT_TYPE_LABEL[hover.item.slot.type] || 'Standart'}</strong>
          </div>
          <div>
            Bölge: <strong>{zoneByCode[hover.item.zone]?.name || hover.item.zone}</strong>
            {multiFloor && <> · {currentFloorName}</>}
          </div>
          {hover.item.viol && (
            <div className="text-danger fw-semibold">
              <i className="bi bi-exclamation-triangle-fill me-1" />
              İzinsiz park ihlali
            </div>
          )}
          {hover.item.slot.updatedAt && <div className="text-secondary small">Güncelleme: {formatDateTime(hover.item.slot.updatedAt)}</div>}
          {clickable && <div className="text-secondary small mt-1">Ayrıntı için tıklayın</div>}
        </div>
      )}

      {showLegend && (
        <div className="parking-legend d-flex flex-wrap gap-3 justify-content-center mt-2 small">
          <span>
            <span className="legend-dot free" /> Boş ({counts.free})
          </span>
          <span>
            <span className="legend-dot occupied" /> Dolu ({counts.occupied})
          </span>
          <span>
            <span className="legend-dot reserved" /> Rezerve ({counts.reserved})
          </span>
          <span>
            <span className="legend-dot disabled-free" /> Engelli (boş) ({counts.disabledFree})
          </span>
          <span>
            <span className="legend-dot disabled-occupied" /> Engelli (dolu) ({counts.disabledOccupied})
          </span>
          <span className={counts.violation ? 'text-danger fw-semibold' : ''}>
            <span className="legend-dot violation" /> İhlal ({counts.violation})
          </span>
          <span>
            <span className="legend-dot inactive" /> Kullanım dışı ({counts.inactive})
          </span>
          {recommendedZone && (
            <span>
              <span className="legend-dot rec" /> Önerilen bölge
            </span>
          )}
        </div>
      )}
    </div>
  );
}
