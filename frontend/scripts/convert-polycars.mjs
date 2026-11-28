// polycars FBX paketini 3D kroki için hafif GLB dosyalarına çevirir.
//
// Kullanım (frontend klasöründen):
//   node scripts/convert-polycars.mjs "C:\Users\<kullanici>\Desktop\polycars"
//
// Her model tek bir ağa (mesh) birleştirilir, renkler köşe rengine (COLOR_0) gömülür,
// uzun kenar +Z yönüne çevrilir, taban y=0'a oturtulur ve boy 1 birime ölçeklenir.
// Gövde boyası ayrı parça ('paint') olarak yazılır; tarayıcı her araca farklı renk verir.
// Çıktı: public/models/polycars/*.glb + manifest.json
//
// LİSANS: paket lisansı ham/değiştirilmiş model dosyalarının açık depolarda
// paylaşılmasını yasaklar. Bu yüzden çıktı klasörü .gitignore'dadır; her makinede
// bu betikle yeniden üretin.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

// FBXLoader dokuları <img> ile yüklemeye çalışır; Node'da sahte belge yeterli
// (doku piksellerini aşağıda kendi PNG çözücümüzle okuyoruz).
globalThis.self ??= globalThis;
globalThis.document ??= {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }),
};

const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2] || path.resolve(here, '../../../polycars');
const OUT = path.resolve(here, '../public/models/polycars');

const CARS = [
  ['Beatall.fbx', 'beatall'],
  ['docLorean.fbx', 'doclorean'],
  ['Landyroamer.fbx', 'landyroamer'],
  ['Toyoyo Highlight.fbx', 'toyoyo-highlight'],
  ['Tristar Racer.fbx', 'tristar-racer'],
  ['Exports/Multiplx.fbx', 'multiplx'],
  ['Exports/Smarty.fbx', 'smarty'],
  ['Exports/Stuttgart996.fbx', 'stuttgart996'],
  ['Exports/Tois08_GT.fbx', 'tois08-gt'],
  ['Exports/Toro86.fbx', 'toro86'],
];
const PROPS = [['cone.fbx', 'cone']];
// Tanıtım sayfasındaki "kahraman" spor arabalar: tekerlekler ayrı düğüm (kaydırdıkça döner)
const HEROES = [
  ['Exports/Stuttgart996.fbx', 'stuttgart996'],
  ['Tristar Racer.fbx', 'tristar-racer'],
  ['Exports/Tois08_GT.fbx', 'tois08-gt'],
];

// ---- Basit PNG çözücü (8 bit RGB/RGBA, taramasız) ----
function decodePng(buf) {
  let pos = 8;
  let w = 0, h = 0, ct = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('desteklenmeyen PNG');
      ct = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error('desteklenmeyen PNG renk türü ' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y += 1) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, px };
}

function findPalette() {
  const stack = [SRC];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '__MACOSX') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.png$/i.test(e.name)) return decodePng(fs.readFileSync(p));
    }
  }
  return null;
}

const palette = findPalette();
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function samplePalette(u, v) {
  if (!palette) return [1, 1, 1];
  const fu = ((u % 1) + 1) % 1;
  const fv = ((v % 1) + 1) % 1;
  const x = Math.min(palette.w - 1, Math.floor(fu * palette.w));
  const y = Math.min(palette.h - 1, Math.floor((1 - fv) * palette.h));
  const i = (y * palette.w + x) * palette.bpp;
  return [0, 1, 2].map((k) => srgbToLinear(palette.px[i + k] / 255));
}

