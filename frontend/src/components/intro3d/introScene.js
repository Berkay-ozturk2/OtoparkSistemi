// "Nasıl çalışır?" sayfasının kaydırmayla ilerleyen 3D sahnesi.
//
// Bütün sahne tek bir sayıya bağlıdır: p (0 = sayfanın başı, 1 = sonu).
// Spor araba yoldan gelir, bariyerde durur, plakası okunur, kol kalkar,
// araç otoparka girip boş yere park eder; sonra saat ilerler ve otopark
// gün boyu dolup boşalır. Modeller: frontend/public/models/polycars (convert-polycars.mjs).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { carIdentity, hashSeed, loadFleet, plateTexture } from '../carFleet';

const BASE = `${import.meta.env.BASE_URL || '/'}models/polycars/`;

export const HERO_PLATE = '06 AKP 315';
export const HERO_MODEL = 'stuttgart996'; // ya da 'tristar-racer', 'tois08-gt'
export const TARGET_SLOT = 'A-14';

const L = 4.4; // spor arabanın boyu (m)
const START_Z = 36;
const STOP_Z = 1.0 + L / 2 + 0.3; // ön tampon dur çizgisinin hemen önünde
const SLOT_W = 2.7;
const SLOT_D = 5.2;
const ROW_X = 3.7 + SLOT_D / 2; // koridor kenarından cep merkezine
const SLOTS_PER_ROW = 12;
const TARGET = { side: -1, index: 3 }; // sol sıra, 4. cep

