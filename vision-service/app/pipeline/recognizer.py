"""Uçtan uca plaka tanıma: tespit -> kırpma -> OCR -> TR biçim düzeltmesi.

confidence = tespit_güveni × ocr_güveni (0..1)
"""
from __future__ import annotations

import base64
from dataclasses import dataclass, field
from typing import List, Optional

import cv2
import numpy as np

from app.pipeline import tr_plate
from app.pipeline.ocr import BaseOcr, NullOcr, OcrResult
from app.pipeline.plate_detector import PlateDetector, crop_plate


@dataclass
class PlateResult:
    plate: str               # normalize edilmiş (geçerliyse düzeltilmiş) plaka
    raw_text: str            # OCR ham metni
    confidence: float        # tespit × OCR
    format_valid: bool
    bbox: List[int]
    detection_confidence: float
    ocr_confidence: float
    ocr_engine: str
    crop: Optional[np.ndarray] = field(default=None, repr=False)

    def to_api(self) -> dict:
        return {
            "plate": self.plate,
            "rawText": self.raw_text,
            "confidence": round(self.confidence, 4),
            "formatValid": self.format_valid,
            "bbox": [int(v) for v in self.bbox],
            "detectionConfidence": round(self.detection_confidence, 4),
            "ocrConfidence": round(self.ocr_confidence, 4),
        }


class PlateRecognizer:
    def __init__(self, detector: PlateDetector, ocr: Optional[BaseOcr] = None,
                 det_conf: float = 0.4, max_plates: int = 5, min_ocr_width: int = 0):
        self.detector = detector
        self.min_ocr_width = min_ocr_width
        self.ocr = ocr or NullOcr()
        self.det_conf = det_conf
        self.max_plates = max_plates

    def recognize(self, image: np.ndarray, fast: bool = False) -> List[PlateResult]:
        """Görüntüdeki plakaları okur; güvene göre azalan sırada döner.
        fast=True canlı kamera için daha az ön işleme varyantı dener."""
        results: List[PlateResult] = []
        for det in self.detector.detect(image, conf=self.det_conf, max_det=self.max_plates):
            crop = crop_plate(image, det.bbox)
            if fast and self.min_ocr_width and (det.bbox[2] - det.bbox[0]) < self.min_ocr_width:
                # Plaka çok küçük (araç uzakta): OCR zaten başarısız olur, zaman harcama
                ocr = OcrResult.empty(getattr(self.ocr, "name", "none"))
            else:
                ocr = self.ocr.read(crop, fast=fast)
            if ocr.text:
                plate, valid = ocr.text, ocr.valid
            else:
                plate, valid = "", False
            conf = det.confidence * ocr.confidence
            results.append(PlateResult(
                plate=plate, raw_text=ocr.raw, confidence=float(conf), format_valid=bool(valid),
                bbox=det.bbox, detection_confidence=det.confidence, ocr_confidence=ocr.confidence,
                ocr_engine=ocr.engine, crop=crop,
            ))
        results.sort(key=lambda r: (r.format_valid, r.confidence, r.detection_confidence), reverse=True)
        return results


def best_result(results: List[PlateResult]) -> Optional[PlateResult]:
    """Backend'e gönderilecek en iyi sonuç: önce geçerli biçim, sonra güven."""
    candidates = [r for r in results if r.plate]
    if not candidates:
        return None
    return max(candidates, key=lambda r: (r.format_valid, r.confidence))


def annotate_plates(image: np.ndarray, results: List[PlateResult]) -> np.ndarray:
    """Plaka kutularını ve okunan metni çizer (geçerli: yeşil, geçersiz: turuncu)."""
    out = image.copy()
    for r in results:
        x1, y1, x2, y2 = r.bbox
        color = (0, 200, 0) if r.format_valid else (0, 140, 255)
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)
        if r.plate:
            label = f"{tr_plate.format_display(r.plate)}  {r.confidence:.2f}"
        else:
            label = f"plaka (okunamadi) {r.detection_confidence:.2f}"
        scale = max(0.5, min(1.2, (x2 - x1) / 220.0))
        (tw, th), base = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, scale, 2)
        ty = y1 - 6 if y1 - th - 10 > 0 else y2 + th + 6
        cv2.rectangle(out, (x1, ty - th - 4), (x1 + tw + 6, ty + base), color, -1)
        cv2.putText(out, label, (x1 + 3, ty - 2), cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), 2, cv2.LINE_AA)
    return out


def encode_jpeg(image: np.ndarray, quality: int = 85) -> bytes:
    ok, buf = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)])
    if not ok:
        raise ValueError("JPEG kodlanamadı")
    return buf.tobytes()


def to_base64_jpeg(image: Optional[np.ndarray], quality: int = 85, max_width: Optional[int] = None) -> Optional[str]:
    """Görüntüyü base64 JPEG metnine çevirir (önek yok: 'data:image/jpeg;base64,' eklenmez)."""
    if image is None or image.size == 0:
        return None
    if max_width and image.shape[1] > max_width:
        s = max_width / image.shape[1]
        image = cv2.resize(image, (max_width, max(1, int(image.shape[0] * s))), interpolation=cv2.INTER_AREA)
    return base64.b64encode(encode_jpeg(image, quality)).decode("ascii")


def decode_image(data: bytes) -> Optional[np.ndarray]:
    """Yüklenen dosya baytlarını BGR görüntüye çevirir; çözülemezse None."""
    if not data:
        return None
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img