// ---- Modeli tek, renkli, üçgen listesine indir ----
function flatten(root, keep = () => true) {
  root.updateMatrixWorld(true);
  const pos = [];
  const col = [];
  const nrm = new THREE.Matrix3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position || !keep(o)) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    const P = g.attributes.position;
    const UV = g.attributes.uv;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: P.count, materialIndex: 0 }];
    for (const gr of groups) {
      const m = mats[gr.materialIndex] || mats[0];
      const base = m?.color ? [m.color.r, m.color.g, m.color.b] : [0.8, 0.8, 0.8];
      const textured = !!m?.map && !!UV;
      for (let t = gr.start; t + 2 < gr.start + gr.count; t += 3) {
        let c = base;
        if (textured) {
          const u = (UV.getX(t) + UV.getX(t + 1) + UV.getX(t + 2)) / 3;
          const v = (UV.getY(t) + UV.getY(t + 1) + UV.getY(t + 2)) / 3;
          const s = samplePalette(u, v);
          c = [s[0] * base[0], s[1] * base[1], s[2] * base[2]];
        }
        for (let k = 0; k < 3; k += 1) {
          pos.push(P.getX(t + k), P.getY(t + k), P.getZ(t + k));
          col.push(c[0], c[1], c[2]);
        }
      }
    }
    void nrm;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function normalize(geo, { isCar }) {
  geo.computeBoundingBox();
  let b = geo.boundingBox;
  const size = new THREE.Vector3();
  b.getSize(size);
  // Uzun yatay kenar Z olsun
  if (isCar && size.x > size.z) geo.rotateY(Math.PI / 2);
  geo.computeBoundingBox();
  b = geo.boundingBox;
  const c = new THREE.Vector3();
  b.getCenter(c);
  geo.translate(-c.x, -b.min.y, -c.z);
  geo.computeBoundingBox();
  b = geo.boundingBox;
  b.getSize(size);
  const k = 1 / (isCar ? size.z : size.y);
  geo.scale(k, k, k);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.boundingBox.getSize(size);
  return { length: +size.z.toFixed(4), width: +size.x.toFixed(4), height: +size.y.toFixed(4) };
}

// ---- Boya ayrımı: alanca en baskın (çok koyu olmayan) renk = gövde boyası ----
// Tarayıcı bu parçayı her araç için farklı renge boyar; camlar, lastikler, farlar aynı kalır.
function splitPaint(geo) {
  const P = geo.attributes.position;
  const C = geo.attributes.color;
  const key = (i) => [0, 1, 2].map((k) => Math.round(C.getComponent(i, k) * 40)).join(',');
  const area = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < P.count; t += 3) {
    a.fromBufferAttribute(P, t);
    b.fromBufferAttribute(P, t + 1).sub(a);
    c.fromBufferAttribute(P, t + 2).sub(a);
    const lum = 0.2126 * C.getX(t) + 0.7152 * C.getY(t) + 0.0722 * C.getZ(t);
    if (lum < 0.03) continue; // lastik, cam, siyah tavan boya sayılmaz
    const k = key(t);
    area.set(k, (area.get(k) || 0) + b.cross(c).length() / 2);
  }
  const paintKey = [...area.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  const parts = { paint: { pos: [], col: [] }, detail: { pos: [], col: [] } };
  for (let t = 0; t < P.count; t += 3) {
    const part = key(t) === paintKey ? parts.paint : parts.detail;
    for (let k = 0; k < 3; k += 1) {
      part.pos.push(P.getX(t + k), P.getY(t + k), P.getZ(t + k));
      if (part === parts.paint) part.col.push(1, 1, 1);
      else part.col.push(C.getX(t + k), C.getY(t + k), C.getZ(t + k));
    }
  }
  return Object.entries(parts)
    .filter(([, v]) => v.pos.length)
    .map(([name, v]) => ({ name, pos: new Float32Array(v.pos), col: v.col }));
}

// ---- En küçük GLB yazıcı ----
// Normaller yazılmaz (tarayıcı düz gölgeleme için yeniden hesaplar); renk 4×uint8.
function writeGlb(file, parts, name) {
  const chunks = [];
  const views = [];
  const accessors = [];
  const nodes = [];
  const meshes = [];
  let offset = 0;
  const push = (buf, target) => {
    const pad = (4 - (buf.length % 4)) % 4;
    chunks.push(buf, Buffer.alloc(pad));
    views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target });
    offset += buf.length + pad;
    return views.length - 1;
  };
  parts.forEach((part) => {
    const count = part.pos.length / 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < part.pos.length; i += 1) {
      min[i % 3] = Math.min(min[i % 3], part.pos[i]);
      max[i % 3] = Math.max(max[i % 3], part.pos[i]);
    }
    const pv = push(Buffer.from(part.pos.buffer), 34962);
    accessors.push({ bufferView: pv, componentType: 5126, count, type: 'VEC3', min, max });
    const col = Buffer.alloc(count * 4);
    for (let i = 0; i < count; i += 1) {
      for (let k = 0; k < 3; k += 1) col[i * 4 + k] = Math.round(Math.min(1, Math.max(0, part.col[i * 3 + k])) * 255);
      col[i * 4 + 3] = 255;
    }
    const cv = push(col, 34962);
    accessors.push({ bufferView: cv, componentType: 5121, normalized: true, count, type: 'VEC4' });
    meshes.push({ name: part.name, primitives: [{ attributes: { POSITION: accessors.length - 2, COLOR_0: accessors.length - 1 }, material: 0 }] });
    nodes.push(part.translation ? { mesh: meshes.length - 1, name: part.name, translation: part.translation } : { mesh: meshes.length - 1, name: part.name });
  });
  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: '2.0', generator: 'akillipark convert-polycars' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials: [{ name: `${name}-mat`, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.15, roughnessFactor: 0.55 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors,
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const total = 12 + 8 + jsonBuf.length + 8 + bin.length;
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([head, jh, jsonBuf, bh, bin]));
}