/** Bölümler: sayfadaki metin kartlarıyla aynı sırada */
export const PHASES = {
  hero: [0, 0.1],
  drive: [0.1, 0.3],
  read: [0.3, 0.48],
  gate: [0.48, 0.62],
  park: [0.62, 0.82],
  live: [0.82, 1],
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const seg = (p, a, b) => clamp01((p - a) / (b - a));
const smooth = (t) => t * t * (3 - 2 * t);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function slotCenter(side, i) {
  return V(side * ROW_X, 0, -5.2 - SLOT_W / 2 - i * SLOT_W);
}

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 16;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i += 1) {
    g.fillStyle = i % 2 ? '#f4f4f4' : '#d62828';
    g.fillRect(i * 64, 0, 64, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signTexture(accent) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#0f1c2e';
  g.fillRect(0, 0, 1024, 192);
  g.fillStyle = accent;
  g.fillRect(0, 0, 192, 192);
  g.fillStyle = '#fff';
  g.font = '800 140px "Inter Variable", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('P', 96, 104);
  g.textAlign = 'left';
  g.font = '800 92px "Inter Variable", system-ui, sans-serif';
  g.fillText('AkıllıPark', 236, 84);
  g.font = '600 44px "Inter Variable", system-ui, sans-serif';
  g.fillStyle = '#9fb3c8';
  g.fillText('GİRİŞ · Plaka tanıma ile geçiş', 238, 152);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Sahneyi kurar.
 *  canvas  : çizim yüzeyi
 *  opts.accent : marka rengi (araç boyası, tabela)
 *  opts.onHud(state) : her karede HUD bilgisi (plaka ekran konumu, saat, boş yer…)
 * Dönüş: { ready: Promise, setProgress(p), resize(w,h), dispose() }
 */
export function createIntroScene(canvas, { accent = '#0a7590', onHud } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const sky = new THREE.Color('#cfdbe6');
  scene.background = sky.clone();
  scene.fog = new THREE.Fog(sky.clone(), 60, 150);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-22, 34, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 120 });
  sun.shadow.bias = -0.0004;
  sun.target.position.set(0, 0, -6);
  scene.add(sun, sun.target);

  const disposables = [envTex, pmrem];
  const mat = (o) => {
    const m = new THREE.MeshStandardMaterial(o);
    disposables.push(m);
    return m;
  };
  const geo = (g) => {
    disposables.push(g);
    return g;
  };
  const add = (mesh, { cast = false, receive = true } = {}) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    scene.add(mesh);
    return mesh;
  };

  // ---- Zemin, yollar, çizgiler ----
  const concrete = mat({ color: '#c3c7cc', roughness: 0.95 });
  const asphalt = mat({ color: '#3a3e45', roughness: 0.92 });
  const paint = mat({ color: '#eef0f2', roughness: 0.7 });
  const grass = mat({ color: '#6f8f5a', roughness: 1 });
  add(new THREE.Mesh(geo(new THREE.PlaneGeometry(400, 400)), concrete)).rotation.x = -Math.PI / 2;
  const box = (w, h, d, m, x, y, z, o) => {
    const mesh = new THREE.Mesh(geo(new THREE.BoxGeometry(w, h, d)), m);
    mesh.position.set(x, y, z);
    return add(mesh, o);
  };
  box(7.4, 0.02, 46, asphalt, 0, 0.01, 19);                      // giriş yolu
  box(2 * (3.7 + SLOT_D) + 1, 0.02, 40, asphalt, 0, 0.012, -22);  // otopark
  for (let z = 40; z > 4; z -= 4) box(0.16, 0.012, 2, paint, 0, 0.026, z);   // kesikli orta çizgi
  box(7, 0.012, 0.35, paint, 0, 0.026, 1.0);                     // dur çizgisi
  [-3.7, 3.7].forEach((x) => box(0.12, 0.012, 38, paint, x, 0.026, -23));
  [-1, 1].forEach((side) => {
    for (let i = 0; i <= SLOTS_PER_ROW; i += 1) {
      const z = -5.2 - i * SLOT_W;
      box(SLOT_D, 0.012, 0.1, paint, side * ROW_X, 0.026, z);
    }
  });
  // Kaldırımlar ve yeşil alanlar
  [-1, 1].forEach((side) => {
    box(1.2, 0.18, 46, concrete, side * 4.3, 0.09, 19, { cast: true });
    box(10, 0.1, 40, grass, side * 9.6, 0.05, 21);
  });

  // Ağaçlar (tek InstancedMesh)
  const treePts = [];
  for (let z = 38; z > 6; z -= 5.5) treePts.push([-7.2, z], [7.4, z - 2.5]);
  for (let z = -6; z > -40; z -= 6) treePts.push([-11.5, z], [11.5, z - 3]);
  const crown = new THREE.InstancedMesh(geo(new THREE.IcosahedronGeometry(1.4, 0)), mat({ color: '#4f7a45', roughness: 0.9, flatShading: true }), treePts.length);
  const trunk = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.15, 0.2, 2, 6)), mat({ color: '#6b4f3a' }), treePts.length);
  const m4 = new THREE.Matrix4();
  treePts.forEach(([x, z], i) => {
    const s = 0.8 + ((i * 37) % 10) / 20;
    crown.setMatrixAt(i, m4.compose(V(x, 2.6 * s, z), new THREE.Quaternion(), V(s, s * 1.2, s)));
    trunk.setMatrixAt(i, m4.makeTranslation(x, 1, z));
  });
  crown.castShadow = true;
  trunk.castShadow = true;
  scene.add(crown, trunk);

  // Arka plan binaları
  const bldg = mat({ color: '#d9dde3', roughness: 0.8 });
  [[-18, 14, -52, 16, 18], [2, 22, -58, 20, 14], [22, 10, -50, 14, 20], [-34, 18, -30, 10, 24]].forEach(([x, h, z, w, d]) => {
    box(w, h, d, bldg, x, h / 2, z, { cast: true });
  });

  // Aydınlatma direkleri (akşam yanar)
  const lampHeads = mat({ color: '#2b2f36', emissive: '#ffd27a', emissiveIntensity: 0 });
  const poleMat = mat({ color: '#5b6370', roughness: 0.5, metalness: 0.6 });
  [[-4.6, 12], [4.6, 22], [-4.6, 30], [0.3, -10], [0.3, -24], [0.3, -36]].forEach(([x, z]) => {
    box(0.14, 6, 0.14, poleMat, x, 3, z, { cast: true });
    box(0.9, 0.16, 0.4, lampHeads, x + (x < 0 ? 0.4 : x > 1 ? -0.4 : 0), 6, z);
  });

  // ---- Giriş kapısı: tabela köprüsü, plaka kamerası, bariyer ----
  const steel = mat({ color: '#6c7480', roughness: 0.45, metalness: 0.7 });
  [-4.4, 4.4].forEach((x) => box(0.3, 5.4, 0.3, steel, x, 2.7, 1.8, { cast: true }));
  box(9.2, 0.35, 0.35, steel, 0, 5.3, 1.8, { cast: true });
  const signMat = new THREE.MeshStandardMaterial({ map: signTexture(accent), roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0 });
  disposables.push(signMat, signMat.map);
  const sign = new THREE.Mesh(geo(new THREE.BoxGeometry(6.4, 1.2, 0.14)), [steel, steel, steel, steel, signMat, steel]);
  sign.position.set(0, 4.4, 1.85);
  sign.castShadow = true;
  scene.add(sign);
  // Plaka tanıma kamerası (araca bakar: +Z)
  const camBody = box(0.36, 0.3, 0.7, mat({ color: '#e9ecef', roughness: 0.4 }), -1.4, 4.85, 2.1, { cast: true });
  camBody.rotation.x = 0.28;
  const lens = box(0.2, 0.2, 0.05, mat({ color: '#111', emissive: accent, emissiveIntensity: 0.4 }), -1.4, 4.75, 2.47);
  lens.rotation.x = 0.28;
  // Okuma ışını (koni): kameradan plakaya
  const beamMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  disposables.push(beamMat);
  const beamGeo = geo(new THREE.ConeGeometry(0.55, 1, 24, 1, true));
  beamGeo.translate(0, -0.5, 0);
  beamGeo.rotateX(-Math.PI / 2); // tepe orijinde, gövde +Z yönünde
  const beam = new THREE.Mesh(beamGeo, beamMat);
  scene.add(beam);

  // Bariyer gövdesi + kol (pivot) + ışık
  const yellow = mat({ color: '#e3a525', roughness: 0.5, metalness: 0.1 });
  box(0.55, 1.15, 0.5, yellow, 3.25, 0.575, 0.4, { cast: true });
  box(0.62, 0.08, 0.56, steel, 3.25, 1.18, 0.4, { cast: true });
  const armPivot = new THREE.Group();
  armPivot.position.set(3.05, 1.0, 0.4);
  scene.add(armPivot);
  const stripe = stripeTexture();
  const armMat = new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.4 });
  disposables.push(armMat, stripe);
  const armLen = 5.9;
  const arm = new THREE.Mesh(geo(new THREE.BoxGeometry(armLen, 0.11, 0.07)), armMat);
  arm.position.x = -armLen / 2;
  arm.castShadow = true;
  armPivot.add(arm);
  const redOn = mat({ color: '#3a0d0d', emissive: '#ff2a2a', emissiveIntensity: 2 });
  const greenOn = mat({ color: '#0d2a12', emissive: '#2bff5a', emissiveIntensity: 0 });
  box(0.22, 0.46, 0.08, mat({ color: '#15171a' }), 3.25, 0.82, 0.68);
  const redLamp = box(0.12, 0.12, 0.04, redOn, 3.25, 0.92, 0.73);
  const greenLamp = box(0.12, 0.12, 0.04, greenOn, 3.25, 0.72, 0.73);

  // Hedef cep vurgusu
  const target = slotCenter(TARGET.side, TARGET.index);
  const glowMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0, depthWrite: false });
  disposables.push(glowMat);
  const glow = new THREE.Mesh(geo(new THREE.PlaneGeometry(SLOT_D - 0.3, SLOT_W - 0.3)), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(target.x, 0.035, target.z);
  scene.add(glow);

  // ---- Araç rotası ----
  const route = new THREE.CatmullRomCurve3([
    V(0, 0, STOP_Z), V(0, 0, -3), V(0, 0, -6.5), V(-0.4, 0, -10.2), V(-2.6, 0, target.z + 0.4), V(target.x, 0, target.z),
  ], false, 'centripetal');
  const routeLen = route.getLength();
  const approachLen = START_Z - STOP_Z;

  // ---- Kahraman araç (yüklenince) ----
  const hero = new THREE.Group();
  const heroBody = new THREE.Group();
  heroBody.scale.setScalar(L);
  hero.add(heroBody);
  scene.add(hero);
  let wheels = [];
  let wheelR = 0.079;
  const plateWorld = new THREE.Vector3();
  const plateAnchor = new THREE.Object3D();
  plateAnchor.position.set(0, 0.11, 0.505);
  heroBody.add(plateAnchor);

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: accent, vertexColors: true, metalness: 0.55, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.06,
  });
  const detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 });
  const plateTex = plateTexture(HERO_PLATE);
  const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.45 });
  disposables.push(paintMat, detailMat, plateTex, plateMat);

  const loadHero = async () => {
    const manifest = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error('polycars modelleri bulunamadı (scripts/convert-polycars.mjs çalıştırın)');
      return r.json();
    });
    const entry = (manifest.heroes || []).find((h) => h.id === HERO_MODEL) || manifest.heroes?.[0];
    if (!entry) throw new Error('Kahraman araç modeli yok; convert-polycars.mjs betiğini yeniden çalıştırın');
    wheelR = entry.wheelRadius || wheelR;
    const gltf = await new GLTFLoader().loadAsync(`${BASE}${entry.file}`);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeVertexNormals();
      disposables.push(o.geometry);
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      o.material = o.name === 'paint' ? paintMat : detailMat;
      o.castShadow = true;
      o.receiveShadow = true;
    });
    const parts = [...gltf.scene.children];
    parts.forEach((o) => heroBody.add(o));
    wheels = parts.filter((o) => /^wheel_/.test(o.name));
    // Plakalar (ön + arka)
    const pg = geo(new THREE.PlaneGeometry(0.52 / L, 0.11 / L));
    const front = new THREE.Mesh(pg, plateMat);
    front.position.set(0, 0.11, 0.504);
    const back = new THREE.Mesh(pg, plateMat);
    back.position.set(0, 0.11, -0.504);
    back.rotation.y = Math.PI;
    heroBody.add(front, back);
  };

  // ---- Park etmiş diğer araçlar (polycars filosu) ----
  const parked = []; // { group, slot, start, end }
  const loadParked = async () => {
    const fleet = await loadFleet();
    if (!fleet) return;
    const paintCache = new Map();
    const paintFor = (hex) => {
      if (!paintCache.has(hex)) {
        const m = fleet.materials.paint.clone();
        m.color.set(hex);
        paintCache.set(hex, m);
        disposables.push(m);
      }
      return paintCache.get(hex);
    };
    [-1, 1].forEach((side) => {
      for (let i = 0; i < SLOTS_PER_ROW; i += 1) {
        if (side === TARGET.side && i === TARGET.index) continue;
        const seed = hashSeed(`intro|${side}|${i}`);
        const id = carIdentity(seed, fleet.cars);
        const model = fleet.cars[id.model];
        const g = new THREE.Group();
        const d = new THREE.Mesh(model.detail, fleet.materials.detail);
        d.castShadow = true;
        g.add(d);
        if (model.paint) {
          const pm = new THREE.Mesh(model.paint, paintFor(id.paint));
          pm.castShadow = true;
          g.add(pm);
        }
        const s = Math.min(4.3, (SLOT_W * 0.78) / model.width);
        g.scale.setScalar(s);
        const c = slotCenter(side, i);
        g.position.copy(c);
        g.rotation.y = (side < 0 ? -Math.PI / 2 : Math.PI / 2) + (id.flipped ? Math.PI : 0);
        scene.add(g);
        // Gün içi doluluk planı (saat): sabah dolu olanlar, öğlen gelenler, akşam gidenler
        const r1 = ((seed >>> 8) % 1000) / 1000;
        const r2 = ((seed >>> 18) % 1000) / 1000;
        const start = r1 < 0.62 ? 6 + r1 * 3 : 9 + r1 * 7;
        const end = start + 2 + r2 * 9;
        parked.push({ group: g, start, end });
      }
    });
  };

  const ready = Promise.all([loadHero(), loadParked().catch(() => null)]);

  // ---- Kamera planları (anahtar kareler; araca göre olanlar onu izler) ----
  const carPos = new THREE.Vector3();
  const carDir = new THREE.Vector3(0, 0, -1);
  const keys = [
    { p: 0.0, pos: (c) => c.clone().add(V(5.2, 1.3, -6.8)), look: (c) => c.clone().add(V(0, 0.7, 0)) },
    { p: 0.1, pos: (c) => c.clone().add(V(-4.8, 1.6, -7.4)), look: (c) => c.clone().add(V(0, 0.7, 0)) },
    { p: 0.17, pos: (c) => c.clone().add(V(-7.2, 1.7, 1.5)), look: (c) => c.clone().add(V(0, 0.8, -1.5)) },
    { p: 0.28, pos: (c) => c.clone().add(V(-6.5, 2.2, -3.5)), look: (c) => c.clone().add(V(0, 0.8, -1)) },
    { p: 0.35, pos: () => V(0.9, 1.0, STOP_Z - L / 2 - 3.4), look: () => V(0, 0.55, STOP_Z - L / 2) },
    { p: 0.47, pos: () => V(0.5, 0.85, STOP_Z - L / 2 - 2.6), look: () => V(0, 0.5, STOP_Z - L / 2) },
    { p: 0.53, pos: () => V(6.5, 3.4, STOP_Z + 9.5), look: () => V(0.5, 1.2, 0) },
    { p: 0.62, pos: () => V(4.5, 3.0, STOP_Z + 7.5), look: () => V(0, 1.4, -1) },
    { p: 0.72, pos: (c) => c.clone().add(V(8, 9, 9)), look: (c) => c.clone().add(V(0, 0.5, -1)) },
    { p: 0.82, pos: () => V(target.x + 9, 16, target.z + 13), look: () => V(target.x + 1, 0, target.z) },
    { p: 1.0, pos: () => V(20, 30, -2), look: () => V(0, 0, -20) },
  ];
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  function placeCamera(p, t) {
    let k = 0;
    while (k < keys.length - 2 && p >= keys[k + 1].p) k += 1;
    const a = keys[k];
    const b = keys[k + 1];
    const u = smooth(seg(p, a.p, b.p));
    camPos.copy(a.pos(carPos)).lerp(b.pos(carPos), u);
    camLook.copy(a.look(carPos)).lerp(b.look(carPos), u);
    // Hafif nefes alma (canlı his), son bölümde yavaş tur
    camPos.y += Math.sin(t * 0.6) * 0.05;
    if (p > PHASES.live[0]) {
      const ang = (p - PHASES.live[0]) * 0.9 + t * 0.02;
      const off = camPos.clone().sub(camLook);
      off.applyAxisAngle(V(0, 1, 0), ang * 0.3);
      camPos.copy(camLook).add(off);
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }

  // ---- Durum güncelleme ----
  let width = 1;
  let height = 1;
  const proj = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const sunDay = new THREE.Color('#ffffff');
  const sunEve = new THREE.Color('#ffb36b');
  const skyDay = new THREE.Color('#cfdbe6');
  const skyEve = new THREE.Color('#f0b98e');
  const skyNight = new THREE.Color('#2a3550');

  let target_p = 0;
  let p = 0;
  let last = performance.now();
  let raf = 0;
  let disposed = false;

  function update(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    p += (target_p - p) * (1 - Math.exp(-dt * 7)); // kaydırmaya yumuşak eylemsizlik
    const t = now / 1000;

    // Araç konumu ve gidilen yol
    let dist;
    const drive = easeInOut(seg(p, PHASES.drive[0] + 0.02, PHASES.drive[1]));
    const park = easeInOut(seg(p, PHASES.park[0], PHASES.park[1] - 0.02));
    if (park <= 0) {
      carPos.set(0, 0, START_Z + (STOP_Z - START_Z) * drive);
      carDir.set(0, 0, -1);
      dist = approachLen * drive;
    } else {
      route.getPointAt(park, carPos);
      route.getTangentAt(Math.min(park, 0.999), carDir);
      dist = approachLen + routeLen * park;
    }
    hero.position.copy(carPos);
    hero.rotation.y = Math.atan2(carDir.x, carDir.z);
    wheels.forEach((w) => {
      w.rotation.x = dist / (wheelR * L);
    });
    // Ön tekerlekler virajda döner
    const steer = park > 0 && park < 1 ? Math.max(-0.45, Math.min(0.45, (carDir.x * -1) * 1.2)) : 0;
    wheels.filter((w) => w.name.startsWith('wheel_f')).forEach((w) => {
      w.rotation.order = 'YXZ';
      w.rotation.y = steer;
    });

    // Bariyer: plaka okunduktan sonra kalkar
    const open = smooth(seg(p, PHASES.gate[0] + 0.04, PHASES.gate[1] - 0.03));
    armPivot.rotation.z = -open * THREE.MathUtils.degToRad(84);
    const go = open > 0.6;
    redOn.emissiveIntensity = go ? 0 : 2;
    greenOn.emissiveIntensity = go ? 2.2 : 0;

    // Okuma ışını
    plateAnchor.getWorldPosition(plateWorld);
    const readK = seg(p, PHASES.read[0] - 0.02, PHASES.read[0] + 0.03) * (1 - seg(p, PHASES.gate[0] + 0.02, PHASES.gate[0] + 0.06));
    beamMat.opacity = 0.16 * readK * (0.75 + 0.25 * Math.sin(t * 9));
    beam.visible = readK > 0.001;
    if (beam.visible) {
      const from = V(-1.4, 4.75, 2.47);
      beam.position.copy(from);
      beam.lookAt(plateWorld);
      beam.scale.set(1, 1, from.distanceTo(plateWorld));
    }

    // Hedef cep nabzı
    glowMat.opacity = seg(p, PHASES.gate[1] - 0.04, PHASES.park[0] + 0.02) * (1 - seg(p, PHASES.park[1] - 0.03, PHASES.park[1])) * (0.35 + 0.25 * Math.sin(t * 4));

    // Saat: giriş 08:42; son bölümde 08:00 → 21:00 hızlandırılmış gün
    const liveK = seg(p, PHASES.live[0] + 0.01, PHASES.live[1] - 0.02);
    const hour = liveK > 0 ? 8 + liveK * 13 : 8.7;
    let occ = 0;
    parked.forEach((c) => {
      const on = hour >= c.start && hour <= c.end;
      c.group.visible = on;
      if (on) occ += 1;
    });
    const heroParked = park >= 1;
    const total = SLOTS_PER_ROW * 2;
    const taken = occ + (heroParked || park > 0.5 ? 1 : 0);

    // Gün ışığı: akşam turuncu, gece koyu + direk lambaları
    const eve = seg(hour, 16.5, 19);
    const night = seg(hour, 19, 21);
    sun.color.copy(sunDay).lerp(sunEve, eve);
    sun.intensity = 2.4 * (1 - 0.55 * eve) * (1 - 0.75 * night);
    hemi.intensity = 0.9 * (1 - 0.6 * night);
    scene.background.copy(skyDay).lerp(skyEve, eve).lerp(skyNight, night);
    scene.fog.color.copy(scene.background);
    lampHeads.emissiveIntensity = 3 * seg(hour, 18, 19.5);
    scene.environmentIntensity = (1 - 0.35 * eve) * (1 - 0.7 * night);
    renderer.toneMappingExposure = 1 - 0.25 * night;
    signMat.emissiveIntensity = 0.35 * night;

    placeCamera(p, t);
    renderer.render(scene, camera);

    // HUD: plakanın ekrandaki yeri ve boyu
    proj.copy(plateWorld).project(camera);
    tmp.copy(plateWorld).add(V(Math.cos(hero.rotation.y) * 0.26, 0, -Math.sin(hero.rotation.y) * 0.26)).project(camera);
    const sx = (proj.x * 0.5 + 0.5) * width;
    const sy = (-proj.y * 0.5 + 0.5) * height;
    const pw = Math.abs((tmp.x - proj.x) * 0.5 * width) * 2;
    onHud?.({
      p,
      plate: { x: sx, y: sy, w: pw, visible: proj.z < 1 },
      readK: seg(p, PHASES.read[0] + 0.01, PHASES.read[1] - 0.02),
      recordK: seg(p, PHASES.gate[0] - 0.01, PHASES.gate[0] + 0.03) * (1 - seg(p, PHASES.park[0] + 0.03, PHASES.park[0] + 0.07)),
      open,
      hour,
      free: total - taken,
      total,
      statsK: seg(p, PHASES.park[0] + 0.02, PHASES.park[0] + 0.06),
    });
  }

  function loop(now) {
    if (disposed) return;
    update(now);
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  return {
    ready,
    setProgress(v) {
      target_p = clamp01(v);
    },
    jump(v) {
      target_p = clamp01(v);
      p = target_p;
    },
    resize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // Dar ekranda (telefon) biraz daha geniş açı
      camera.fov = camera.aspect < 0.8 ? 55 : 40;
      // Geniş ekranda metin kartları solda: sahneyi biraz sağa kaydır ki araç kartın altında kalmasın
      if (camera.aspect > 1.15) camera.setViewOffset(width, height, -width * 0.16, 0, width, height);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      scene.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
      });
      disposables.forEach((d) => d.dispose?.());
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}
