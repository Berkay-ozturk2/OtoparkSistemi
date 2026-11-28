import { api, qs } from './client';

// Operatör (rol: Operator veya Admin)
// Sözleşme bölüm 11: liste uç noktaları isteğe bağlı `lot` alır (verilmezse tümü / varsayılan).

/** UC-07: [{ id, gateEventId, lotCode, cameraId, gate, plateRead, confidence, imageBase64, createdAt }] */
export function getReviewQueue(lot) {
  return api.get(`/api/operator/review-queue${qs({ lot })}`);
}

/** { correctedPlate, approve } → gate-event yanıtı { eventId, decision, message, sessionId, suggestedZone, fee } */
export function resolveReview(id, { correctedPlate, approve }) {
  return api.post(`/api/operator/review-queue/${id}/resolve`, { correctedPlate, approve });
}

/** [Session] — lot verilmezse tüm otoparklar */
export function getActiveSessions(lot) {
  return api.get(`/api/operator/sessions/active${qs({ lot })}`);
}

/** [GateEvent] (yeniden eskiye) */
export function getGateEvents(limit = 50, lot) {
  return api.get(`/api/operator/gate-events${qs({ lot, limit })}`);
}

/** lotCode isteğe bağlı (verilmezse GAZI) */
export function manualEntry(plate, lotCode) {
  return api.post('/api/operator/manual-entry', lotCode ? { plate, lotCode } : { plate });
}

export function manualExit(plate, lotCode) {
  return api.post('/api/operator/manual-exit', lotCode ? { plate, lotCode } : { plate });
}

/** Gişe nakit ödemesi → { paymentId, status, amount, message } */
export function cashPayment(sessionId) {
  return api.post(`/api/operator/sessions/${sessionId}/cash-payment`);
}

/** El ile cep durumu düzeltme */
export function overrideSlot(code, occupied, lot) {
  return api.post(`/api/operator/slots/${encodeURIComponent(code)}/override${qs({ lot })}`, { occupied });
}

/** Görüntü ajanlarının son heartbeat durumu */
export function getBackendAgents() {
  return api.get('/api/operator/agents');
}

// ---- Engelli yeri ihlalleri (sözleşme 11.2/11.3) ----

/** [Violation] — status: Open | Resolved | FalseAlarm (boş = tümü) */
export function getViolations({ lot, status } = {}) {
  return api.get(`/api/operator/violations${qs({ lot, status })}`);
}

/** { status: 'Resolved' | 'FalseAlarm', note } */
export function resolveViolation(id, { status, note }) {
  return api.post(`/api/operator/violations/${id}/resolve`, { status, note });
}

/** Gişede hızlı engelli izni kontrolü → { plate, valid, permit } */
export function checkPermit(plate) {
  return api.get(`/api/permits/check/${encodeURIComponent(plate)}`);
}

// ---- Krokiden cep ayrıntısı ve araç ataması (aşama 3) ----

/** { id, code, lotCode, zoneCode, zoneName, floor, type, isOccupied, isReserved, hasViolation, isActive, updatedAt, sessionId, plate, entryTime, isDisabledPermit } */
export function getSlotDetail(slotId) {
  return api.get(`/api/operator/slots/${slotId}/detail`);
}

/** Aktif oturumdaki aracı cebe atar. Normal araç engelli cebe atanamaz → 422 { message } */
export function assignSlot(slotId, plate) {
  return api.post(`/api/operator/slots/${slotId}/assign`, { plate });
}

export function unassignSlot(slotId) {
  return api.del(`/api/operator/slots/${slotId}/assign`);
}
