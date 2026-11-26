"""Araç tespiti (COCO ile eğitilmiş YOLOv8n).

models/yolov8n.pt yoksa ultralytics ilk çalıştırmada "yolov8n.pt" dosyasını internetten indirir.
ultralytics kurulu değilse models/yolov8n.onnx (training/onnx_aktar.py ile üretilebilir) kullanılır.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

import numpy as np

from app.pipeline.yolo_backend import YoloModel

# COCO sınıfları: car=2, motorcycle=3, bus=5, truck=7
VEHICLE_CLASSES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}


@dataclass
class VehicleDetection:
    bbox: List[float]
    confidence: float
    cls: int

    @property
    def label(self) -> str:
        return VEHICLE_CLASSES.get(self.cls, str(self.cls))


class VehicleDetector:
    def __init__(self, pt_path: Path, onnx_path: Optional[Path] = None, prefer_onnx: bool = False,
                 device: Optional[str] = None, imgsz: int = 640, allow_download: bool = True,
                 class_ids: Optional[List[int]] = None):
        self.model = YoloModel("araç-dedektörü")
        self.pt_path = pt_path
        self.onnx_path = onnx_path or pt_path.with_suffix(".onnx")
        self.prefer_onnx = prefer_onnx
        self.device = device
        self.imgsz = imgsz
        self.allow_download = allow_download
        # COCO modeli için 2,3,5,7; kendi eğittiğiniz tek sınıflı araç modeli için ör. [0]
        self.class_ids = list(class_ids) if class_ids else list(VEHICLE_CLASSES)

    def load(self) -> bool:
        return self.model.load(
            self.pt_path, self.onnx_path, prefer_onnx=self.prefer_onnx, device=self.device,
            allow_download_name=self.pt_path.name if self.allow_download else None,
        )

    @property
    def ready(self) -> bool:
        return self.model.ready

    @property
    def error(self) -> Optional[str]:
        return self.model.error

    def detect(self, image: np.ndarray, conf: float = 0.35) -> List[VehicleDetection]:
        dets = self.model.predict(image, conf=conf, iou=0.5, imgsz=self.imgsz, classes=self.class_ids)
        return [VehicleDetection([float(a) for a in d[:4]], float(d[4]), int(d[5])) for d in dets]
