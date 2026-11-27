"""Cep doluluk hesabı (numpy + OpenCV; makine öğrenmesi gerektirmez).

Her cep bir poligondur (config/slots.json). Araç dedektörünün kutuları ile cep
poligonunun kesişim alanı / cep alanı oranı eşik üstündeyse cep "dolu" sayılır.
Kameradaki titremeyi önlemek için son N karede çoğunluk oylaması (SlotSmoother) yapılır.
"""
from __future__ import annotations

import json
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Deque, Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

Box = Sequence[float]  # x1, y1, x2, y2


@dataclass
class Slot:
    code: str
    polygon: List[Tuple[float, float]]
    disabled: bool = False   # engelli cebi (yalnızca örnek görüntü çiziminde işaretlenir)


@dataclass
class SlotLayout:
    image_width: int
    image_height: int
    slots: List[Slot] = field(default_factory=list)
    # Kamera görüş alanı bilgisi (isteğe bağlı): hangi otoparkın hangi katı/bölümü
    layout_id: Optional[str] = None
    lot_code: Optional[str] = None
    name: Optional[str] = None
    floor: Optional[int] = None

    def scaled(self, width: int, height: int) -> "SlotLayout":
        """Poligonları gerçek görüntü boyutuna ölçekler."""
        if width == self.image_width and height == self.image_height:
            return self
        sx = width / float(self.image_width or width)
        sy = height / float(self.image_height or height)
        return SlotLayout(
            image_width=width,
            image_height=height,
            slots=[Slot(s.code, [(x * sx, y * sy) for x, y in s.polygon], s.disabled) for s in self.slots],
            layout_id=self.layout_id, lot_code=self.lot_code, name=self.name, floor=self.floor,
        )

    def to_dict(self) -> dict:
        data: dict = {}
        if self.layout_id:
            data["id"] = self.layout_id
        if self.lot_code:
            data["lotCode"] = self.lot_code
        if self.name:
            data["name"] = self.name
        if self.floor is not None:
            data["floor"] = self.floor
        data.update({
            "imageWidth": self.image_width,
            "imageHeight": self.image_height,
            "slots": [
                {"code": s.code, "polygon": [[round(x, 1), round(y, 1)] for x, y in s.polygon],
                 **({"disabled": True} if s.disabled else {})}
                for s in self.slots
            ],
        })
        return data

    @staticmethod
    def from_dict(data: dict) -> "SlotLayout":
        slots = []
        for item in data.get("slots", []):
            poly = [(float(p[0]), float(p[1])) for p in item.get("polygon", [])]
            if len(poly) >= 3 and item.get("code"):
                slots.append(Slot(str(item["code"]).upper(), poly, bool(item.get("disabled", False))))
        floor = data.get("floor")
        return SlotLayout(
            int(data.get("imageWidth", 1280)), int(data.get("imageHeight", 720)), slots,
            layout_id=data.get("id") or None,
            lot_code=(str(data["lotCode"]).upper() if data.get("lotCode") else None),
            name=data.get("name") or None,
            floor=int(floor) if isinstance(floor, (int, float)) else None,
        )


def load_layout(path: Path) -> SlotLayout:
    with open(path, "r", encoding="utf-8") as f:
        return SlotLayout.from_dict(json.load(f))


def iou(a: Box, b: Box) -> float:
    """İki eksen hizalı kutunun kesişim/birleşim oranı."""
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return float(inter / union) if union > 0 else 0.0


def footprint(box: Box, fraction: float) -> Tuple[float, float, float, float]:
    """Kutunun alt kısmını (aracın zemine bastığı bölge) döndürür.
    Eğik açılı kameralarda tüm kutu komşu cebe taşar; alt kısım daha doğru sonuç verir."""
    x1, y1, x2, y2 = box[:4]
    fraction = min(1.0, max(0.05, fraction))
    return (x1, y2 - (y2 - y1) * fraction, x2, y2)


@dataclass
class SlotObservation:
    code: str
    ratio: float          # cep alanının araçlarca kaplanan oranı (0..1)
    occupied: bool
    confidence: float     # 0..1


def compute_slot_ratios(
    layout: SlotLayout,
    boxes: Sequence[Box],
    footprint_fraction: float = 1.0,
) -> Dict[str, Tuple[float, int]]:
    """Her cep için (kaplanma oranı, en çok örtüşen kutunun indeksi ya da -1).

    Hesap cebin çevreleyen dikdörtgeni içinde yerel maskelerle yapılır (hızlı)."""
    result: Dict[str, Tuple[float, int]] = {}
    fps = [footprint(b, footprint_fraction) for b in boxes]
    for slot in layout.slots:
        pts = np.array(slot.polygon, dtype=np.float64)
        x0, y0 = np.floor(pts.min(axis=0)).astype(int)
        x1, y1 = np.ceil(pts.max(axis=0)).astype(int)
        w, h = max(1, x1 - x0), max(1, y1 - y0)
        slot_mask = np.zeros((h, w), dtype=np.uint8)
        local = np.round(pts - [x0, y0]).astype(np.int32)
        cv2.fillPoly(slot_mask, [local], 1)
        slot_area = int(slot_mask.sum())
        if slot_area == 0:
            result[slot.code] = (0.0, -1)
            continue
        cover = np.zeros_like(slot_mask)
        best_idx, best_overlap = -1, 0
        for idx, (bx1, by1, bx2, by2) in enumerate(fps):
            lx1 = int(max(0, np.floor(bx1 - x0)))
            ly1 = int(max(0, np.floor(by1 - y0)))
            lx2 = int(min(w, np.ceil(bx2 - x0)))
            ly2 = int(min(h, np.ceil(by2 - y0)))
            if lx2 <= lx1 or ly2 <= ly1:
                continue
            overlap = int(slot_mask[ly1:ly2, lx1:lx2].sum())
            if overlap > best_overlap:
                best_idx, best_overlap = idx, overlap
            cover[ly1:ly2, lx1:lx2] = 1
        covered = int((cover & slot_mask).sum())
        result[slot.code] = (covered / slot_area, best_idx)
    return result


