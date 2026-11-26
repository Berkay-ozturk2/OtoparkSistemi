// Biçimlendirme yardımcıları (tr-TR)

const currencyFmt = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFmt = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

/** 45.5 → "₺45,50" */
export function formatCurrency(value) {
  const n = Number(value);
  if (value === null || value === undefined || Number.isNaN(n)) return '—';
  return currencyFmt.format(n);
}

export function formatNumber(value, digits = 1) {
  const n = Number(value);
  if (value === null || value === undefined || Number.isNaN(n)) return '—';
  if (digits === 1) return numberFmt.format(n);
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits }).format(n);
}

/** 0.625 → "%62,5" */
export function formatPercent(rate, digits = 0) {
  const n = Number(rate);
  if (rate === null || rate === undefined || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('tr-TR', {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(n);
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "25.11.2026 11:30" */
export function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "25.11.2026" — "2026-11-20" gibi yalnız tarih dizeleri yerel tarih olarak yorumlanır */
export function formatDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}.${m}.${y}`;
  }
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** "11:30:05" */
export function formatTime(value, withSeconds = false) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  });
}

/** 135 → "2 sa 15 dk"; 1500 → "1 gün 1 sa" */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (total < 1) return '0 dk';
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  const parts = [];
  if (days) parts.push(`${days} gün`);
  if (hours) parts.push(`${hours} sa`);
  if (mins && !days) parts.push(`${mins} dk`);
  return parts.join(' ') || '0 dk';
}

/** Başlangıçtan bu yana geçen dakika */
export function minutesSince(value, now = Date.now()) {
  const d = toDate(value);
  if (!d) return 0;
  return Math.max(0, Math.floor((now - d.getTime()) / 60000));
}

/** "3 dk önce" */
export function timeAgo(value, now = Date.now()) {
  const d = toDate(value);
  if (!d) return '';
  const sec = Math.max(0, Math.floor((now - d.getTime()) / 1000));
  if (sec < 10) return 'az önce';
  if (sec < 60) return `${sec} sn önce`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} dk önce`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
}

/** 9 → "09:00" */
export function formatHour(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

// ---- Tarih girdileri ----

const pad = (n) => String(n).padStart(2, '0');

/** Date → "YYYY-MM-DD" (yerel) */
export function toDateInput(date = new Date()) {
  const d = toDate(date) || new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Date → "YYYY-MM-DDTHH:mm" (datetime-local girdisi, yerel) */
export function toDateTimeInput(date = new Date()) {
  const d = toDate(date) || new Date();
  return `${toDateInput(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local değeri → ISO-8601 UTC ("2026-11-25T08:30:00.000Z") */
export function fromDateTimeInput(value) {
  const d = toDate(value);
  return d ? d.toISOString() : null;
}

export function addDays(date, days) {
  const d = new Date(toDate(date) || new Date());
  d.setDate(d.getDate() + days);
  return d;
}

/** Bir sonraki yuvarlak saat + offset saat */
export function nextRoundHour(offsetHours = 1) {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + offsetHours);
  return d;
}

// ---- Etiketler ----

export const ROLE_LABELS = { Admin: 'Yönetici', Operator: 'Otopark Görevlisi', Driver: 'Sürücü' };
export const roleLabel = (r) => ROLE_LABELS[r] || r || '—';

export const GATE_LABELS = { Entry: 'Giriş', Exit: 'Çıkış' };
export const gateLabel = (g) => GATE_LABELS[g] || g || '—';

export const DECISION_INFO = {
  Allowed: { label: 'İzin Verildi', variant: 'success', icon: 'bi-check-circle-fill' },
  Denied: { label: 'Reddedildi', variant: 'danger', icon: 'bi-x-octagon-fill' },
  PendingReview: { label: 'Onay Bekliyor', variant: 'warning', icon: 'bi-hourglass-split' },
};
export const decisionInfo = (d) =>
  DECISION_INFO[d] || { label: d || '—', variant: 'secondary', icon: 'bi-question-circle' };

export const RESERVATION_STATUS = {
  PendingPayment: { label: 'Ödeme Bekliyor', variant: 'warning' },
  Confirmed: { label: 'Onaylandı', variant: 'success' },
  CheckedIn: { label: 'Giriş Yapıldı', variant: 'info' },
  Completed: { label: 'Tamamlandı', variant: 'secondary' },
  Cancelled: { label: 'İptal Edildi', variant: 'dark' },
  Expired: { label: 'Süresi Doldu', variant: 'danger' },
};
export const reservationStatus = (s) => RESERVATION_STATUS[s] || { label: s || '—', variant: 'secondary' };

export const SESSION_STATUS = {
  Active: { label: 'İçeride', variant: 'primary' },
  Completed: { label: 'Tamamlandı', variant: 'secondary' },
};
export const sessionStatus = (s) => SESSION_STATUS[s] || { label: s || '—', variant: 'secondary' };

export const PAYMENT_METHOD_LABELS = {
  Card: 'Kredi/Banka Kartı',
  Cash: 'Nakit',
  Online: 'Çevrimiçi',
  Reservation: 'Rezervasyon',
};
export const paymentMethodLabel = (m) => PAYMENT_METHOD_LABELS[m] || m || '—';

export const PRIVACY_TYPE_LABELS = {
  Info: 'Bilgi Talebi',
  Delete: 'Silme Talebi',
  Objection: 'İtiraz',
};
export const privacyTypeLabel = (t) => PRIVACY_TYPE_LABELS[t] || t || '—';

export const PRIVACY_STATUS = {
  Open: { label: 'Açık', variant: 'warning' },
  Resolved: { label: 'Sonuçlandı', variant: 'success' },
  Rejected: { label: 'Reddedildi', variant: 'danger' },
};
export const privacyStatus = (s) => PRIVACY_STATUS[s] || { label: s || '—', variant: 'secondary' };

// ---- Engelli izni / ihlal (sözleşme bölüm 11) ----
export const PERMIT_STATUS = {
  Pending: { label: 'Onay Bekliyor', variant: 'warning', icon: 'bi-hourglass-split' },
  Approved: { label: 'Onaylı', variant: 'success', icon: 'bi-patch-check-fill' },
  Rejected: { label: 'Reddedildi', variant: 'danger', icon: 'bi-x-circle-fill' },
  Revoked: { label: 'İptal Edildi', variant: 'dark', icon: 'bi-slash-circle' },
};
export const permitStatus = (s) => PERMIT_STATUS[s] || { label: s || '—', variant: 'secondary', icon: 'bi-question-circle' };

/** İzin şu anda geçerli mi? (Approved ve validUntil boş ya da gelecekte) */
export function isPermitValid(permit, now = Date.now()) {
  if (!permit || permit.status !== 'Approved') return false;
  if (!permit.validUntil) return true;
  const t = new Date(permit.validUntil).getTime();
  return Number.isNaN(t) ? true : t > now;
}

export const VIOLATION_STATUS = {
  Open: { label: 'Açık', variant: 'danger', icon: 'bi-exclamation-triangle-fill' },
  Resolved: { label: 'Çözüldü', variant: 'success', icon: 'bi-check-circle-fill' },
  FalseAlarm: { label: 'Yanlış Alarm', variant: 'secondary', icon: 'bi-bell-slash' },
};
export const violationStatus = (s) => VIOLATION_STATUS[s] || { label: s || '—', variant: 'secondary', icon: 'bi-question-circle' };

export const SLOT_TYPE_LABELS = { Standard: 'Standart', Disabled: 'Engelli' };
export const slotTypeLabel = (t) => SLOT_TYPE_LABELS[t] || 'Standart';

/** Görüntü verisini <img src> için hazırlar (ham base64 veya data URL) */
export function toImageSrc(base64, mime = 'image/jpeg') {
  if (!base64) return null;
  if (base64.startsWith('data:')) return base64;
  return `data:${mime};base64,${base64}`;
}
