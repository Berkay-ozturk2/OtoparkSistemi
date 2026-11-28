// Ortak fetch sarmalayıcısı.
// - JWT'yi Authorization başlığına ekler
// - Hata yanıtlarındaki { message } alanını ApiError olarak fırlatır
// - 401 yanıtında (token gönderilmişse) oturumu kapatır
// - Ağ hatasında "Sunucuya ulaşılamıyor" durumunu tüm uygulamaya duyurur

export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
export const VISION_URL = (import.meta.env.VITE_VISION_URL || '/vision').replace(/\/+$/, '');

export const TOKEN_KEY = 'akillipark_token';
export const USER_KEY = 'akillipark_user';

export const SERVER_STATUS_EVENT = 'akillipark:server-status';

export class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }

  get isNetworkError() {
    return this.status === 0;
  }

  get isNotFound() {
    return this.status === 404;
  }
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

let unauthorizedHandler = null;

/** AuthContext, 401 alındığında çağrılacak çıkış fonksiyonunu buraya kaydeder. */
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

function emitServerStatus(source, online) {
  try {
    window.dispatchEvent(new CustomEvent(SERVER_STATUS_EVENT, { detail: { source, online } }));
  } catch {
    // SSR / test ortamı: yok say
  }
}

function extractMessage(data, status) {
  if (data && typeof data === 'object') {
    if (typeof data.message === 'string' && data.message) return data.message;
    // ASP.NET doğrulama hatası (ProblemDetails)
    if (data.errors && typeof data.errors === 'object') {
      const list = Object.values(data.errors).flat().filter(Boolean);
      if (list.length) return list.join(' ');
    }
    if (typeof data.detail === 'string' && data.detail) return data.detail;
    if (typeof data.title === 'string' && data.title) return data.title;
  }
  if (typeof data === 'string' && data && data.length < 300 && !data.trim().startsWith('<')) {
    return data;
  }
  switch (status) {
    case 400:
      return 'Bilgiler eksik ya da hatalı. İşaretli alanları kontrol edip tekrar deneyin.';
    case 401:
      return 'Oturumunuz kapandı. Devam etmek için yeniden giriş yapın.';
    case 403:
      return 'Bu işlem için yetkiniz yok. Gerekirse yöneticinizden yetki isteyin.';
    case 404:
      return 'Aradığınız kayıt bulunamadı. Silinmiş ya da taşınmış olabilir.';
    case 409:
      return 'Bu işlem mevcut bir kayıtla çakışıyor. Sayfayı yenileyip tekrar deneyin.';
    case 502:
    case 503:
    case 504:
      return 'Sunucu şu anda yanıt vermiyor. Biraz bekleyip tekrar deneyin.';
    default:
      return `İşlem tamamlanamadı (hata kodu ${status}). Tekrar deneyin; sorun sürerse yöneticiye bildirin.`;
  }
}

async function parseBody(res) {
  if (res.status === 204 || res.status === 205) return null;
  const type = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!text) return null;
  if (type.includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

/**
 * Temel istek fonksiyonu.
 * @param {string} path  /api/... gibi yol (base önüne eklenir)
 * @param {object} opts  { method, body, auth, base, headers, signal, source }
 */
export async function request(path, opts = {}) {
  const {
    method = 'GET',
    body,
    auth = true,
    base = API_URL,
    headers = {},
    signal,
    source = 'api',
  } = opts;

  const finalHeaders = { Accept: 'application/json', ...headers };
  let finalBody = body;

  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && body !== null && !isForm && typeof body !== 'string') {
    finalHeaders['Content-Type'] = 'application/json';
    finalBody = JSON.stringify(body);
  }

  const token = auth ? getToken() : null;
  if (token) finalHeaders.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${base}${path}`, { method, headers: finalHeaders, body: finalBody, signal });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    emitServerStatus(source, false);
    throw new ApiError(
      source === 'vision'
        ? 'Görüntü işleme servisine bağlanılamadı. Kameralar şu an plaka okuyamaz; servisin açık olduğunu kontrol edin.'
        : 'Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.',
      0,
    );
  }

  const data = await parseBody(res);

  // Vite proxy'si hedefe ulaşamadığında 502/503/504 döner
  if (res.status >= 502 && res.status <= 504) {
    emitServerStatus(source, false);
  } else {
    emitServerStatus(source, true);
  }

  if (!res.ok) {
    if (res.status === 401 && token && unauthorizedHandler) {
      unauthorizedHandler();
    }
    throw new ApiError(extractMessage(data, res.status), res.status, data);
  }
  return data;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
};

/** Sorgu dizesi oluşturur; boş değerleri atlar. */
export function qs(params) {
  const sp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.append(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}