def evaluate_slots(
    layout: SlotLayout,
    boxes: Sequence[Box],
    scores: Optional[Sequence[float]] = None,
    threshold: float = 0.35,
    footprint_fraction: float = 1.0,
) -> List[SlotObservation]:
    """Tek kare için cep durumları.

    Güven: dolu ise en çok örtüşen aracın tespit güveni ile oranın eşiği aşma payı
    birleştirilir; boş ise oranın eşikten uzaklığı (0.5..1)."""
    ratios = compute_slot_ratios(layout, boxes, footprint_fraction)
    out: List[SlotObservation] = []
    for slot in layout.slots:
        ratio, idx = ratios[slot.code]
        occupied = ratio >= threshold
        if occupied:
            margin = min(1.0, (ratio - threshold) / max(1e-6, 1.0 - threshold))
            det = float(scores[idx]) if (scores is not None and idx >= 0) else 0.8
            conf = det * (0.7 + 0.3 * margin)
        else:
            conf = 1.0 - 0.5 * (ratio / threshold if threshold > 0 else 0.0)
        out.append(SlotObservation(slot.code, round(float(ratio), 3), bool(occupied), round(float(min(1.0, max(0.0, conf))), 2)))
    return out


class SlotSmoother:
    """Son N gözlemde çoğunluk oylaması ile cep durumu yumuşatma (titreme önleme).

    update() her kare çağrılır; durumu DEĞİŞEN cepleri döndürür. İlk gözlemde
    tüm cepler "değişmiş" sayılır (önceki durum bilinmiyor)."""

    def __init__(self, window: int = 5):
        self.window = max(1, int(window))
        self._history: Dict[str, Deque[bool]] = {}
        self._conf: Dict[str, Deque[float]] = {}
        self.state: Dict[str, bool] = {}

    def update(self, observations: Sequence[SlotObservation]) -> List[SlotObservation]:
        changed: List[SlotObservation] = []
        for obs in observations:
            hist = self._history.setdefault(obs.code, deque(maxlen=self.window))
            confs = self._conf.setdefault(obs.code, deque(maxlen=self.window))
            hist.append(obs.occupied)
            confs.append(obs.confidence)
            votes = sum(hist)
            n = len(hist)
            prev = self.state.get(obs.code)
            if prev is None:
                new_state = obs.occupied
            elif votes * 2 > n:
                new_state = True
            elif votes * 2 < n:
                new_state = False
            else:
                new_state = prev  # eşitlikte mevcut durumu koru
            agreement = (votes if new_state else n - votes) / n
            if prev is None or new_state != prev:
                self.state[obs.code] = new_state
                conf = round(float(np.mean(confs)) * agreement, 2)
                changed.append(SlotObservation(obs.code, obs.ratio, new_state, conf))
        return changed

    def snapshot(self) -> List[SlotObservation]:
        """Tüm ceplerin mevcut (yumuşatılmış) durumu — periyodik tam rapor için."""
        out = []
        for code, st in self.state.items():
            hist = self._history[code]
            n = len(hist)
            votes = sum(hist)
            agreement = (votes if st else n - votes) / n if n else 1.0
            conf = round(float(np.mean(self._conf[code])) * agreement, 2) if n else 0.5
            out.append(SlotObservation(code, 0.0, st, conf))
        return out


def draw_layout(image: np.ndarray, layout: SlotLayout, states: Dict[str, bool]) -> np.ndarray:
    """Cep poligonlarını dolu (kırmızı) / boş (yeşil) olarak çizer."""
    overlay = image.copy()
    for slot in layout.slots:
        pts = np.round(np.array(slot.polygon)).astype(np.int32)
        occupied = states.get(slot.code)
        color = (0, 0, 220) if occupied else ((0, 180, 0) if occupied is not None else (160, 160, 160))
        cv2.fillPoly(overlay, [pts], color)
    out = cv2.addWeighted(overlay, 0.30, image, 0.70, 0)
    for slot in layout.slots:
        pts = np.round(np.array(slot.polygon)).astype(np.int32)
        occupied = states.get(slot.code)
        color = (0, 0, 255) if occupied else (0, 200, 0)
        cv2.polylines(out, [pts], True, color, 2)
        cx, cy = pts.mean(axis=0).astype(int)
        cv2.putText(out, slot.code, (int(cx) - 18, int(cy) + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2, cv2.LINE_AA)
    return out
