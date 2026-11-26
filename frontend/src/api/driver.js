import { api } from './client';

// Sürücü (rol: Driver)

/** [{ id, plate, nickname, disabledPermitStatus }] */
export function getMyVehicles() {
  return api.get('/api/vehicles/my');
}

export function addVehicle({ plate, nickname }) {
  return api.post('/api/vehicles', { plate, nickname });
}

export function deleteVehicle(id) {
  return api.del(`/api/vehicles/${id}`);
}

export function getMyReservations() {
  return api.get('/api/reservations/my');
}

/** { lotCode, zoneCode, slotType, startTime, endTime } → { amount, available, message } */
export function quoteReservation({ lotCode, zoneCode, slotType = 'Standard', startTime, endTime }) {
  return api.post('/api/reservations/quote', { lotCode, zoneCode, slotType, startTime, endTime });
}

/** { plate, lotCode, zoneCode, slotType, startTime, endTime } → Reservation (status PendingPayment) */
export function createReservation({ plate, lotCode, zoneCode, slotType = 'Standard', startTime, endTime }) {
  return api.post('/api/reservations', { plate, lotCode, zoneCode, slotType, startTime, endTime });
}

export function cancelReservation(id) {
  return api.del(`/api/reservations/${id}`);
}

/** Sürücünün plakalarına ait oturum geçmişi [Session] */
export function getMySessions() {
  return api.get('/api/sessions/my');
}

// ---- Engelli park izni (sözleşme 11.3) ----

/** Sürücünün başvuruları [DisabledPermit] */
export function getMyPermits() {
  return api.get('/api/permits/my');
}

/** { plate, holderName, documentNo } → DisabledPermit (status Pending); 409 bekleyen/onaylı başvuru varsa */
export function applyPermit({ plate, holderName, documentNo }) {
  return api.post('/api/permits', { plate, holderName, documentNo });
}
