"""Türk plaka biçimi yardımcıları (yalnızca standart kütüphane).

Biçim: il kodu (01–81) + harf grubu + rakam grubu
    1 harf  + 4 veya 5 rakam   ör. 34 A 1234, 34 A 12345
    2 harf  + 3 veya 4 rakam   ör. 06 AB 123, 06 AB 1234
    3 harf  + 2 veya 3 rakam   ör. 35 ABC 12, 35 ABC 123

Harf kümesi: A B C D E F G H I J K L M N O P R S T U V Y Z
(Q, W, X ve Türkçe karakterler plakalarda kullanılmaz.)
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Iterable, List, Optional, Tuple

PLATE_LETTERS = "ABCDEFGHIJKLMNOPRSTUVYZ"
DIGITS = "0123456789"

# (harf sayısı, rakam sayısı) geçerli kombinasyonları
VALID_GROUPS: Tuple[Tuple[int, int], ...] = ((1, 4), (1, 5), (2, 3), (2, 4), (3, 2), (3, 3))

_VALID_RE = re.compile(r"^(0[1-9]|[1-7][0-9]|8[01])([A-Z]{1,3})([0-9]{2,5})$")

# Rakam bölgesinde görülen harfin rakama dönüştürülmesi (OCR karışıklıkları)
LETTER_TO_DIGIT = {
    "O": "0", "D": "0", "Q": "0", "U": "0",
    "I": "1", "L": "1", "J": "1",
    "Z": "2",
    "S": "5",
    "B": "8",
    "G": "6",
    "T": "7",
    "A": "4",
}
# Harf bölgesinde görülen rakamın harfe dönüştürülmesi
DIGIT_TO_LETTER = {
    "0": "O",
    "1": "I",
    "2": "Z",
    "5": "S",
    "8": "B",
    "6": "G",
    "4": "A",
    "7": "T",
}
# Plakada olmayan harflerin en yakın geçerli harfe eşlenmesi (harf bölgesi)
INVALID_LETTER_FIX = {"Q": "O", "W": "V", "X": "K"}

_TURKISH_MAP = str.maketrans({
    "İ": "I", "ı": "I", "Ş": "S", "ş": "S", "Ğ": "G", "ğ": "G",
    "Ü": "U", "ü": "U", "Ö": "O", "ö": "O", "Ç": "C", "ç": "C",
})

# Silinen (baştaki/sondaki fazladan) karakter maliyeti; ikame maliyetinden biraz yüksek
_DROP_COST = 1.1
_SUB_COST = 1.0


@dataclass(frozen=True)
class PlateCorrection:
    """correct() sonucu."""

    plate: str          # düzeltilmiş (geçerliyse) veya normalize edilmiş ham metin
    valid: bool         # TR biçimine uyuyor mu
    changes: float      # yapılan düzeltme maliyeti (0 = hiç değişiklik yok)
    raw: str            # normalize edilmiş giriş


def normalize(text: Optional[str]) -> str:
    """Metni büyük harfe çevirir, Türkçe karakterleri sadeleştirir, boşluk/tire/noktalamayı
    siler ve baştaki "TR" ön ekini kaldırır.

    >>> normalize(" tr 34-abc.123 ")
    '34ABC123'
    """
    if not text:
        return ""
    s = str(text).translate(_TURKISH_MAP)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.upper()
    s = re.sub(r"[^A-Z0-9]", "", s)
    # Geçerli plaka rakamla başlar; baştaki "TR" (AB bandı) her zaman atılabilir.
    if s.startswith("TR") and len(s) > 2:
        s = s[2:]
    return s


def split_plate(plate: str) -> Optional[Tuple[str, str, str]]:
    """Geçerli plakayı (il, harfler, rakamlar) olarak böler; geçersizse None."""
    m = _VALID_RE.match(plate or "")
    if not m:
        return None
    city, letters, digits = m.groups()
    if any(ch not in PLATE_LETTERS for ch in letters):
        return None
    if (len(letters), len(digits)) not in VALID_GROUPS:
        return None
    return city, letters, digits


def is_valid(plate: Optional[str]) -> bool:
    """Normalize edilmiş plaka TR biçimine uyuyor mu? (normalize edilmemiş metin de kabul edilir)"""
    if not plate:
        return False
    return split_plate(normalize(plate)) is not None


def format_display(plate: Optional[str]) -> str:
    """"34ABC123" -> "34 ABC 123". Geçersiz plakalar normalize edilmiş hâliyle döner."""
    n = normalize(plate)
    parts = split_plate(n)
    if parts is None:
        return n
    return " ".join(parts)


def _convert(segment: str, to_digit: bool) -> Optional[Tuple[str, int]]:
    """Bir bölgeyi rakam ya da harf bölgesine dönüştürür; (sonuç, değişiklik sayısı)."""
    out = []
    changes = 0
    for ch in segment:
        if to_digit:
            if ch in DIGITS:
                out.append(ch)
            elif ch in LETTER_TO_DIGIT:
                out.append(LETTER_TO_DIGIT[ch])
                changes += 1
            else:
                return None
        else:
            if ch in PLATE_LETTERS:
                out.append(ch)
            elif ch in DIGIT_TO_LETTER:
                out.append(DIGIT_TO_LETTER[ch])
                changes += 1
            elif ch in INVALID_LETTER_FIX:
                out.append(INVALID_LETTER_FIX[ch])
                changes += 1
            else:
                return None
    return "".join(out), changes


def candidates(text: str, max_leading_drop: int = 2, max_trailing_drop: int = 1) -> List[Tuple[float, str]]:
    """Normalize edilmiş metin için olası tüm geçerli plaka yorumlarını (maliyet, plaka)
    olarak döndürür; maliyete göre artan sıralıdır."""
    results = {}
    n = len(text)
    for lead in range(0, max_leading_drop + 1):
        for trail in range(0, max_trailing_drop + 1):
            core = text[lead: n - trail if trail else n]
            if len(core) < 7 or len(core) > 8:
                continue
            drop_cost = (lead + trail) * _DROP_COST
            for n_letters, n_digits in VALID_GROUPS:
                if 2 + n_letters + n_digits != len(core):
                    continue
                city = _convert(core[:2], to_digit=True)
                letters = _convert(core[2:2 + n_letters], to_digit=False)
                digits = _convert(core[2 + n_letters:], to_digit=True)
                if city is None or letters is None or digits is None:
                    continue
                plate = city[0] + letters[0] + digits[0]
                if split_plate(plate) is None:
                    continue
                cost = drop_cost + (city[1] + letters[1] + digits[1]) * _SUB_COST
                if plate not in results or cost < results[plate]:
                    results[plate] = cost
    return sorted(((c, p) for p, c in results.items()), key=lambda x: (x[0], x[1]))


def correct(text: Optional[str], max_changes: float = 3.0) -> PlateCorrection:
    """OCR metnini TR plaka biçimine göre düzeltir.

    Olası harf/rakam bölmelerini dener, konuma göre karakter düzeltmesi uygular
    (rakam bölgesinde O->0, I->1 ...; harf bölgesinde 0->O, 1->I ...) ve en az değişiklikle
    geçerli olan yorumu seçer. Geçerli yorum yoksa normalize edilmiş ham metin döner.
    """
    raw = normalize(text)
    if split_plate(raw) is not None:
        return PlateCorrection(plate=raw, valid=True, changes=0.0, raw=raw)
    cands = candidates(raw)
    if cands and cands[0][0] <= max_changes:
        cost, plate = cands[0]
        return PlateCorrection(plate=plate, valid=True, changes=round(cost, 2), raw=raw)
    return PlateCorrection(plate=raw, valid=False, changes=0.0, raw=raw)


def levenshtein(a: str, b: str) -> int:
    """İki metin arasındaki düzenleme uzaklığı (oylama/tekrar önleme için)."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def iter_all_city_codes() -> Iterable[str]:
    """01..81 il kodları."""
    return (f"{i:02d}" for i in range(1, 82))
