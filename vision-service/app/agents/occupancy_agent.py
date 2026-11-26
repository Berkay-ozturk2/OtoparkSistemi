"""Doluluk kamerası ajanı.

Saniyede ~1 kare işler: araç tespiti -> cep poligonlarıyla kesişim -> çoğunluk oylamasıyla yumuşatma.
Yalnızca DEĞİŞEN cepler ve her `full_report_seconds` saniyede bir TÜM cepler
POST /api/vision/occupancy ile gönderilir. Görüntü diske KAYDEDİLMEZ.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import List, Optional

import cv2
import numpy as np

from app.agents.base_agent import BaseCameraAgent
from app.backend_client import BackendClient, utc_now_iso
from app.model_registry import ModelRegistry
from app.pipeline.occupancy import SlotLayout, SlotObservation, SlotSmoother, draw_layout, evaluate_slots, load_layout

log = logging.getLogger(__name__)


class OccupancyAgent(BaseCameraAgent):
    agent_type = "Occupancy"

    def __init__(self, agent_id: str, source, registry: ModelRegistry, backend: Optional[BackendClient],
                 slots_file: Path, threshold: float = 0.35, smoothing: int = 5, full_report_seconds: float = 60.0,
                 vehicle_conf: float = 0.35, footprint: float = 1.0, detector: str = "yolo", **kw):
        kw.setdefault("target_fps", 1.0)
        super().__init__(agent_id, source, **kw)
        self.registry = registry
        self.backend = backend
        self.slots_file = Path(slots_file)
        self.threshold = threshold
        self.smoothing = smoothing
        self.full_report_seconds = full_report_seconds
        self.vehicle_conf = vehicle_conf
        self.footprint = footprint
        # "yolo" (gerçek kamera, varsayılan) | "color" (yalnızca sentetik demo videosu — demo_detector.py)
        self.detector_kind = (detector or "yolo").lower()
        self._demo_detector = None
        if self.detector_kind == "color":
            from app.pipeline.demo_detector import ColorVehicleDetector
            self._demo_detector = ColorVehicleDetector()
        self.layout: Optional[SlotLayout] = None
        self.smoother = SlotSmoother(smoothing)
        self._last_full: Optional[float] = None  # None: ilk karede tam rapor gönder
        self.occupied_count = 0

    def on_start(self) -> None:
        self.layout = load_layout(self.slots_file)
        self.smoother = SlotSmoother(self.smoothing)
        self._last_full = None
        log.info("[%s] %d cep poligonu yüklendi (%s)", self.id, len(self.layout.slots), self.slots_file.name)

    # ------------------------------------------------------------------
    def process_frame(self, frame: np.ndarray, now: float) -> Optional[np.ndarray]:
        if self.layout is None:
            self.on_start()
        vd = self._demo_detector or self.registry.vehicle_detector
        if not vd.ready:
            self.last_error = self.registry.unavailable_reason(["vehicle"]) or "Araç modeli hazır değil"
            return frame
        h, w = frame.shape[:2]
        layout = self.layout.scaled(w, h)
        vehicles = vd.detect(frame, conf=self.vehicle_conf)
        obs = evaluate_slots(layout, [v.bbox for v in vehicles], [v.confidence for v in vehicles],
                             self.threshold, self.footprint)
        changed = self.smoother.update(obs)

        mono = time.monotonic()
        full_due = self._last_full is None or (mono - self._last_full) >= self.full_report_seconds
        if full_due:
            self._last_full = mono
            self._send(self.smoother.snapshot(), full=True)
        elif changed:
            self._send(changed, full=False)

        states = dict(self.smoother.state)
        self.occupied_count = sum(1 for v in states.values() if v)
        annotated = draw_layout(frame, layout, states)
        for v in vehicles:
            x1, y1, x2, y2 = [int(a) for a in v.bbox]
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (255, 160, 0), 2)
        cv2.rectangle(annotated, (0, 0), (annotated.shape[1], 30), (40, 40, 40), -1)
        cv2.putText(annotated, f"{self.id}  dolu {self.occupied_count}/{len(layout.slots)}  arac {len(vehicles)}",
                    (8, 21), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
        return annotated

    def _send(self, items: List[SlotObservation], full: bool) -> None:
        if not items:
            return
        slots = [{"code": o.code, "occupied": o.occupied, "confidence": o.confidence} for o in items]
        log.info("[%s] doluluk %s: %d cep", self.id, "tam rapor" if full else "değişiklik", len(slots))
        if self.backend is not None:
            self.backend.submit(self.backend.send_occupancy, self.id, slots, utc_now_iso(), lot_code=self.lot_code)
