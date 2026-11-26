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

/** <img> için canlı MJPEG akış adresi (akıcı önizleme) */
export function agentStreamUrl(id, stamp = Date.now(), fps = 15) {
  return `${VISION_URL}/agents/${encodeURIComponent(id)}/stream?fps=${fps}&t=${stamp}`;
}

/** <img> için son işlenmiş kare adresi (önbelleği kırmak için zaman damgası eklenir) */
export function agentSnapshotUrl(id, stamp = Date.now()) {
  return `${VISION_URL}/agents/${encodeURIComponent(id)}/snapshot?t=${stamp}`;
}

/**
 * POST /recognize?gate=Entry&forward=false (multipart "file")
 * → { plates: [{ plate, rawText, confidence, formatValid, bbox }], backendResponse, elapsedMs, annotatedImageBase64 }
 */
export function recognizePlate(file, { gate = 'Entry', forward = false } = {}) {
  const fd = new FormData();
  fd.append('file', file);
  return request(`/recognize${qs({ gate, forward: forward ? 'true' : 'false' })}`, {
    ...opts,
    method: 'POST',
    body: fd,
  });
}

/**
 * POST /occupancy/analyze?forward=false (multipart "file")
 * → { slots: [{ code, occupied, confidence }], vehicles, annotatedImageBase64, elapsedMs }
 */
export function analyzeOccupancy(file, { forward = false } = {}) {
  const fd = new FormData();
  fd.append('file', file);
  return request(`/occupancy/analyze${qs({ forward: forward ? 'true' : 'false' })}`, {
    ...opts,
    method: 'POST',
    body: fd,
  });
}

/** Doluluk kamerası cep poligonları */
export function getSlotConfig() {
  return request('/config/slots', opts);
}
