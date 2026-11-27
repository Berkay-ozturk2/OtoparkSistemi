"""DEMO araç dedektörü (yalnızca sentetik demo videosu için).

`tools/demo_uret.py` ile üretilen doluluk videosunda araçlar gri asfalt üzerinde DOYGUN renkli
dikdörtgenlerdir. YOLO (COCO) çizilmiş araçları güvenilir tanımadığı için, gerçek kamera ve otopark
olmadan "kamera -> doluluk -> harita" zincirini test edebilmek amacıyla bu basit renk dedektörü
kullanılır. Gerçek kameralarda HER ZAMAN YOLO kullanılır (cameras.yaml: detector: yolo, varsayılan).

Yöntem: HSV doygunluk + parlaklık eşiği -> morfolojik temizlik -> kontur -> sınırlayıcı kutu.
Beyaz/gri çizgiler, yazılar ve ince mavi engelli işaretleri doygun ya da yeterince büyük olmadığı için elenir.
"""
from __future__ import annotations

from typing import List

import cv2
import numpy as np

from app.pipeline.vehicle_detector import VehicleDetection


class ColorVehicleDetector:
    name = "demo-renk"

    def __init__(self, min_saturation: int = 90, min_value: int = 60, min_area_ratio: float = 0.004,
                 max_area_ratio: float = 0.08):
        self.min_saturation = min_saturation
        self.min_value = min_value
        self.min_area_ratio = min_area_ratio
        self.max_area_ratio = max_area_ratio

    @property
    def ready(self) -> bool:
        return True

    @property
    def error(self):
        return None

    def detect(self, image: np.ndarray, conf: float = 0.35) -> List[VehicleDetection]:
        if image is None or image.size == 0:
            return []
        h, w = image.shape[:2]
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv, (0, self.min_saturation, self.min_value), (180, 255, 255))
        k = max(3, int(round(min(h, w) / 160)) | 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        area_img = float(h * w)
        out: List[VehicleDetection] = []
        for c in contours:
            x, y, bw, bh = cv2.boundingRect(c)
            ratio = (bw * bh) / area_img
            if ratio < self.min_area_ratio or ratio > self.max_area_ratio:
                continue
            fill = cv2.contourArea(c) / float(max(1, bw * bh))
            if fill < 0.5:  # araç dolu bir bloktur; ince çizgi/çerçeve değil
                continue
            out.append(VehicleDetection([float(x), float(y), float(x + bw), float(y + bh)], 0.9, 2))
        return out

    @classmethod
    def for_layout(cls, layout, image_width: int, image_height: int) -> "ColorVehicleDetector":
        """Araç büyüklük eşiklerini cep boyutuna göre ayarlar. Çok cepli büyük krokilerde (ör. AVM, 144 cep)
        sabit oranlar küçük araçları elerdi. `layout` görüntü boyutuna ölçeklenmiş olmalıdır."""
        areas = []
        for s in getattr(layout, "slots", []):
            xs = [p[0] for p in s.polygon]
            ys = [p[1] for p in s.polygon]
            areas.append(max(1.0, (max(xs) - min(xs)) * (max(ys) - min(ys))))
        img = float(max(1, image_width * image_height))
        if not areas:
            return cls()
        return cls(min_area_ratio=0.25 * min(areas) / img, max_area_ratio=min(0.5, 2.5 * max(areas) / img))
