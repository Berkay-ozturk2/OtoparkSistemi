/**
 * Yol tarifi yardımcıları.
 *
 * Rota: OSRM (Open Source Routing Machine, OpenStreetMap verisi) — API anahtarı gerekmez.
 * Varsayılan sunucu herkese açık demo sunucusudur (yalnızca düşük hacimli/deneme kullanımı için);
 * kendi sunucunuz için VITE_OSRM_URL ortam değişkenini verin.
 * OSRM'e ulaşılamazsa arayüz düz çizgi mesafesi ve Google Haritalar bağlantısıyla devam eder.
 */

const OSRM_URL = (import.meta.env.VITE_OSRM_URL || 'https://router.project-osrm.org').replace(/\/$/, '');

/** Ankara için kullanışlı demo başlangıç noktaları (konum izni verilmezse) */
export const DEMO_STARTS = [
  { key: 'kizilay', name: 'Kızılay Meydanı', lat: 39.92077, lng: 32.85411 },
  { key: 'asti', name: 'AŞTİ', lat: 39.91848, lng: 32.81122 },
  { key: 'ulus', name: 'Ulus', lat: 39.94152, lng: 32.85465 },
];

/** İki nokta arasındaki kuş uçuşu mesafe (metre) */
export function haversineMeters(a, b) {
  if (!a || !b) return null;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(meters) {
  if (meters == null || Number.isNaN(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} km`;
}

export function formatTravelTime(seconds) {
  if (seconds == null) return '—';
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} dk`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} sa ${m} dk` : `${h} sa`;
}

/** Google Haritalar yol tarifi bağlantısı (telefonda uygulamayı açar) */
export function googleMapsDirectionsUrl(from, to) {
  const dest = `${to.lat},${to.lng}`;
  const origin = from ? `&origin=${from.lat},${from.lng}` : '';
  return `https://www.google.com/maps/dir/?api=1${origin}&destination=${dest}&travelmode=driving`;
}

const MODIFIER_TR = {
  left: 'sola',
  right: 'sağa',
  'slight left': 'hafif sola',
  'slight right': 'hafif sağa',
  'sharp left': 'keskin sola',
  'sharp right': 'keskin sağa',
  straight: 'düz',
  uturn: 'U dönüşü yaparak geri',
};

/** OSRM adımını Türkçe talimata çevirir */
export function turkishInstruction(step, destinationName) {
  const m = step?.maneuver || {};
  const type = m.type;
  const mod = MODIFIER_TR[m.modifier] || '';
  const road = step?.name ? ` (${step.name})` : '';
  const onto = step?.name ? `${step.name} yoluna` : 'yola';
  switch (type) {
    case 'depart':
      return `Yola çıkın${road}`;
    case 'arrive':
      return `Varış: ${destinationName || 'otopark'}${m.modifier === 'left' ? ' — solunuzda' : m.modifier === 'right' ? ' — sağınızda' : ''}`;
    case 'turn':
    case 'end of road':
      if (m.modifier === 'straight') return `Düz devam edin${road}`;
      if (m.modifier === 'uturn') return `U dönüşü yapın${road}`;
      return `${type === 'end of road' ? 'Yolun sonunda ' : ''}${mod} dönün${road}`.replace(/^./, (c) => c.toUpperCase());
    case 'new name':
    case 'continue':
      return step?.name ? `${step.name} üzerinde devam edin` : `${mod ? `${mod} ` : ''}devam edin`.replace(/^./, (c) => c.toUpperCase());
    case 'merge':
      return `${onto} katılın`.replace(/^./, (c) => c.toUpperCase());
    case 'on ramp':
      return `Bağlantı yoluna girin${road}`;
    case 'off ramp':
      return `${mod ? `${mod.replace(/^./, (c) => c.toUpperCase())} ` : ''}bağlantı yolundan çıkın${road}`.replace(/^./, (c) => c.toUpperCase());
    case 'fork':
      return `Yol ayrımında ${mod || 'devam'} gidin${road}`;
    case 'roundabout':
    case 'rotary':
    case 'roundabout turn':
      return m.exit ? `Dönel kavşaktan ${m.exit}. çıkıştan çıkın${road}` : `Dönel kavşaktan geçin${road}`;
    case 'exit roundabout':
    case 'exit rotary':
      return `Kavşaktan çıkın${road}`;
    default:
      return mod ? `${mod.replace(/^./, (c) => c.toUpperCase())} devam edin${road}` : `Devam edin${road}`;
  }
}

/**
 * Araç rotası hesaplar.
 * @returns {Promise<{ coordinates: [number, number][], distance: number, duration: number, steps: {text, distance}[] }>}
 *          coordinates Leaflet sırasıyla [lat, lng]
 */
export async function fetchRoute(from, to, { destinationName, signal } = {}) {
  const url = `${OSRM_URL}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}`
    + '?overview=full&geometries=geojson&steps=true&alternatives=false';
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Rota servisi yanıt vermedi (HTTP ${res.status}).`);
  const data = await res.json();
  const route = data?.routes?.[0];
  if (data.code !== 'Ok' || !route) throw new Error('Bu iki nokta arasında araç rotası bulunamadı.');
  const steps = (route.legs?.[0]?.steps || [])
    .map((s) => ({ text: turkishInstruction(s, destinationName), distance: s.distance }))
    .filter((s, i, arr) => !(s.distance < 1 && i > 0 && i < arr.length - 1));
  return {
    coordinates: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distance: route.distance,
    duration: route.duration,
    steps,
  };
}

/** Tarayıcıdan konum al (Promise) */
export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Tarayıcınız konum özelliğini desteklemiyor.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => {
        const msg = e.code === 1
          ? 'Konum izni verilmedi. Tarayıcının adres çubuğundaki konum simgesinden izin verebilir ya da haritaya tıklayarak başlangıç seçebilirsiniz.'
          : 'Konumunuz alınamadı. Haritaya tıklayarak başlangıç noktası seçebilirsiniz.';
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}
