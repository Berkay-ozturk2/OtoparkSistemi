import { api } from './client';

/** KVKK ilgili kişi başvurusu: { fullName, email, plate, type: 'Delete'|'Objection'|'Info', message } → 201 */
export function createPrivacyRequest({ fullName, email, plate, type, message }) {
  return api.post('/api/privacy/requests', { fullName, email, plate, type, message }, { auth: false });
}
