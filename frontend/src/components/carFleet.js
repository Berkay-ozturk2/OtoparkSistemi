// 3D kroki için araç filosu: polycars modelleri, gövde renkleri ve Türk plakaları.
//
// Modeller scripts/convert-polycars.mjs ile public/models/polycars altına üretilir.
// Klasör yoksa (betik henüz çalıştırılmadıysa) loadFleet() null döner ve kroki
// eski kutu araçlarla çalışmaya devam eder.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = `${import.meta.env.BASE_URL || '/'}models/polycars/`;

let fleetPromise = null;

/** { cars: [{ id, length, width, height, detail, paint }], cone, materials } veya null */
export function loadFleet() {
  if (!fleetPromise) {
    fleetPromise = (async () => {
      const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
      if (!res.ok) return null;
      const manifest = await res.json();
      const loader = new GLTFLoader();
      const load = async (entry) => {
        const gltf = await loader.loadAsync(`${BASE}${entry.file}`);
        const parts = {};
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          const g = o.geometry.clone();
          g.applyMatrix4(o.matrixWorld);
          g.computeVertexNormals(); // indekssiz üçgenler → düz (low-poly) gölgeleme
          g.computeBoundingBox();
          g.computeBoundingSphere();
          parts[o.name] = g;
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        });
        return { ...entry, detail: parts.detail || null, paint: parts.paint || null };
      };
      const cars = (await Promise.all((manifest.cars || []).map((e) => load(e).catch(() => null)))).filter((c) => c?.detail);
      const coneEntry = (manifest.props || []).find((p) => p.id === 'cone');
      const cone = coneEntry ? await load(coneEntry).catch(() => null) : null;
      if (!cars.length) return null;
      return {
        cars,
        cone,
        materials: {
          detail: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 }),
          // Gövde: köşe rengi beyaz, asıl renk örnek (instance) renginden gelir
          paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.35 }),
        },
      };
    })().catch(() => null);
  }
  return fleetPromise;
}

// ---- Deterministik rastgelelik ----

/** Metinden 32 bit tohum (FNV-1a) */
export function hashSeed(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomSeed = () => (Math.random() * 4294967296) >>> 0;

// ---- Gövde renkleri (Türkiye trafiğindeki dağılıma yakın: beyaz/gri/siyah ağırlıklı) ----
const PAINTS = [
  ['#eceef1', 6], // beyaz
  ['#a9afb7', 4], // gümüş
  ['#5f656e', 3], // füme
  ['#24272d', 3], // siyah
  ['#8e1b1f', 2], // kırmızı
  ['#1f3f78', 2], // lacivert
  ['#3f6fb0', 1], // mavi
  ['#c7b796', 1], // bej
  ['#2f5a45', 1], // yeşil
  ['#a8581c', 1], // bakır
  ['#d9a521', 1], // sarı
];
const PAINT_TOTAL = PAINTS.reduce((s, [, w]) => s + w, 0);

// ---- Türk plakası: il kodu + 1-3 harf + 2-4 rakam ----
const CITIES_COMMON = ['06', '06', '06', '06', '34', '34', '35', '01', '07', '16', '42', '71', '18', '14', '26', '55', '38', '41'];
const LETTERS = 'ABCDEFGHJKLMNPRSTUVYZ';
const GROUPS = [
  [1, 4],
  [2, 3],
  [2, 4],
  [3, 2],
  [3, 3],
];

// Otoparkta sık görülen gövdeler daha olası; gösterişli modeller (DeLorean, yarış
// arabası, arazi kamyoneti) arada bir görünsün.
const MODEL_WEIGHTS = {
  smarty: 3,
  multiplx: 3,
  toro86: 3,
  'tois08-gt': 3,
  beatall: 2,
  stuttgart996: 2,
  landyroamer: 2,
  doclorean: 1,
  'tristar-racer': 1,
  'toyoyo-highlight': 1,
};

/**
 * Tohumdan araç kimliği: model, gövde rengi, plaka ve park yönü.
 * Aynı tohum her zaman aynı aracı verir.
 */
export function carIdentity(seed, cars) {
  const r = rng(seed);
  const weights = cars.map((c) => MODEL_WEIGHTS[c.id] ?? 2);
  let m = r() * weights.reduce((a, b) => a + b, 0);
  let model = cars.length - 1;
  for (let i = 0; i < weights.length; i += 1) {
    m -= weights[i];
    if (m <= 0) {
      model = i;
      break;
    }
  }
  let p = r() * PAINT_TOTAL;
  let paint = PAINTS[0][0];
  for (const [hex, w] of PAINTS) {
    p -= w;
    if (p <= 0) {
      paint = hex;
      break;
    }
  }
  const city = r() < 0.7 ? CITIES_COMMON[Math.floor(r() * CITIES_COMMON.length)] : String(1 + Math.floor(r() * 81)).padStart(2, '0');
  const [nl, nd] = GROUPS[Math.floor(r() * GROUPS.length)];
  let letters = '';
  for (let i = 0; i < nl; i += 1) letters += LETTERS[Math.floor(r() * LETTERS.length)];
  let digits = String(1 + Math.floor(r() * 9));
  for (let i = 1; i < nd; i += 1) digits += String(Math.floor(r() * 10));
  return { model, paint, plate: `${city} ${letters} ${digits}`, flipped: r() < 0.5 };
}

/** Beyaz Türk plakası (solda mavi TR şeridi) */
export function plateTexture(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 56;
  const g = c.getContext('2d');
  g.fillStyle = '#fbfbf8';
  g.fillRect(0, 0, 256, 56);
  g.fillStyle = '#1f4fa8';
  g.fillRect(0, 0, 30, 56);
  g.fillStyle = '#ffffff';
  g.font = '700 16px "Inter Variable", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TR', 15, 40);
  g.strokeStyle = '#111';
  g.lineWidth = 4;
  g.strokeRect(2, 2, 252, 52);
  g.fillStyle = '#111';
  g.font = '800 38px "Inter Variable", system-ui, sans-serif';
  g.fillText(text, 143, 30, 214);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
