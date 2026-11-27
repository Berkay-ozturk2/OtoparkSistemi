import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const ANKARA = [39.925, 32.82];

/** Otopark işareti: boş yer durumuna göre renkli "P" rozeti (görsel dosyası gerektirmez) */
function lotIcon(lot, selected) {
  const free = Number(lot.freeSlots ?? 0);
  const total = Number(lot.totalSlots ?? 0) || 1;
  const ratio = free / total;
  // Renk + harf birlikte: dolu = ×, az yer = P!, boş = P (renk körlüğü için)
  const full = free <= 0;
  const low = !full && ratio < 0.2;
  const color = full ? 'var(--ap-pin-full)' : low ? 'var(--ap-pin-low)' : 'var(--ap-pin-free)';
  const glyph = full ? '×' : low ? 'P!' : 'P';
  const size = selected ? 46 : 36;
  return L.divIcon({
    className: 'citymap-lot-icon',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);`
      + `background:${color};border:3px solid ${selected ? 'var(--ap-text)' : 'var(--ap-white)'};box-shadow:0 2px 6px rgba(0,0,0,.35);`
      + 'display:flex;align-items:center;justify-content:center">'
      + `<span style="transform:rotate(45deg);color:var(--ap-white);font-weight:800;font-size:${selected ? 20 : 16}px;font-family:var(--ap-font-sans)">${glyph}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}

const youIcon = L.divIcon({
  className: 'citymap-you-icon',
  html: '<div style="width:20px;height:20px;border-radius:50%;background:var(--ap-brand);border:4px solid var(--ap-white);'
    + 'box-shadow:0 0 0 6px rgba(var(--ap-brand-rgb),.25)"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function FitBounds({ points, padding = 48 }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join('|');
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], Math.max(map.getZoom(), 14));
    else if (points.length > 1) map.fitBounds(points, { padding: [padding, padding] });
  }, [key]);
  return null;
}

function ClickHandler({ onMapClick }) {
  useMapEvents({
    click: (e) => onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng }),
  });
  return null;
}

/**
 * Şehir haritası (OpenStreetMap + Leaflet).
 *  lots        : [{ code, name, latitude, longitude, freeSlots, totalSlots, disabledFree, address }]
 *  selectedCode: seçili otopark
 *  origin      : { lat, lng } başlangıç (konumunuz)
 *  route       : [[lat, lng], ...] rota çizgisi
 *  onSelectLot : (code) => void
 *  onMapClick  : ({lat, lng}) => void  — haritaya tıklayınca (ör. başlangıç seçme)
 */
export default function CityMap({ lots, selectedCode, origin, route, onSelectLot, onMapClick, height = 520 }) {
  const located = useMemo(
    () => (lots || []).filter((l) => Number.isFinite(l.latitude) && Number.isFinite(l.longitude)),
    [lots],
  );

  const fitPoints = useMemo(() => {
    if (route && route.length > 1) return route;
    const pts = [];
    const sel = located.find((l) => l.code === selectedCode);
    if (origin && sel) return [[origin.lat, origin.lng], [sel.latitude, sel.longitude]];
    located.forEach((l) => pts.push([l.latitude, l.longitude]));
    if (origin) pts.push([origin.lat, origin.lng]);
    return pts;
  }, [route, located, origin, selectedCode]);

  return (
    <div className="citymap rounded-3 overflow-hidden border" style={{ height }}>
      <MapContainer center={ANKARA} zoom={12} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> katkıda bulunanlar'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <FitBounds points={fitPoints} />
        <ClickHandler onMapClick={onMapClick} />

        {route && route.length > 1 && (
          <>
            <Polyline positions={route} pathOptions={{ className: 'citymap-route-casing', weight: 9, opacity: 0.9 }} />
            <Polyline positions={route} pathOptions={{ className: 'citymap-route', weight: 5, opacity: 0.95 }} />
          </>
        )}

        {origin && (
          <Marker position={[origin.lat, origin.lng]} icon={youIcon} zIndexOffset={1000}>
            <Tooltip direction="top" offset={[0, -10]}>Başlangıç (konumunuz)</Tooltip>
          </Marker>
        )}

        {located.map((l) => (
          <Marker
            key={l.code}
            position={[l.latitude, l.longitude]}
            icon={lotIcon(l, l.code === selectedCode)}
            eventHandlers={{ click: () => onSelectLot?.(l.code) }}
            zIndexOffset={l.code === selectedCode ? 500 : 0}
          >
            <Tooltip direction="top" offset={[0, -30]}>
              {l.name}: {l.freeSlots} boş{Number(l.disabledFree) > 0 ? ` · ♿ ${l.disabledFree}` : ''}
            </Tooltip>
            <Popup>
              <div className="fw-semibold">{l.name}</div>
              {l.address && <div className="small text-secondary">{l.address}</div>}
              <div className="small mt-1">
                Boş: <strong>{l.freeSlots}</strong> / {l.totalSlots}
                {Number(l.disabledTotal) > 0 && <> · ♿ {l.disabledFree}/{l.disabledTotal}</>}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
