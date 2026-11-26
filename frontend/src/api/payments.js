import { api } from './client';

/** UC-03: { sessionId, plate, entryTime, durationMinutes, amount, isPaid } — 404 ise araç içeride değil */
export function getPaymentQuote(plate) {
  return api.get(`/api/payments/quote/${encodeURIComponent(plate)}`, { auth: false });
}

/**
 * POST /api/payments/pay (girişsiz de çalışır; giriş yapılmışsa token eklenir)
 * @param {{sessionId?: number|null, reservationId?: number|null, card: {holderName, number, expireMonth, expireYear, cvc}}} payload
 * @returns {{paymentId, status: 'Success'|'Failed', amount, message, transactionId}}
 */
export function pay({ sessionId = null, reservationId = null, card }) {
  return api.post('/api/payments/pay', { sessionId, reservationId, card });
}
