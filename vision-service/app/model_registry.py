"""Modellerin arka planda yüklenmesi ve durumunun tutulması.

Servis açılışta hemen yanıt verebilsin diye modeller ayrı bir iş parçacığında yüklenir.
/health uç noktası buradaki durumu gösterir.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Dict, List, Optional

from app.config import Settings
from app.pipeline.ocr import BaseOcr, NullOcr, build_ocr
from app.pipeline.plate_detector import PlateDetector
from app.pipeline.recognizer import PlateRecognizer
from app.pipeline.vehicle_detector import VehicleDetector

log = logging.getLogger(__name__)


class ModelRegistry:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.plate_detector = PlateDetector(
            settings.model_path(settings.PLATE_MODEL), prefer_onnx=settings.PREFER_ONNX, device=settings.device)
        self.vehicle_detector = VehicleDetector(
            settings.model_path(settings.VEHICLE_MODEL), prefer_onnx=settings.PREFER_ONNX, device=settings.device,
            allow_download=settings.ALLOW_MODEL_DOWNLOAD, class_ids=settings.vehicle_class_ids)
        self.ocr: BaseOcr = NullOcr()
        self.recognizer = PlateRecognizer(self.plate_detector, self.ocr, det_conf=settings.CONFIDENCE,
                                         min_ocr_width=settings.MIN_OCR_PLATE_WIDTH)
        self.loading = False
        self.loaded = False
        self.errors: Dict[str, str] = {}
        self.load_seconds: Optional[float] = None
        self._thread: Optional[threading.Thread] = None
        self._ready_event = threading.Event()

    # ------------------------------------------------------------------
    def start_background_load(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self.loading = True
        self._thread = threading.Thread(target=self.load_all, name="model-loader", daemon=True)
        self._thread.start()

    def wait_until_loaded(self, timeout: Optional[float] = None) -> bool:
        return self._ready_event.wait(timeout)

    def load_all(self) -> None:
        t0 = time.perf_counter()
        self.loading = True
        s = self.settings
        log.info("Modeller yükleniyor (cihaz: %s)...", s.device or "otomatik")
        try:
            if not self.plate_detector.load():
                self.errors["plateDetector"] = self.plate_detector.error or "bilinmeyen hata"
            gpu = s.OCR_GPU or _cuda_available()
            if gpu:
                log.info("NVIDIA GPU bulundu: OCR ve YOLO GPU'da çalışacak")
            ocr, ocr_errors = build_ocr(
                s.OCR_ENGINE, s.model_path(s.CHAR_MODEL), s.model_path(s.CHAR_CLASSES), gpu,
                s.device, s.PREFER_ONNX, s.ocr_variants)
            ocr.fast_count = s.LIVE_OCR_VARIANTS
            self.ocr = ocr
            self.recognizer.ocr = ocr
            if ocr_errors and ocr.name == "none":
                self.errors["ocr"] = "; ".join(ocr_errors)
            if s.LOAD_VEHICLE_DETECTOR:
                if not self.vehicle_detector.load():
                    self.errors["vehicleDetector"] = self.vehicle_detector.error or "bilinmeyen hata"
            else:
                self.errors["vehicleDetector"] = "LOAD_VEHICLE_DETECTOR=false ile kapatıldı"
        except Exception as exc:  # hiçbir durumda servis çökmesin
            log.exception("Model yükleme sırasında beklenmeyen hata: %s", exc)
            self.errors["general"] = str(exc)
        finally:
            self.loading = False
            self.loaded = True
            self.load_seconds = round(time.perf_counter() - t0, 2)
            self._ready_event.set()
            log.info("Model yükleme bitti (%.1f sn): plaka=%s, araç=%s, ocr=%s",
                     self.load_seconds, self.plate_detector.ready, self.vehicle_detector.ready, self.ocr.name)

    # ------------------------------------------------------------------
    def health(self) -> dict:
        return {
            "plateDetector": self.plate_detector.ready,
            "vehicleDetector": self.vehicle_detector.ready,
            "ocr": self.ocr.name if self.ocr.ready or self.ocr.name == "none" else "none",
        }

    def details(self) -> dict:
        return {
            "loading": self.loading,
            "loadSeconds": self.load_seconds,
            "plateDetectorBackend": self.plate_detector.model.backend,
            "vehicleDetectorBackend": self.vehicle_detector.model.backend,
            "errors": dict(self.errors),
        }

    def unavailable_reason(self, need: List[str]) -> Optional[str]:
        """İstek için gereken model hazır değilse Türkçe açıklama döndürür."""
        if self.loading or not self.loaded:
            return "Modeller hâlâ yükleniyor, lütfen birkaç saniye sonra tekrar deneyin."
        if "plate" in need and not self.plate_detector.ready:
            return ("Plaka tespit modeli yüklenemedi: "
                    f"{self.errors.get('plateDetector', 'models/plate_detector_tr.pt bulunamadı')}. "
                    "ultralytics (veya onnxruntime) kurulu olduğundan ve model dosyasının models/ klasöründe "
                    "bulunduğundan emin olun.")
        if "vehicle" in need and not self.vehicle_detector.ready:
            return ("Araç tespit modeli (yolov8n) yüklenemedi: "
                    f"{self.errors.get('vehicleDetector', 'bilinmeyen hata')}. İlk çalıştırmada internet bağlantısı "
                    "gerekir ya da models/yolov8n.pt dosyasını elle kopyalayın.")
        return None


def _cuda_available() -> bool:
    """CUDA destekli torch kuruluysa ve NVIDIA GPU varsa True."""
    try:
        import torch  # tembel import
        return bool(torch.cuda.is_available())
    except Exception:
        return False
