import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STATE_LABEL, SLOT_TYPE_LABEL, slotState } from './ParkingMap';
import { THEME_EVENT, cssToken } from '../theme/theme';
import { DUR, EASE, gsap, prefersReducedMotion } from '../utils/motion';
import { carIdentity, hashSeed, loadFleet, plateTexture, randomSeed } from './carFleet';

// Kroki tuvali piksel → dünya birimi (1000 px genişlik ≈ 50 birim)
const S = 0.05;
const SLOT_H = 0.08; // cep zemin plakasının kalınlığı
const LOW_FPS = 20; // bu değerin altında iki ölçüm üst üste → 2D'ye geç
const FPS_WINDOW_MS = 2000;
const MAX_SLOT_LABELS = 260;
const ARRIVE_MS = 1700; // araç cebe girerken
const DEPART_MS = 1500; // araç cepten çıkarken
const PLATE_W = 0.17; // plaka eni (araç boyu = 1; okunabilsin diye gerçeğinden biraz büyük)
const PLATE_Y = 0.11; // plaka yüksekliği (araç boyu = 1)
const easeOut = (p) => 1 - (1 - p) ** 3;
const easeIn = (p) => p * p;


function readColors() {
  const t = (name, fb) => cssToken(name, fb);
  return {
    ground: t('--ap-map-ground', '#e9edf3'),
    road: t('--ap-map-road', '#4a5568'),
    roadLine: t('--ap-map-road-line', '#f5f7fa'),
    building: t('--ap-map-building', '#e3e7ee'),
    buildingLine: t('--ap-map-building-line', '#9aa3b2'),
    elevator: t('--ap-map-elevator', '#3d4657'),
    green: t('--ap-map-green', '#c6efd6'),
    free: t('--ap-slot-free', '#12866a'),
    occupied: t('--ap-slot-occupied', '#a8401a'),
    reserved: t('--ap-slot-reserved', '#e3a21a'),
    disabled: t('--ap-slot-disabled', '#0b67a8'),
    disabledFg: t('--ap-slot-disabled-fg', '#ffffff'),
    inactive: t('--ap-slot-inactive', '#c9ced8'),
    violation: t('--ap-slot-violation', '#c42b3a'),
    focus: t('--ap-slot-focus', '#172033'),
    accent: t('--ap-accent', '#d63a3a'),
    text: t('--ap-text', '#172033'),
    surface: t('--ap-surface', '#ffffff'),
  };
}

// ---- Canvas dokuları ----

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function canvasTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 2D krokideki tekerlekli sandalye çiziminin aynısı (24×24 birimlik yollar) */
function wheelchairTexture(bg, fg) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  roundRect(g, 4, 4, 120, 120, 22);
  g.fill();
  g.save();
  g.translate(22, 20);
  g.scale(84 / 24, 84 / 24);
  g.fillStyle = fg;
  g.beginPath();
  g.arc(12.5, 3.2, 2.3, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = fg;
  g.lineWidth = 2.3;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke(new Path2D('M11.5 7.2 V13.2 H17 L19.6 19'));
  g.stroke(new Path2D('M11.5 10 H16'));
  g.stroke(new Path2D('M8.3 11.6 A5.6 5.6 0 1 0 15.8 18.4'));
  g.restore();
  return canvasTexture(c);
}

