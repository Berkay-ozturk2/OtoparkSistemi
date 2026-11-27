"""Herhangi bir cep yerleşimi için SENTETİK üstten görünüş otopark görüntüsü üretir.

Kamera Testi ekranında gerçek fotoğraf olmadan her otoparkın (ve katın) krokisini denemek için
kullanılır. Araçlar gri asfalt üzerinde doygun renkli bloklardır; bu yüzden analizde YOLO yerine
demo renk dedektörü (`demo_detector.ColorVehicleDetector`) kullanılmalıdır.
"""
from __future__ import annotations

import random
from typing import Iterable, List, Optional, Sequence, Set, Tuple

import cv2
import numpy as np

from app.pipeline.occupancy import SlotLayout

CAR_COLORS = [(40, 40, 220), (220, 90, 30), (30, 170, 40), (0, 200, 230), (200, 40, 160),
              (230, 160, 0), (60, 120, 250), (150, 60, 220), (20, 140, 255)]   # BGR, doygun renkler
ASPHALT = (68, 68, 68)
LINE = (235, 235, 235)
DISABLED_MARK = (200, 110, 20)


def draw_car_top(frame: np.ndarray, poly: np.ndarray, color, alpha: float = 1.0) -> None:
    """Cebin İÇİNE üstten görünüşlü araç çizer. alpha<1: araç park ediyor/ayrılıyor (belirip kaybolur);
    araç hiçbir zaman komşu cebe taşmaz, böylece iki araç tek blok gibi görünmez."""
    x, y, bw, bh = cv2.boundingRect(poly)
    cw, ch = int(bw * 0.72), int(bh * 0.80)
    if cw < 4 or ch < 4:
        return
    cx, cy = x + (bw - cw) // 2, y + (bh - ch) // 2
    roi = frame[cy:cy + ch, cx:cx + cw]
    if roi.size == 0:
        return
    car = np.empty_like(roi)
    car[:] = color
    gap = max(2, cw // 10)
    # ön/arka cam (koyu) — gövde rengi hâlâ baskın
    cv2.rectangle(car, (gap, int(ch * 0.18)), (cw - gap, int(ch * 0.32)), (60, 45, 35), -1)
    cv2.rectangle(car, (gap, int(ch * 0.72)), (cw - gap, int(ch * 0.82)), (60, 45, 35), -1)
    a = float(max(0.0, min(1.0, alpha)))
    frame[cy:cy + ch, cx:cx + cw] = cv2.addWeighted(car, a, roi, 1.0 - a, 0)


_TR = str.maketrans("çğıöşüÇĞİÖŞÜ–·", "cgiosuCGIOSU-|")


def ascii_text(text: str) -> str:
    """OpenCV'nin yerleşik yazı tipi Türkçe harfleri çizemez; yaklaşık ASCII karşılığını kullanır."""
    return (text or "").translate(_TR).encode("ascii", "replace").decode("ascii")


def _polys(layout: SlotLayout) -> List[Tuple[str, np.ndarray, bool]]:
    return [(s.code, np.array([[round(x), round(y)] for x, y in s.polygon], np.int32), s.disabled)
            for s in layout.slots]


def render_background(layout: SlotLayout, title: Optional[str] = None) -> np.ndarray:
    w, h = layout.image_width, layout.image_height
    rng = np.random.default_rng(3)
    bg = np.empty((h, w, 3), np.uint8)
    bg[:] = ASPHALT
    noise = rng.integers(-6, 7, size=(h, w, 1), dtype=np.int16)
    bg = np.clip(bg.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    for code, poly, disabled in _polys(layout):
        x, y, bw, bh = cv2.boundingRect(poly)
        cv2.polylines(bg, [poly], True, LINE, 2)
        scale = max(0.3, min(0.5, bw / 110.0))
        cv2.putText(bg, code, (x + 3, y + bh - 5), cv2.FONT_HERSHEY_SIMPLEX, scale, LINE, 1, cv2.LINE_AA)
        if disabled:   # ince mavi işaret (dedektör büyük doygun blok aradığı için araç sayılmaz)
            cv2.rectangle(bg, (x + 4, y + 4), (x + bw - 4, y + bh - 4), DISABLED_MARK, 1)
            cv2.putText(bg, "ENG", (x + 6, y + 16), cv2.FONT_HERSHEY_SIMPLEX, 0.35, DISABLED_MARK, 1, cv2.LINE_AA)
    if title:
        cv2.putText(bg, ascii_text(title), (12, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)
    return bg


def render_sample(layout: SlotLayout, occupied_ratio: float = 0.5, seed: Optional[int] = None,
                  occupied: Optional[Iterable[str]] = None, title: Optional[str] = None
                  ) -> Tuple[np.ndarray, Set[str]]:
    """Yerleşim için örnek kare üretir. `occupied` verilirse tam o cepler, yoksa rastgele
    `occupied_ratio` oranında cep dolu çizilir. Dönüş: (BGR görüntü, dolu cep kodları)."""
    rng = random.Random(seed)
    codes: Sequence[str] = [s.code for s in layout.slots]
    if occupied is not None:
        chosen = {str(c).upper() for c in occupied} & set(codes)
    else:
        ratio = max(0.0, min(1.0, float(occupied_ratio)))
        chosen = set(rng.sample(list(codes), int(round(len(codes) * ratio))))
    frame = render_background(layout, title)
    for code, poly, _ in _polys(layout):
        if code in chosen:
            draw_car_top(frame, poly, CAR_COLORS[rng.randrange(len(CAR_COLORS))])
    return frame, chosen
