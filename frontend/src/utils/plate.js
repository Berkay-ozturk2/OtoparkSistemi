// Türk plakası yardımcıları.
// Normal biçim: boşluksuz, büyük harf (34ABC123). Görüntüleme: "34 ABC 123".

const TR_CHAR_MAP = { İ: 'I', ı: 'I', i: 'I', Ş: 'S', ş: 'S', Ğ: 'G', ğ: 'G', Ü: 'U', ü: 'U', Ö: 'O', ö: 'O', Ç: 'C', ç: 'C' };

/** Kullanıcı girdisini normal biçime çevirir: "34 abc 123" → "34ABC123" */
export function normalizePlate(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[İıiŞşĞğÜüÖöÇç]/g, (ch) => TR_CHAR_MAP[ch] || ch)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

const DISPLAY_RE = /^(\d{2})([A-Z]{1,3})(\d{1,5})$/;

/** "34ABC123" → "34 ABC 123"; tanınmayan biçimler olduğu gibi döner */
export function formatPlate(value) {
  const n = normalizePlate(value);
  if (!n) return '';
  const m = n.match(DISPLAY_RE);
  if (!m) return n;
  return `${m[1]} ${m[2]} ${m[3]}`;
}

/** Plakayı parçalarına ayırır: { city, letters, digits } veya null */
export function splitPlate(value) {
  const m = normalizePlate(value).match(DISPLAY_RE);
  if (!m) return null;
  return { city: m[1], letters: m[2], digits: m[3] };
}

// İl kodu 01–81; harf/rakam kombinasyonları:
//   1 harf + 4-5 rakam, 2 harf + 3-4 rakam, 3 harf + 2-3 rakam
const VALID_RE = /^(0[1-9]|[1-7]\d|8[01])([A-Z]\d{4,5}|[A-Z]{2}\d{3,4}|[A-Z]{3}\d{2,3})$/;

/** TR plaka biçimine uyuyor mu? */
export function isValidPlate(value) {
  return VALID_RE.test(normalizePlate(value));
}

/** Form alanı için kullanıcıya gösterilecek doğrulama mesajı (geçerliyse null) */
export function plateError(value) {
  const n = normalizePlate(value);
  if (!n) return 'Plaka giriniz.';
  if (!isValidPlate(n)) return 'Geçerli bir Türk plakası giriniz (ör. 34 ABC 123).';
  return null;
}