function textTexture(text, { fg, bg, w = 256, h = 96, font = 56, radius = 40 }) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (bg) {
    g.fillStyle = bg;
    roundRect(g, 2, 2, w - 4, h - 4, radius);
    g.fill();
  }
  g.fillStyle = fg;
  g.font = `700 ${font}px "Inter Variable", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2, w - 12);
  return canvasTexture(c);
}

/** Bir grubun altındaki tüm geometri, malzeme ve dokuları serbest bırakır */
function disposeGroup(group) {
  group.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();
    if (!o.userData.keepGeometry) o.geometry?.dispose();
    if (o.userData.keepGeometry) return; // paylaşılan araç modeli ve malzemesi
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    mats.forEach((m) => {
      Object.values(m).forEach((v) => v?.isTexture && v.dispose());
      m.dispose();
    });
  });
  group.clear();
}

// ---- Sahne parçaları ----

function buildStatic(group, { viewW, viewH, decor, colors, fleet }) {
  const toX = (x) => (x - viewW / 2) * S;
  const toZ = (y) => (y - viewH / 2) * S;
  const W = viewW * S;
  const H = viewH * S;

  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(W + 2, 0.4, H + 2),
    new THREE.MeshStandardMaterial({ color: colors.ground, roughness: 0.95 }),
  );
  ground.position.y = -0.2;
  ground.receiveShadow = true;
  group.add(ground);

  const box = (d, height, color, extra = {}) => {
    const w = Math.max(1, Number(d.w) || 0) * S;
    const h = Math.max(1, Number(d.h) || 0) * S;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, height, h), new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra }));
    m.position.set(toX((Number(d.x) || 0) + (Number(d.w) || 0) / 2), height / 2, toZ((Number(d.y) || 0) + (Number(d.h) || 0) / 2));
    group.add(m);
    return m;
  };

  const flatLabel = (text, d, fg, bg, scale = 1) => {
    const w = (Number(d.w) || 0) * S;
    const h = (Number(d.h) || 0) * S;
    const tex = textTexture(text, { fg, bg, w: 256, h: 96, font: 52 });
    const pw = Math.min(w * 0.9, 6 * scale);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(pw, pw * (96 / 256)),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    plane.rotation.x = -Math.PI / 2;
    if (h > w * 1.4) plane.rotation.z = Math.PI / 2;
    plane.position.set(toX((Number(d.x) || 0) + (Number(d.w) || 0) / 2), 0.07, toZ((Number(d.y) || 0) + (Number(d.h) || 0) / 2));
    group.add(plane);
  };

  decor.forEach((d) => {
    switch (d.type) {
      case 'road': {
        const road = box(d, 0.03, colors.road, { roughness: 1 });
        road.receiveShadow = true;
        const w = (Number(d.w) || 0) * S;
        const h = (Number(d.h) || 0) * S;
        if (Math.min(w, h) >= 1.1) {
          // Kesikli orta çizgi
          const horizontal = w >= h;
          const len = horizontal ? w : h;
          const n = Math.floor(len / 1.9);
          const geo = new THREE.PlaneGeometry(horizontal ? 1.1 : 0.12, horizontal ? 0.12 : 1.1);
          const mat = new THREE.MeshBasicMaterial({ color: colors.roadLine });
          const dashes = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
          const m4 = new THREE.Matrix4();
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
          const sc = new THREE.Vector3(1, 1, 1);
          for (let i = 0; i < n; i += 1) {
            const off = -len / 2 + 0.95 + i * 1.9;
            const p = new THREE.Vector3(road.position.x + (horizontal ? off : 0), 0.035, road.position.z + (horizontal ? 0 : off));
            dashes.setMatrixAt(i, m4.compose(p, q, sc));
          }
          dashes.count = n;
          group.add(dashes);
        }
        break;
      }
      case 'entry':
      case 'exit': {
        const isEntry = d.type === 'entry';
        box(d, 0.06, isEntry ? colors.free : colors.occupied, { roughness: 0.6 });
        flatLabel(d.text || (isEntry ? 'GİRİŞ' : 'ÇIKIŞ'), d, '#ffffff', null);
        // Giriş/çıkış şeridinin köşelerine trafik konileri
        if (fleet?.cone?.detail) {
          const x0 = toX(Number(d.x) || 0);
          const z0 = toZ(Number(d.y) || 0);
          const w = (Number(d.w) || 0) * S;
          const h = (Number(d.h) || 0) * S;
          const cones = new THREE.InstancedMesh(fleet.cone.detail, fleet.materials.detail, 4);
          const m4 = new THREE.Matrix4();
          const sc = new THREE.Vector3(0.6, 0.6, 0.6);
          const q = new THREE.Quaternion();
          [[0.15, 0.15], [w - 0.15, 0.15], [0.15, h - 0.15], [w - 0.15, h - 0.15]].forEach(([dx, dz], i) => {
            cones.setMatrixAt(i, m4.compose(new THREE.Vector3(x0 + dx, 0.06, z0 + dz), q, sc));
          });
          cones.castShadow = true;
          cones.userData.keepGeometry = true;
          group.add(cones);
        }
        break;
      }
      case 'building': {
        const b = box(d, 3.2, colors.building, { roughness: 0.7 });
        b.castShadow = true;
        b.receiveShadow = true;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(b.geometry), new THREE.LineBasicMaterial({ color: colors.buildingLine }));
        edges.position.copy(b.position);
        group.add(edges);
        if (d.text) {
          const tex = textTexture(d.text, { fg: colors.text, bg: colors.surface, w: 512, h: 112, font: 54, radius: 24 });
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
          sp.scale.set(6, 6 * (112 / 512), 1);
          sp.position.set(b.position.x, 4.2, b.position.z);
          sp.renderOrder = 5;
          group.add(sp);
        }
        break;
      }
      case 'elevator': {
        const e = box(d, 2.6, colors.elevator, { roughness: 0.5 });
        e.castShadow = true;
        break;
      }
      case 'green': {
        box(d, 0.05, colors.green, { roughness: 1 });
        // Basit ağaçlar (deterministik dağılım, tek InstancedMesh)
        const w = (Number(d.w) || 0) * S;
        const h = (Number(d.h) || 0) * S;
        const step = Math.max(1.4, Math.min(w, h) * 0.45);
        const pts = [];
        for (let tx = step / 2; tx < w; tx += step) for (let tz = step / 2; tz < h; tz += step) pts.push([tx, tz]);
        const list = pts.slice(0, 40);
        if (list.length) {
          const tree = new THREE.InstancedMesh(
            new THREE.ConeGeometry(0.45, 1.3, 7),
            new THREE.MeshStandardMaterial({ color: new THREE.Color(colors.green).multiplyScalar(0.55), roughness: 0.9 }),
            list.length,
          );
          const m4 = new THREE.Matrix4();
          const x0 = toX(Number(d.x) || 0);
          const z0 = toZ(Number(d.y) || 0);
          list.forEach(([tx, tz], i) => m4.makeTranslation(x0 + tx, 0.7, z0 + tz) && tree.setMatrixAt(i, m4));
          tree.castShadow = true;
          group.add(tree);
        }
        break;
      }
      case 'label': {
        if (String(d.text || '').length <= 3) {
          const tex = textTexture(String(d.text), { fg: '#ffffff', bg: colors.focus, w: 128, h: 128, font: 72, radius: 64 });
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
          const cx = toX((Number(d.x) || 0) + (Number(d.w) || 0) / 2);
          const cz = toZ((Number(d.y) || 0) + (Number(d.h) || 0) / 2);
          sp.position.set(cx, 2.4, cz);
          sp.scale.set(1.8, 1.8, 1);
          sp.renderOrder = 6;
          group.add(sp);
        } else {
          flatLabel(String(d.text), d, colors.text, null, 1.4);
        }
        break;
      }
      default:
        break;
    }
  });
}

/** Cepler: durum rengi, araç, engelli simgesi/tabelası, seçim ve ihlal halkası */
/** Cep merkezine en yakın yol parçasının (dikdörtgen) en yakın noktası */
function nearestRoad(roads, x, z) {
  let best = null;
  let bestD = Infinity;
  roads.forEach((r) => {
    const px = Math.min(r.x1, Math.max(r.x0, x));
    const pz = Math.min(r.z1, Math.max(r.z0, z));
    const dd = (px - x) ** 2 + (pz - z) ** 2;
    if (dd < bestD) {
      bestD = dd;
      best = { x: px, z: pz };
    }
  });
  return best;
}

function buildSlots(group, pickables, { items, viewW, viewH, colors, selectedSlot, highlightSlot, wheelchair, fleet, seeds, arrivals, sceneKey, decor = [] }) {
  const toX = (x) => (x - viewW / 2) * S;
  const toZ = (y) => (y - viewH / 2) * S;
  const roads = decor
    .filter((d) => d?.type === 'road' || d?.type === 'entry' || d?.type === 'exit')
    .map((d) => ({
      x0: toX(Number(d.x) || 0),
      z0: toZ(Number(d.y) || 0),
      x1: toX((Number(d.x) || 0) + (Number(d.w) || 0)),
      z1: toZ((Number(d.y) || 0) + (Number(d.h) || 0)),
    }));
  const mats = new Map();
  const mat = (key, make) => {
    if (!mats.has(key)) mats.set(key, make());
    return mats.get(key);
  };
  const stateColor = { free: colors.free, occupied: colors.occupied, reserved: colors.reserved, inactive: colors.inactive };
  const pulse = [];
  const carBody = new THREE.MeshStandardMaterial({ color: '#39414f', roughness: 0.45, metalness: 0.35 });
  const carGlass = new THREE.MeshStandardMaterial({ color: '#9fb6cc', roughness: 0.15, metalness: 0.5 });
  const wcPlate = new THREE.MeshBasicMaterial({ map: wheelchair, transparent: true });
  const wcSign = new THREE.SpriteMaterial({ map: wheelchair, depthTest: true });
  const postMat = new THREE.MeshStandardMaterial({ color: '#8a93a3', roughness: 0.6, metalness: 0.4 });
  const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6);
  group.userData.shared = [carBody, carGlass, wcPlate, wcSign, postMat, postGeo];

  const showCodes = items.length <= MAX_SLOT_LABELS;
  const cars = [];

  items.forEach((it) => {
    const { slot, g, st, dis, viol } = it;
    const w = g.w * S;
    const d = g.h * S;
    const cx = toX(g.x + g.w / 2);
    const cz = toZ(g.y + g.h / 2);
    const portrait = g.h >= g.w;
    const isSel = selectedSlot && slot.code === selectedSlot;
    const isHi = highlightSlot && slot.code === highlightSlot;

    // Zemin plakası: renk = durum; boş engelli cep engelli mavisiyle
    const baseColor = dis && st === 'free' ? colors.disabled : stateColor[st];
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.94, SLOT_H, d * 0.94),
      mat(`base-${baseColor}-${st}`, () =>
        new THREE.MeshStandardMaterial({
          color: baseColor,
          roughness: 0.7,
          transparent: st === 'inactive',
          opacity: st === 'inactive' ? 0.55 : 1,
        }),
      ),
    );
    base.position.set(cx, SLOT_H / 2 + (isSel ? 0.06 : 0), cz);
    base.receiveShadow = true;
    base.userData.slot = slot;
    base.userData.isBase = true;
    group.add(base);
    pickables.push(base);

    // Rezerve: kenar çizgisi koyu sarı (rengin yanında ikinci işaret)
    if (st === 'reserved' || isSel || isHi || viol) {
      const color = viol ? colors.violation : isSel ? colors.focus : isHi ? colors.accent : '#7a5200';
      const ring = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(w * 0.98, SLOT_H + 0.05, d * 0.98)),
        new THREE.LineBasicMaterial({ color, transparent: true }),
      );
      ring.position.copy(base.position);
      group.add(ring);
      if (viol || isHi) pulse.push(ring.material);
    }

    // Engelli: zemine boyanmış simge + direk üstünde tabela (dolu iken de görünür)
    if (dis && st !== 'inactive') {
      const s = Math.min(w, d) * 0.62;
      if (st !== 'occupied') {
        const icon = new THREE.Mesh(new THREE.PlaneGeometry(s, s), wcPlate);
        icon.rotation.x = -Math.PI / 2;
        icon.position.set(cx, SLOT_H + 0.012 + (isSel ? 0.06 : 0), cz + (portrait ? d * 0.08 : 0));
        icon.userData.slot = slot;
        group.add(icon);
      }
      const px = portrait ? cx : cx - w * 0.44;
      const pz = portrait ? cz - d * 0.44 : cz;
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(px, 0.8, pz);
      group.add(post);
      const sign = new THREE.Sprite(wcSign);
      sign.scale.set(0.9, 0.9, 1);
      sign.position.set(px, 1.95, pz);
      sign.userData.slot = slot;
      group.add(sign);
      pickables.push(sign);
    }

    // Dolu cepte araç: polycars modeli (yoksa basit kutu)
    if (st === 'occupied' && fleet) {
      const slotW = portrait ? w : d;
      const slotL = portrait ? d : w;
      const seed = seeds.get(`${sceneKey}|${slot.code}`) ?? hashSeed(`${sceneKey}|${slot.code}`);
      const id = carIdentity(seed, fleet.cars);
      const model = fleet.cars[id.model];
      const scale = Math.min(slotL * 0.8, (slotW * 0.8) / model.width);
      const rotY = (portrait ? 0 : Math.PI / 2) + (id.flipped ? Math.PI : 0);
      // Araç cebe koridor (en yakın yol) tarafından girer, oradan çıkar
      const axis = portrait ? [0, 1] : [1, 0];
      const road = nearestRoad(roads, cx, cz);
      const sign = road ? Math.sign((road.x - cx) * axis[0] + (road.z - cz) * axis[1]) || 1 : 1;
      cars.push({
        slot, x: cx, z: cz, y: SLOT_H + (isSel ? 0.06 : 0), rotY, scale, id, model,
        dir: [axis[0] * sign * slotL * 1.6, axis[1] * sign * slotL * 1.6],
        t0: arrivals.get(slot.code),
      });
    } else if (st === 'occupied') {
      const bw = (portrait ? w : d) * 0.56;
      const bl = (portrait ? d : w) * 0.7;
      const car = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.5, bl), carBody);
      body.position.y = 0.33;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.86, 0.4, bl * 0.5), carGlass);
      cabin.position.set(0, 0.78, -bl * 0.04);
      body.castShadow = true;
      cabin.castShadow = true;
      body.userData.slot = slot;
      cabin.userData.slot = slot;
      car.add(body, cabin);
      if (!portrait) car.rotation.y = Math.PI / 2;
      car.position.set(cx, SLOT_H, cz);
      group.add(car);
      pickables.push(body, cabin);
    }

    // Cep kodu (zemine yatık)
    if (showCodes) {
      const tex = textTexture(slot.code, { fg: '#ffffff', bg: 'rgba(0,0,0,0.38)', w: 160, h: 64, font: 40, radius: 16 });
      const lw = Math.min(portrait ? w * 0.86 : w * 0.4, 1.8);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(lw, lw * 0.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      label.rotation.x = -Math.PI / 2;
      label.position.set(portrait ? cx : cx + w * 0.28, SLOT_H + 0.015 + (isSel ? 0.06 : 0), portrait ? cz + d * 0.38 : cz);
      if (!portrait) label.rotation.z = Math.PI / 2;
      group.add(label);
    }
  });

  group.userData.cached = Array.from(mats.values());
  const animate = cars.length ? buildCars(group, pickables, cars, fleet, showCodes) : null;
  return { pulse, animate, cars };
}

/** Araç konumunu (0 = yolda, 1 = cepte) örnek matrisine ve plaka grubuna yazar */
function placeCar(c, p, m4, q, v, sc) {
  const k = 1 - easeOut(p);
  v.set(c.x + c.dir[0] * k, c.y, c.z + c.dir[1] * k);
  q.setFromAxisAngle(UP, c.rotY);
  sc.setScalar(c.scale);
  m4.compose(v, q, sc);
  c.meshes.forEach((mesh) => mesh.setMatrixAt(c.index, m4));
  c.plates?.position.copy(v);
}

const UP = new THREE.Vector3(0, 1, 0);

/** Aynı modeldeki araçlar tek InstancedMesh ile çizilir (10 model ≈ 20 çizim çağrısı) */
function buildCars(group, pickables, cars, fleet, showPlates) {
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const color = new THREE.Color();
  const byModel = new Map();
  cars.forEach((c) => {
    if (!byModel.has(c.id.model)) byModel.set(c.id.model, []);
    byModel.get(c.id.model).push(c);
  });
  byModel.forEach((list, idx) => {
    const model = fleet.cars[idx];
    const detail = new THREE.InstancedMesh(model.detail, fleet.materials.detail, list.length);
    const paint = model.paint ? new THREE.InstancedMesh(model.paint, fleet.materials.paint, list.length) : null;
    [detail, paint].forEach((mesh) => {
      if (!mesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false; // giriş animasyonunda örnekler sınır küresinin dışına çıkar
      mesh.userData.keepGeometry = true;
      group.add(mesh);
    });
    list.forEach((c, i) => {
      c.meshes = paint ? [detail, paint] : [detail];
      c.index = i;
      if (paint) paint.setColorAt(i, color.set(c.id.paint));
    });
  });

  // Plakalar (ön + arka); kalabalık katlarda cep kodları gibi kapatılır
  if (showPlates) {
    const plateGeo = new THREE.PlaneGeometry(PLATE_W, PLATE_W * (56 / 256));
    cars.forEach((c) => {
      const mat = new THREE.MeshStandardMaterial({ map: plateTexture(c.id.plate), roughness: 0.5 });
      const g = new THREE.Group();
      const half = 0.5 + 0.004;
      const front = new THREE.Mesh(plateGeo, mat);
      front.position.set(0, PLATE_Y, half);
      const back = new THREE.Mesh(plateGeo, mat);
      back.position.set(0, PLATE_Y, -half);
      back.rotation.y = Math.PI;
      g.add(front, back);
      g.rotation.y = c.rotY;
      g.scale.setScalar(c.scale);
      c.plates = g;
      group.add(g);
    });
  }

  // Tıklama/üzerine gelme: araç başına basit kutu (yüksek poligonlu modele ışın atmamak için)
  const pick = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }), cars.length);
  cars.forEach((c, i) => {
    v.set(c.x, c.y + (c.model.height * c.scale) / 2, c.z);
    q.setFromAxisAngle(UP, c.rotY);
    sc.set(c.model.width * c.scale, c.model.height * c.scale, c.scale);
    pick.setMatrixAt(i, m4.compose(v, q, sc));
  });
  pick.userData.instSlots = cars.map((c) => c.slot);
  group.add(pick);
  pickables.push(pick);

  const step = (now) => {
    let active = false;
    cars.forEach((c) => {
      const p = c.t0 ? Math.min(1, (now - c.t0) / ARRIVE_MS) : 1;
      if (p < 1) active = true;
      if (c.drawnP === p) return;
      c.drawnP = p;
      placeCar(c, p, m4, q, v, sc);
      c.meshes.forEach((mesh) => {
        mesh.instanceMatrix.needsUpdate = true;
      });
    });
    return active;
  };
  step(performance.now());
  return step;
}

/** Cepten ayrılan aracı geri geri yola çıkarıp soldurur; bitince kendini temizler */
function spawnDeparture(parent, fleet, c) {
  const g = new THREE.Group();
  const mats = [];
  const detailMat = fleet.materials.detail.clone();
  detailMat.transparent = true;
  mats.push(detailMat);
  g.add(new THREE.Mesh(c.model.detail, detailMat));
  if (c.model.paint) {
    const paintMat = fleet.materials.paint.clone();
    paintMat.color.set(c.id.paint);
    paintMat.transparent = true;
    mats.push(paintMat);
    g.add(new THREE.Mesh(c.model.paint, paintMat));
  }
  const plateTex = plateTexture(c.id.plate);
  const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5, transparent: true });
  mats.push(plateMat);
  const plateGeo = new THREE.PlaneGeometry(PLATE_W, PLATE_W * (56 / 256));
  [1, -1].forEach((sgn) => {
    const pm = new THREE.Mesh(plateGeo, plateMat);
    pm.position.set(0, PLATE_Y, sgn * 0.504);
    if (sgn < 0) pm.rotation.y = Math.PI;
    g.add(pm);
  });
  g.children.forEach((o) => {
    o.castShadow = true;
  });
  g.rotation.y = c.rotY;
  g.scale.setScalar(c.scale);
  g.position.set(c.x, c.y, c.z);
  parent.add(g);
  const t0 = performance.now();
  return (now) => {
    const p = Math.min(1, (now - t0) / DEPART_MS);
    const k = easeIn(p); // koridora doğru çıkış
    g.position.set(c.x + c.dir[0] * k, c.y, c.z + c.dir[1] * k);
    const alpha = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45;
    mats.forEach((m) => {
      m.opacity = alpha;
    });
    if (p < 1) return true;
    parent.remove(g);
    mats.forEach((m) => m.dispose());
    plateTex.dispose();
    plateGeo.dispose();
    return false;
  };
}

/**
 * Three.js ile 3D otopark krokisi (aşama 3).
 *  items       : [{ slot, g, st, dis, viol }] — ParkingView aktif kat için hazırlar
 *  decor       : aktif katın süsleri
 *  focusBox    : { minX, minY, maxX, maxY } — kamera bu alana odaklanır (blok seçimi)
 *  onSlotClick : (slot) => void
 *  onLowPerformance(fps) / onError(err) : 2D yedeğe geçiş için
 */
export default function ParkingMap3D({
  viewW,
  sceneKey,
  viewH,
  items,
  decor,
  focusBox,
  selectedSlot,
  highlightSlot,
  zoneName,
  onSlotClick,
  onLowPerformance,
  onError,
}) {
  const mountRef = useRef(null);
  const ctx = useRef(null);
  const [colorsVersion, setColorsVersion] = useState(0);
  const [hover, setHover] = useState(null);
  const [fleet, setFleet] = useState(null);
  const cb = useRef({});
  cb.current = { onSlotClick, onLowPerformance, onError };

  const colors = useMemo(() => readColors(), [colorsVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // polycars araç modelleri (yoksa kutu araçlarla devam edilir)
  useEffect(() => {
    let alive = true;
    loadFleet().then((f) => alive && f && setFleet(f));
    return () => {
      alive = false;
    };
  }, []);

  // Tema değişince renkleri yeniden oku
  useEffect(() => {
    const onTheme = () => setTimeout(() => setColorsVersion((v) => v + 1), 0);
    window.addEventListener(THEME_EVENT, onTheme);
    return () => window.removeEventListener(THEME_EVENT, onTheme);
  }, []);

  // 1) Renderer, sahne, kamera, kontroller, döngü (bir kez)
  useEffect(() => {
    const mount = mountRef.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      cb.current.onError?.(err);
      return undefined;
    }
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.domElement.className = 'pm3d-canvas';
    renderer.domElement.setAttribute('role', 'img');
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 400);
    camera.position.set(0, 38, 34);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.3));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-18, 40, 22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 35, bottom: -35, near: 1, far: 120 });
    scene.add(sun);

    const staticGroup = new THREE.Group();
    const slotGroup = new THREE.Group();
    const fxGroup = new THREE.Group(); // cepten ayrılan araçlar
    scene.add(staticGroup, slotGroup, fxGroup);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !reduceMotion;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.25; // zeminin altına inmesin
    controls.minDistance = 8;
    controls.maxDistance = 120;
    controls.screenSpacePanning = false;

    const state = {
      renderer,
      scene,
      camera,
      controls,
      staticGroup,
      slotGroup,
      fxGroup,
      seeds: new Map(),
      arrivals: new Map(),
      departures: [],
      carAnim: null,
      pickables: [],
      pulse: [],
      fly: null,
      reduceMotion,
      wheelchair: null,
    };
    ctx.current = state;

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    // Tıklama / üzerine gelme (raycast)
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pick = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(state.pickables, false)[0];
      if (!hit) return null;
      return hit.object.userData.slot || hit.object.userData.instSlots?.[hit.instanceId] || null;
    };
    let down = null;
    const onDown = (e) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e) => {
      if (!down) return;
      const moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
      down = null;
      if (moved > 6) return;
      const slot = pick(e);
      if (slot) cb.current.onSlotClick?.(slot);
    };
    let lastHover = null;
    const onMove = (e) => {
      if (e.buttons) return;
      const slot = pick(e);
      renderer.domElement.style.cursor = slot ? 'pointer' : 'grab';
      const r = mount.getBoundingClientRect();
      if (slot || lastHover) setHover(slot ? { slot, x: e.clientX - r.left, y: e.clientY - r.top, w: r.width } : null);
      lastHover = slot;
    };
    const onLeave = () => {
      lastHover = null;
      setHover(null);
    };
    const onLost = (e) => {
      e.preventDefault();
      cb.current.onError?.(new Error('WebGL bağlamı kayboldu'));
    };
    const el = renderer.domElement;
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('webglcontextlost', onLost);

    // Döngü + FPS izleme
    const timer = new THREE.Timer();
    timer.connect(document);
    let frames = 0;
    let windowStart = performance.now();
    let slowWindows = 0;
    let reported = false;
    renderer.setAnimationLoop(() => {
      timer.update();
      const dt = Math.min(timer.getDelta(), 0.1);
      const t = timer.getElapsed();

      if (state.fly) {
        const k = state.reduceMotion ? 1 : 1 - Math.exp(-dt * 5);
        controls.target.lerp(state.fly.target, k);
        camera.position.lerp(state.fly.position, k);
        if (camera.position.distanceTo(state.fly.position) < 0.05) state.fly = null;
      }
      controls.update();
      const now = performance.now();
      if (state.carAnim && !state.carAnim(now)) state.carAnim = null;
      if (state.departures.length) state.departures = state.departures.filter((step) => step(now));
      if (!state.reduceMotion) {
        const a = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 5));
        state.pulse.forEach((m) => {
          m.opacity = a;
        });
      }
      renderer.render(scene, camera);

      // Arka plandaki sekmede ölçme (rAF yavaşlatılır)
      frames += 1;
      if (now - windowStart >= FPS_WINDOW_MS) {
        const fps = (frames * 1000) / (now - windowStart);
        frames = 0;
        windowStart = now;
        if (document.hidden) return;
        slowWindows = fps < LOW_FPS ? slowWindows + 1 : 0;
        if (slowWindows >= 2 && !reported) {
          reported = true;
          cb.current.onLowPerformance?.(Math.round(fps));
        }
      }
    });

    return () => {
      renderer.setAnimationLoop(null);
      timer.dispose();
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('webglcontextlost', onLost);
      controls.dispose();
      disposeGroup(staticGroup);
      disposeGroup(slotGroup);
      state.departures.forEach((step) => step(Infinity));
      state.departures = [];
      state.wheelchair?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      el.remove();
      ctx.current = null;
    };
  }, []);

  // 2) Zemin + süsler
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    c.scene.background = new THREE.Color(colors.ground).multiplyScalar(0.92);
    disposeGroup(c.staticGroup);
    buildStatic(c.staticGroup, { viewW, viewH, decor, colors, fleet });
  }, [viewW, viewH, decor, colors, fleet]);

  // 3) Cepler
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    if (!c.wheelchair || c.wheelchairKey !== colors.disabled) {
      c.wheelchair?.dispose();
      c.wheelchair = wheelchairTexture(colors.disabled, colors.disabledFg);
      c.wheelchairKey = colors.disabled;
    }
    const shared = c.slotGroup.userData.shared || [];
    const cached = c.slotGroup.userData.cached || [];
    // Paylaşılan dokuyu (wheelchair) silmeden grubu temizle
    c.slotGroup.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.userData.keepGeometry) return; // paylaşılan araç modeli ve malzemesi
      if (o.geometry && !shared.includes(o.geometry)) o.geometry.dispose();
      if (o.material && !shared.includes(o.material) && !cached.includes(o.material)) {
        if (o.material.map && o.material.map !== c.wheelchair) o.material.map.dispose();
        o.material.dispose();
      }
    });
    shared.forEach((x) => x.dispose());
    cached.forEach((m) => m.dispose());
    c.slotGroup.clear();
    c.pickables = [];

    // Araç kimlikleri: cep dolunca yeni araç (yeni model/renk/plaka) gelir ve
    // aynı sahnede izleniyorsa cebe girerken, boşalınca çıkarken canlandırılır.
    const sameSceneCars = c.prevCarScene === sceneKey;
    const animate = sameSceneCars && !!fleet && !c.reduceMotion && !prefersReducedMotion();
    const occupiedNow = new Set(items.filter((it) => it.st === 'occupied').map((it) => it.slot.code));
    const now = performance.now();
    occupiedNow.forEach((code) => {
      const key = `${sceneKey}|${code}`;
      if (c.seeds.has(key)) return;
      const fresh = animate && c.prevOccupied && !c.prevOccupied.has(code);
      c.seeds.set(key, fresh ? randomSeed() : hashSeed(key));
      if (fresh) c.arrivals.set(code, now);
    });
    (c.prevOccupied || new Set()).forEach((code) => {
      if (!sameSceneCars || occupiedNow.has(code) || !items.some((it) => it.slot.code === code)) return;
      c.seeds.delete(`${sceneKey}|${code}`);
      c.arrivals.delete(code);
      const last = c.lastCars?.get(code);
      if (animate && last) c.departures.push(spawnDeparture(c.fxGroup, fleet, last));
    });
    if (!sameSceneCars) c.arrivals.clear();
    c.arrivals.forEach((t0, code) => {
      if (now - t0 > ARRIVE_MS) c.arrivals.delete(code);
    });

    const built = buildSlots(c.slotGroup, c.pickables, {
      items,
      viewW,
      viewH,
      colors,
      selectedSlot,
      highlightSlot,
      wheelchair: c.wheelchair,
      fleet,
      seeds: c.seeds,
      arrivals: c.arrivals,
      sceneKey,
      decor,
    });
    c.pulse = built.pulse;
    c.carAnim = built.animate;
    c.lastCars = new Map(built.cars.map((car) => [car.slot.code, car]));
    c.prevOccupied = occupiedNow;
    c.prevCarScene = sceneKey;

    // Doluluk değişen cepte eski renkten yenisine kısa geçiş (aynı otopark/tema içinde)
    (c.colorTweens || []).forEach((t) => t.kill());
    c.colorTweens = [];
    const prev = c.prevColors || new Map();
    const next = new Map();
    const sameScene = c.prevKey === sceneKey && c.prevColorsRef === colors;
    c.slotGroup.children.forEach((o) => {
      if (!o.userData.isBase) return;
      const code = o.userData.slot.code;
      const to = o.material.color.getHex();
      next.set(code, to);
      const from = prev.get(code);
      if (!sameScene || from === undefined || from === to || prefersReducedMotion()) return;
      o.material = o.material.clone(); // paylaşılan malzemeyi değiştirmemek için
      o.material.color.setHex(from);
      const target = new THREE.Color(to);
      c.colorTweens.push(gsap.to(o.material.color, { r: target.r, g: target.g, b: target.b, duration: DUR.color, ease: EASE.inOut }));
    });
    c.prevColors = next;
    c.prevKey = sceneKey;
    c.prevColorsRef = colors;
  }, [items, viewW, viewH, colors, selectedSlot, highlightSlot, sceneKey, fleet, decor]);

  // 4) Kamera çerçeveleme: otopark/kat değişince ya da blok seçilince
  const focusKey = focusBox ? `${focusBox.minX}|${focusBox.minY}|${focusBox.maxX}|${focusBox.maxY}` : `all-${viewW}-${viewH}`;
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const b = focusBox || { minX: 0, minY: 0, maxX: viewW, maxY: viewH };
    const cx = ((b.minX + b.maxX) / 2 - viewW / 2) * S;
    const cz = ((b.minY + b.maxY) / 2 - viewH / 2) * S;
    const span = Math.max((b.maxX - b.minX) * S, ((b.maxY - b.minY) * S) / Math.max(0.6, c.camera.aspect) * 1.2, 10);
    const dist = span * 0.95 + 6;
    c.fly = {
      target: new THREE.Vector3(cx, 0, cz),
      position: new THREE.Vector3(cx - dist * 0.12, dist * 0.82, cz + dist * 0.62),
    };
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetView = () => {
    const c = ctx.current;
    if (!c) return;
    const span = Math.max(viewW * S, 10);
    const dist = span * 0.95 + 6;
    c.fly = { target: new THREE.Vector3(0, 0, 0), position: new THREE.Vector3(-dist * 0.12, dist * 0.82, dist * 0.62) };
  };

  return (
    <div className="pm3d" ref={mountRef} aria-label="3D otopark krokisi — fareyle sürükleyerek döndürün, tekerlekle yakınlaştırın">
      <div className="pm3d-hint small" aria-hidden="true">
        <i aria-hidden="true" className="bi bi-mouse me-1" />
        Sürükle: döndür · Sağ tık: kaydır · Tekerlek: yakınlaştır
      </div>
      <button type="button" className="btn btn-sm btn-light border pm3d-reset" onClick={resetView} title="Görünümü sıfırla">
        <i aria-hidden="true" className="bi bi-arrows-fullscreen me-1" />
        Sıfırla
      </button>
      {hover && (
        <div
          className="pm-tooltip shadow"
          style={{ left: Math.min(hover.x + 14, Math.max(0, hover.w - 220)), top: hover.y + 16 }}
          role="tooltip"
        >
          <div className="d-flex align-items-center gap-2 mb-1">
            <strong className="fs-6">{hover.slot.code}</strong>
            <span className={`badge pm-tip-state pm-tip-${slotState(hover.slot)}`}>{STATE_LABEL[slotState(hover.slot)]}</span>
          </div>
          <div>
            Tür: <strong>{SLOT_TYPE_LABEL[hover.slot.type] || 'Standart'}</strong>
          </div>
          {zoneName && (
            <div>
              Bölge: <strong>{zoneName(hover.slot)}</strong>
            </div>
          )}
          <div className="text-secondary small mt-1">Ayrıntı için tıklayın</div>
        </div>
      )}
    </div>
  );
}

