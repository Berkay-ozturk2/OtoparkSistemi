import { api, qs } from './client';

// Herkese açık otopark uç noktaları (giriş gerekmez)
// Sözleşme bölüm 11: `lot` verilmezse backend varsayılan otoparkı (GAZI) kullanır.

/** [{ id, code, name, address, description, floors, totalSlots, freeSlots, disabledTotal, disabledFree, occupancyRate }] */
export function getLots() {
  return api.get('/api/parking/lots', { auth: false });
}

/** { lot: ParkingLot, zones: [{ id, code, name, floor }], slots: [Slot] } — krokiyi çizmek için tek çağrı */
export function getLotLayout(code) {
  return api.get(`/api/parking/lots/${encodeURIComponent(code)}/layout`, { auth: false });
}

/** { lotCode, total, occupied, free, reserved, occupancyRate, disabledTotal, disabledOccupied, disabledFree } */
export function getSummary(lot) {
  return api.get(`/api/parking/summary${qs({ lot })}`, { auth: false });
}

/** [{ id, code, name, floor, totalSlots, freeSlots, disabledTotal, disabledFree }] */
export function getZones(lot) {
  return api.get(`/api/parking/zones${qs({ lot })}`, { auth: false });
}

/** [Slot] — { id, code, lotCode, zoneCode, floor, type, isOccupied, isReserved, hasViolation, isActive, updatedAt, mapX, mapY, mapW, mapH } */
export function getSlots(lot) {
  return api.get(`/api/parking/slots${qs({ lot })}`, { auth: false });
}

/** { lotCode, zoneCode, zoneName, floor, freeSlots, slotCode, slotType } */
export function getRecommendation(lot, disabled = false) {
  return api.get(`/api/parking/recommendation${qs({ lot, disabled: disabled ? 'true' : undefined })}`, { auth: false });
}

/** UC-06: { plate, lotCode, lotName, zoneCode, zoneName, floor, entryTime, durationMinutes, currentFee, isPaid } */
export function locateVehicle(plate) {
  return api.get(`/api/parking/locate/${encodeURIComponent(plate)}`, { auth: false });
}

/** Aktif tarifeler: [{ id, name, minMinutes, maxMinutes, price, isActive }] */
export function getPublicTariffs() {
  return api.get('/api/parking/tariffs', { auth: false });
}