// Her çalıştırmada temiz çıktı (silme izni gerekmesin diye üzerine yazılır)
fs.mkdirSync(OUT, { recursive: true });
const loader = new FBXLoader();
const manifest = { cars: [], props: [] };
for (const [list, isCar] of [[CARS, true], [PROPS, false]]) {
  for (const [rel, id] of list) {
    const src = path.join(SRC, rel);
    if (!fs.existsSync(src)) {
      console.warn('ATLANDI (bulunamadı):', rel);
      continue;
    }
    const data = fs.readFileSync(src);
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const obj = loader.parse(ab, path.dirname(src) + path.sep);
    const geo = flatten(obj);
    const dims = normalize(geo, { isCar });
    const parts = isCar ? splitPaint(geo) : [{ name: 'detail', pos: geo.attributes.position.array, col: Array.from(geo.attributes.color.array) }];
    writeGlb(path.join(OUT, `${id}.glb`), parts, id);
    (isCar ? manifest.cars : manifest.props).push({ id, file: `${id}.glb`, triangles: geo.attributes.position.count / 3, ...dims });
    console.log(`${id.padEnd(18)} üçgen=${String(geo.attributes.position.count / 3).padStart(5)}  boy=1 en=${dims.width} yükseklik=${dims.height}`);
  }
}
// ---- Kahraman araçlar: gövde (boya + ayrıntı) ve dört tekerlek ayrı ----
manifest.heroes = [];
for (const [rel, id] of HEROES) {
  const src = path.join(SRC, rel);
  if (!fs.existsSync(src)) continue;
  const data = fs.readFileSync(src);
  const obj = loader.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), path.dirname(src) + path.sep);
  const isWheel = (o) => /wheel/i.test(o.name);
  const whole = flatten(obj);
  // Tüm araç için tek dönüşüm (yön, taban, boy = 1) — parçalara aynen uygulanır
  whole.computeBoundingBox();
  const size = new THREE.Vector3();
  whole.boundingBox.getSize(size);
  const rot = size.x > size.z ? Math.PI / 2 : 0;
  const tmp = whole.clone();
  tmp.rotateY(rot);
  tmp.computeBoundingBox();
  const c = new THREE.Vector3();
  tmp.boundingBox.getCenter(c);
  const minY = tmp.boundingBox.min.y;
  tmp.boundingBox.getSize(size);
  const k = 1 / size.z;
  const xf = (g) => {
    g.rotateY(rot);
    g.translate(-c.x, -minY, -c.z);
    g.scale(k, k, k);
    return g;
  };
  const body = xf(flatten(obj, (o) => !isWheel(o)));
  const parts = splitPaint(body);
  const wheels = [];
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    if (!o.isMesh || !isWheel(o)) return;
    const holder = new THREE.Group();
    const m = o.clone();
    m.matrixAutoUpdate = false;
    m.matrix.copy(o.matrixWorld);
    holder.add(m);
    const g = xf(flatten(holder));
    g.computeBoundingBox();
    const wc = new THREE.Vector3();
    g.boundingBox.getCenter(wc);
    const ws = new THREE.Vector3();
    g.boundingBox.getSize(ws);
    g.translate(-wc.x, -wc.y, -wc.z); // tekerlek kendi merkezinde dönsün
    const name = `wheel_${wc.z > 0 ? 'f' : 'r'}${wc.x > 0 ? 'l' : 'r'}`;
    wheels.push({ name, radius: Math.max(ws.y, ws.z) / 2 });
    parts.push({ name, pos: g.attributes.position.array, col: Array.from(g.attributes.color.array), translation: [wc.x, wc.y, wc.z] });
  });
  const file = `hero-${id}.glb`;
  writeGlb(path.join(OUT, file), parts, `hero-${id}`);
  manifest.heroes.push({ id, file, width: +(size.x * k).toFixed(4), height: +(size.y * k).toFixed(4), wheelRadius: +(Math.max(...wheels.map((w) => w.radius))).toFixed(4), wheels: wheels.map((w) => w.name) });
  console.log(`hero-${id}`.padEnd(22), 'tekerlek:', wheels.map((w) => w.name).join(' '));
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n${manifest.cars.length} araç + ${manifest.props.length} nesne → ${OUT}`);
