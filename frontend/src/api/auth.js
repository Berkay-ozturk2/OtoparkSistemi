import { api } from './client';

/** POST /api/auth/login → { token, user } */
export function login(email, password) {
  return api.post('/api/auth/login', { email, password }, { auth: false });
}

/** POST /api/auth/register → { token, user } (rol Driver) */
export function register({ fullName, email, phone, password, kvkkAccepted, marketingConsent }) {
  return api.post(
    '/api/auth/register',
    {
      fullName,
      email,
      phone,
      password,
      kvkkAccepted: !!kvkkAccepted,
      marketingConsent: !!marketingConsent,
    },
    { auth: false },
  );
}

/** GET /api/auth/me → user */
export function getMe() {
  return api.get('/api/auth/me');
}
