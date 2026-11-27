import { request, qs, VISION_URL } from './client';

// Görüntü işleme servisi (FastAPI). JWT gönderilmez.
const opts = { base: VISION_URL, auth: false, source: 'vision' };

/** { status, models: { plateDetector, vehicleDetector, ocr } } */
export function getVisionHealth() {
  return request('/health', opts);
}

/** [{ id, type, gate, source, enabled, status, fps, lastPlate, lastError }] */
export function getVisionAgents() {
  return request('/agents', opts);
}

export function startAgent(id) {
  return request(`/agents/${encodeURIComponent(id)}/start`, { ...opts, method: 'POST' });
}

export function stopAgent(id) {
  return request(`/agents/${encodeURIComponent(id)}/stop`, { ...opts, method: 'POST' });
}

/**
 * Canlı akış için temel adres. Akış uzun süre açık kalan bir bağlantıdır; Vite proxy'si (/vision) üzerinden
 * gitseydi tarayıcının aynı adrese açabildiği ~6 bağlantıdan birini sürekli tutar ve API isteklerini
 * bekletebilirdi. Bu yüzden geliştirmede akış doğrudan görüntü servisine (:8000) bağlanır.
 * VITE_VISION_STREAM_URL ile değiştirilebilir.
 */
function streamBase() {
  const env = import.meta.env.VITE_VISION_STREAM_URL;
  if (env) return env.replace(/\/$/, '');
  if (VISION_URL.startsWith('/') && typeof window !== 'undefined' && window.location.port === '5173') {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }
  return VISION_URL;
}

/** <img> için canlı MJPEG akış adresi (akıcı önizleme) */
export function agentStreamUrl(id, stamp = Date.now(), fps = 15) {
  return `${streamBase()}/agents/${encodeURIComponent(id)}/stream?fps=${fps}&t=${stamp}`;
}

/** <img> için son işlenmiş kare adresi (önbelleği kırmak için zaman damgası eklenir) */
export function agentSnapshotUrl(id, stamp = Date.now()) {
  return `${VISION_URL}/agents/${encodeURIComponent(id)}/snapshot?t=${stamp}`;
}

/**
 * POST /recognize?gate=Entry&forward=false (multipart "file")
 * → { plates: [{ plate, rawText, confidence, formatValid, bbox }], backendResponse, elapsedMs, annotatedImageBase64 }
 */
export function recognizePlate(file, { gate = 'Entry', forward = false, lot } = {}) {
  const fd = new FormData();
  fd.append('file', file);
  return request(`/recognize${qs({ gate, forward: forward ? 'true' : 'false', lot })}`, {
    ...opts,
    method: 'POST',
    body: fd,
  });
}

/**
 * POST /occupancy/analyze?layout=AVM&detector=yolo&forward=false (multipart "file")
 * layout: cep yerleşimi (kroki/kat) kimliği; detector: 'yolo' (gerçek fotoğraf) | 'color' (sentetik örnek)
 * → { slots: [{ code, occupied, confidence }], vehicles, layout, lotCode, detector, annotatedImageBase64, elapsedMs }
 */
export function analyzeOccupancy(file, { forward = false, lot, layout, detector = 'yolo' } = {}) {
  const fd = new FormData();
  fd.append('file', file);
  return request(`/occupancy/analyze${qs({ forward: forward ? 'true' : 'false', lot, layout, detector })}`, {
    ...opts,
    method: 'POST',
    body: fd,
  });
}

/** [{ id, lotCode, floor, name, slotCount, imageWidth, imageHeight }] — doluluk kamerası görüş alanları */
export function getOccupancyLayouts(lot) {
  return request(`/config/layouts${qs({ lot })}`, opts);
}

/**
 * Seçilen kroki için sentetik üstten görünüş otopark görüntüsü (File olarak döner; analizde detector='color').
 * GET /occupancy/sample?layout=AVM&ratio=0.5&seed=12
 */
export async function getOccupancySample(layout, { ratio = 0.5, seed } = {}) {
  const res = await fetch(`${VISION_URL}/occupancy/sample${qs({ layout, ratio, seed })}`, { cache: 'no-store' });
  if (!res.ok) {
    let message = 'Örnek görüntü üretilemedi';
    try {
      message = (await res.json())?.message || message;
    } catch {
      // gövde JSON değil
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  return new File([blob], `ornek_${layout}_${seed ?? 'rastgele'}.jpg`, { type: 'image/jpeg' });
}

/** Kamerayı başka otoparka (doluluk kamerasında başka krokiye/kata) bağlar. → AgentInfo */
export function assignAgent(id, { lot, layout } = {}) {
  return request(`/agents/${encodeURIComponent(id)}/assign${qs({ lot, layout })}`, { ...opts, method: 'POST' });
}

/** Doluluk kamerası cep poligonları (layout verilmezse GAZI) */
export function getSlotConfig(layout) {
  return request(`/config/slots${qs({ layout })}`, opts);
}
