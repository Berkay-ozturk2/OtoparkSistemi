"""Giriş/çıkış kamerası için çok kareli oylama ve tekrar önleme (saf mantık, test edilebilir).

Akış:
  * Her karedeki en iyi plaka okuması add() ile verilir.
  * Son `window_seconds` içindeki okumalar tutulur. En az `min_reads` okuma birikince
    en sık görülen GEÇERLİ metin seçilir (eşitlikte toplam güven büyük olan);
    geçerli okuma yoksa en sık ham metin formatValid=false ile seçilir.
  * Seçilen plaka `cooldown_seconds` boyunca (ve ona 1 karakter uzaklıktaki okumalar)
    tekrar gönderilmez. Geçersiz sonuçlar ayrıca `invalid_cooldown_seconds` ile seyreltilir.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from app.pipeline.tr_plate import levenshtein


@dataclass
class Reading:
    text: str            # düzeltilmiş (geçerliyse) ya da normalize edilmiş ham metin
    valid: bool
    confidence: float    # tespit × OCR güveni
    timestamp: float
    crop: Any = None     # plaka kırpıntısı (numpy dizisi) — yalnızca bellekte
    raw_text: str = ""


@dataclass
class VoteResult:
    plate: str
    valid: bool
    confidence: float
    votes: int
    total: int
    crop: Any = None
    raw_text: str = ""


class PlateVoter:
    def __init__(
        self,
        window_seconds: float = 1.5,
        min_reads: int = 3,
        cooldown_seconds: float = 30.0,
        invalid_cooldown_seconds: float = 15.0,
        min_text_length: int = 4,
        send_invalid: bool = True,
    ):
        self.window_seconds = window_seconds
        self.min_reads = max(1, min_reads)
        self.cooldown_seconds = cooldown_seconds
        self.invalid_cooldown_seconds = invalid_cooldown_seconds
        self.min_text_length = min_text_length
        self.send_invalid = send_invalid
        self._readings: List[Reading] = []
        self._cooldowns: Dict[str, float] = {}   # plaka -> son gönderim zamanı
        self._last_invalid_sent: float = float("-inf")

    # ------------------------------------------------------------------
    def in_cooldown(self, text: str, now: float) -> bool:
        """Plaka (ya da 1 karakter farklı bir okuması) yakın zamanda gönderildi mi?"""
        self._purge_cooldowns(now)
        for plate in self._cooldowns:
            if text == plate or (len(text) >= 6 and levenshtein(text, plate) <= 1):
                return True
        return False

    def _purge_cooldowns(self, now: float) -> None:
        expired = [p for p, t in self._cooldowns.items() if now - t >= self.cooldown_seconds]
        for p in expired:
            del self._cooldowns[p]

    def reset(self) -> None:
        self._readings.clear()

    @property
    def pending(self) -> int:
        return len(self._readings)

    # ------------------------------------------------------------------
    def add(self, reading: Reading) -> Optional[VoteResult]:
        """Yeni okuma ekler; karar verildiyse VoteResult döndürür."""
        now = reading.timestamp
        text = reading.text or ""
        if len(text) < self.min_text_length:
            return None
        if self.in_cooldown(text, now):
            return None
        # Pencere dışındaki eski okumaları at
        self._readings = [r for r in self._readings if now - r.timestamp <= self.window_seconds]
        self._readings.append(reading)
        if len(self._readings) < self.min_reads:
            return None

        valid = [r for r in self._readings if r.valid]
        pool = valid if valid else self._readings
        counts = Counter(r.text for r in pool)
        conf_sum: Dict[str, float] = {}
        for r in pool:
            conf_sum[r.text] = conf_sum.get(r.text, 0.0) + r.confidence
        winner = max(counts, key=lambda t: (counts[t], conf_sum[t]))
        winner_reads = [r for r in pool if r.text == winner]
        is_valid = bool(valid)

        if not is_valid:
            if not self.send_invalid:
                return None
            if now - self._last_invalid_sent < self.invalid_cooldown_seconds:
                return None
            # Geçersiz metinde en az iki okuma aynı olmalı (gürültüyü göndermemek için)
            if counts[winner] < 2:
                return None
            self._last_invalid_sent = now

        best = max(winner_reads, key=lambda r: r.confidence)
        result = VoteResult(
            plate=winner,
            valid=is_valid,
            confidence=round(sum(r.confidence for r in winner_reads) / len(winner_reads), 3),
            votes=len(winner_reads),
            total=len(self._readings),
            crop=best.crop,
            raw_text=best.raw_text or best.text,
        )
        self._cooldowns[winner] = now
        self._readings.clear()
        return result
