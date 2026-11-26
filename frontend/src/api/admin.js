import { api, qs } from './client';

// Yönetici (rol: Admin)

// ---- Tarifeler (UC-12) ----
export function getTariffs() {
  return api.get('/api/admin/tariffs');
}
export function createTariff(tariff) {
  return api.post('/api/admin/tariffs', tariff);
}
export function updateTariff(id, tariff) {
  return api.put(`/api/admin/tariffs/${id}`, tariff);
}
export function deleteTariff(id) {
  return api.del(`/api/admin/tariffs/${id}`);
}

// ---- Ayarlar ----
export function getSettings() {
  return api.get('/api/admin/settings');
}
export function updateSettings(settings) {
  return api.put('/api/admin/settings', settings);
}

// ---- Kullanıcılar (UC-13) ----
export function getUsers() {
  return api.get('/api/admin/users');
}
export function createUser({ fullName, email, phone, password, role }) {
  return api.post('/api/admin/users', { fullName, email, phone, password, role });
}
export function updateUser(id, { fullName, phone, role, isActive }) {
  return api.put(`/api/admin/users/${id}`, { fullName, phone, role, isActive });
}
export function deleteUser(id) {
  return api.del(`/api/admin/users/${id}`);
}

// ---- Terk edilmiş araçlar (UC-09) ----
export function getAbandoned(lot) {
  return api.get(`/api/admin/abandoned${qs({ lot })}`);
}

// ---- Raporlar (UC-10, UC-11) ----
// lot verilmezse tüm otoparklar
export function getOccupancyReport({ from, to, lot }) {
  return api.get(`/api/admin/reports/occupancy${qs({ from, to, lot })}`);
}
export function getRevenueReport({ from, to, groupBy = 'day', lot }) {
  return api.get(`/api/admin/reports/revenue${qs({ from, to, groupBy, lot })}`);
}

// ---- Denetim kayıtları ----
export function getAuditLogs(limit = 100) {
  return api.get(`/api/admin/audit-logs${qs({ limit })}`);
}

// ---- KVKK talepleri ----
export function getPrivacyRequests() {
  return api.get('/api/admin/privacy-requests');
}
export function updatePrivacyRequest(id, { status, note }) {
  return api.put(`/api/admin/privacy-requests/${id}`, { status, note });
}

// ---- Demo verisi ----
export function generateDemoData() {
  return api.post('/api/admin/demo-data');
}

// ---- Engelli izinleri (sözleşme 11.3) ----
/** [DisabledPermit] — status boşsa tümü */
export function getPermits(status) {
  return api.get(`/api/admin/permits${qs({ status })}`);
}
/** Gişede belge görülerek doğrudan onaylı izin: { plate, holderName, documentNo, validUntil } */
export function createPermit({ plate, holderName, documentNo, validUntil }) {
  return api.post('/api/admin/permits', { plate, holderName, documentNo, validUntil });
}
/** Onay / ret / iptal: { status, validUntil, note } */
export function updatePermit(id, { status, validUntil, note }) {
  return api.put(`/api/admin/permits/${id}`, { status, validUntil, note });
}

// ---- Otoparklar ve cepler ----
/** Otopark listesi (pasifler dâhil) */
export function getAdminLots() {
  return api.get('/api/admin/lots');
}
export function updateLot(code, { name, address, description, isActive, latitude, longitude }) {
  return api.put(`/api/admin/lots/${encodeURIComponent(code)}`, { name, address, description, isActive, latitude, longitude });
}
/** Cep türü / kullanım durumu: { type: 'Standard' | 'Disabled', isActive } */
export function updateSlot(id, { type, isActive }) {
  return api.put(`/api/admin/slots/${id}`, { type, isActive });
}
