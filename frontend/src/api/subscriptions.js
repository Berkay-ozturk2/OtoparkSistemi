import { api, qs } from './client';

// Abonelikler: paketler herkese açık, başvuru sürücüye, onay ve raporlar yöneticiye.

/** [{ plan: 'Monthly'|'Yearly', name, months, price, monthlyEquivalent, savingPercent }] */
export function getSubscriptionPlans() {
  return api.get('/api/subscriptions/plans');
}

export function getMySubscriptions() {
  return api.get('/api/subscriptions/my');
}

/** { plate, lotCode, plan, holderName, phone, startDate: 'YYYY-MM-DD' } */
export function applySubscription(body) {
  return api.post('/api/subscriptions', body);
}

export function withdrawSubscription(id) {
  return api.post(`/api/subscriptions/${id}/cancel`);
}

/** status: Pending | Active | Rejected | Cancelled */
export function getSubscriptions({ status, lot } = {}) {
  return api.get(`/api/admin/subscriptions${qs({ status, lot })}`);
}

/** status: Active (onay) | Rejected (gerekçe zorunlu) | Cancelled */
export function updateSubscription(id, { status, note }) {
  return api.put(`/api/admin/subscriptions/${id}`, { status, note });
}

export function getSubscriptionReport({ year, lot } = {}) {
  return api.get(`/api/admin/subscriptions/report${qs({ year, lot })}`);
}
