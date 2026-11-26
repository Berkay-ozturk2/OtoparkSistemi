"""Türk plakası tespiti (YOLOv8n, tek sınıf: plaka).

Model: models/plate_detector_tr.pt (Semihocakli/turkish-plate-recognition, Apache-2.0).
ultralytics yoksa aynı modelin models/plate_detector_tr.onnx sürümü onnxruntime ile çalışır.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

import numpy as np

from app.pipeline.yolo_backend import YoloModel

log = logging.getLogger(__name__)


@dataclass
class PlateDetection:
    bbox: List[int]       # x1, y1, x2, y2 (piksel)
    confidence: float


class PlateDetector:
    def __init__(self, pt_path: Path, onnx_path: Optional[Path] = None, prefer_onnx: bool = False,
                 device: Optional[str] = None, imgsz: int = 640):
        self.model = YoloModel("plaka-dedektörü")
        self.pt_path = pt_path
        self.onnx_path = onnx_path or pt_path.with_suffix(".onnx")
        self.prefer_onnx = prefer_onnx
        self.device = device
        self.imgsz = imgsz

    def load(self) -> bool:
        return self.model.load(self.pt_path, self.onnx_path, prefer_onnx=self.prefer_onnx, device=self.device)

    @property
    def ready(self) -> bool:
        return self.model.ready

    @property
    def error(self) -> Optional[str]:
        return self.model.error

    def detect(self, image: np.ndarray, conf: float = 0.4, max_det: int = 10) -> List[PlateDetection]:
        dets = self.model.predict(image, conf=conf, iou=0.5, imgsz=self.imgsz, agnostic=True)
        h, w = image.shape[:2]
        out: List[PlateDetection] = []
        for x1, y1, x2, y2, score, _cls in dets[:max_det]:
            box = [int(max(0, x1)), int(max(0, y1)), int(min(w, x2)), int(min(h, y2))]
            if box[2] - box[0] < 8 or box[3] - box[1] < 4:
                continue  # çok küçük kutular okunamaz
            out.append(PlateDetection(box, float(score)))
        out.sort(key=lambda d: d.confidence, reverse=True)
        return out


def crop_plate(image: np.ndarray, bbox: List[int], pad_ratio: float = 0.06) -> np.ndarray:
    """Plaka bölgesini kenarlardan biraz pay bırakarak kırpar (KVKK: yalnızca plaka bölgesi)."""
    h, w = image.shape[:2]
    x1, y1, x2, y2 = bbox
    px = int((x2 - x1) * pad_ratio)
    py = int((y2 - y1) * pad_ratio)
    x1, y1 = max(0, x1 - px), max(0, y1 - py)
    x2, y2 = min(w, x2 + px), min(h, y2 + py)
    return image[y1:y2, x1:x2].copy()
