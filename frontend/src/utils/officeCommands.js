// Ajan Ofisi: kamera ajanlarına Türkçe yazılan görevleri ayrıştırır (yalnızca kural tabanlı, ağ yok).
//
// Desteklenen görevler:
//   başla / başlat / işe başla / çalış          → start
//   dur / durdur / mola / bırak                  → stop
//   AVM'ye geç / hastane otoparkına git          → assign (giriş/çıkış: otopark, doluluk: o otoparkın ilk krokisi)
//   merkez kat 1 krokisine geç / zemin / b1      → assign (doluluk: kroki/kat)
//   doluluk say / say %40 / örnekle say          → sample (sentetik görüntüyle doluluk analizi)
//   plaka oku / fotoğraf oku / resim             → photo (fotoğraf seçtirir)
//   durum / rapor / ne yapıyorsun                → status
//   yardım / ne yapabilirsin                     → help

const TR_MAP = { ç: 'c', ğ: 'g', ı: 'i', i̇: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** Küçük harfe çevirir, Türkçe harfleri sadeleştirir, kesme işaretini boşluk yapar. */
export function normalizeTr(text) {
  return String(text || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşüâîû]|i̇/g, (ch) => TR_MAP[ch] || ch)
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9%\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const has = (t, words) => words.some((w) => new RegExp(`(^|\\s)${w}`).test(t));

/** Metindeki kat ifadesi: "kat 1" / "1. kat" / "k1" → 1, "zemin" → 0, "b1" / "bodrum" / "kat -1" → -1 */
export function parseFloor(t) {
  if (/(^|\s)(zemin|zm)(\s|$)/.test(t)) return 0;
  let m = t.match(/(^|\s)b(\d)(\s|$)/) || t.match(/bodrum\s*(\d)?/);
  if (m) return -Number(m[2] || m[1] || 1) || -1;
  m = t.match(/kat\s*(-?\d)/) || t.match(/(-?\d)\s*\.?\s*kat/) || t.match(/(^|\s)k(\d)(\s|$)/);
  if (m) return Number(m[2] ?? m[1]);
  return null;
}

/** Metinde geçen otopark: kod (AVM) ya da adındaki anlamlı bir kelime (hastane, merkez, gazi, carsi) */
export function findLot(t, lots = []) {
  const stop = new Set(['otopark', 'otoparki', 'acik', 'katli', 'pilot', 'fakultesi', 'teknoloji', 'universitesi', 've']);
  for (const lot of lots) {
    const code = normalizeTr(lot.code);
    if (new RegExp(`(^|\\s)${code}`).test(t)) return lot;
  }
  for (const lot of lots) {
    const words = normalizeTr(lot.name).split(' ').filter((w) => w.length >= 4 && !stop.has(w));
    if (words.some((w) => new RegExp(`(^|\\s)${w.slice(0, Math.max(4, w.length - 2))}`).test(t))) return lot;
  }
  return null;
}

/** Görevi ayrıştırır → { type, ...ayrıntı } ya da { type: 'unknown' } */
export function parseCommand(text, { agent, lots = [], layouts = [] } = {}) {
  const t = normalizeTr(text);
  if (!t) return { type: 'empty' };
  if (has(t, ['yardim', 'ne yapabilir', 'komut', 'help'])) return { type: 'help' };
  if (has(t, ['durum', 'rapor', 'ne yapiyorsun', 'nasilsin', 'naber'])) return { type: 'status' };
  if (has(t, ['dur', 'mola', 'birak', 'kapat', 'stop', 'paydos'])) return { type: 'stop' };

  const isOcc = agent?.type === 'Occupancy';
  const lot = findLot(t, lots);
  const floor = parseFloor(t);
  const wantsMove = has(t, ['gec', 'git', 'bak', 'izle', 'kroki', 'atan', 'bagla', 'tasin']) || (lot && !has(t, ['say', 'oku']));

  if (isOcc && has(t, ['say', 'doluluk', 'ornek', 'analiz', 'kontrol'])) {
    const m = t.match(/%\s*(\d{1,3})/) || t.match(/(\d{1,3})\s*%/) || t.match(/yuzde\s*(\d{1,3})/);
    const ratio = m ? Math.max(0, Math.min(100, Number(m[1]))) : null;
    return { type: 'sample', ratio };
  }
  if (has(t, ['plaka', 'fotograf', 'resim', 'goruntu', 'foto', 'oku'])) return { type: 'photo' };

  if (wantsMove && (lot || floor !== null)) {
    if (!isOcc) {
      if (!lot) return { type: 'unknown', reason: 'Hangi otoparka geçeyim? (ör. "AVM\'ye geç")' };
      return { type: 'assign', lot: lot.code };
    }
    const lotCode = lot?.code || layouts.find((l) => l.id === agent?.layout)?.lotCode;
    const candidates = layouts.filter((l) => l.lotCode === lotCode);
    if (!candidates.length) return { type: 'unknown', reason: 'Bu otopark için kroki bulunamadı.' };
    const pick = floor !== null ? candidates.find((l) => (l.floor ?? 0) === floor) : candidates[0];
    if (!pick) return { type: 'unknown', reason: `Bu otoparkta ${floor}. kat krokisi yok.` };
    return { type: 'assign', layout: pick.id, lot: pick.lotCode };
  }
  if (has(t, ['basla', 'baslat', 'calis', 'ise', 'start'])) return { type: 'start' };
  return { type: 'unknown' };
}

export const HELP_TEXT = {
  Gate: [
    '"başla" / "dur"',
    '"AVM\'ye geç" — plaka olaylarını başka otoparka gönder',
    '"plaka oku" — fotoğraf seç, plakayı okuyayım',
    '"durum" — ne yaptığımı anlatayım',
  ],
  Occupancy: [
    '"başla" / "dur"',
    '"Merkez kat 1\'e geç" — başka krokiyi / katı izle',
    '"doluluk say %40" — örnek görüntüyle cepleri sayayım',
    '"fotoğraf oku" — kendi fotoğrafınla say',
    '"durum" — ne yaptığımı anlatayım',
  ],
};
