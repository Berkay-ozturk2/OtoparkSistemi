"""Giriş/Çıkış kamerası ajanı.

Her karede plaka tespiti + OCR yapılır; aynı aracın birden çok karesi PlateVoter ile
oylanır, karar verilince backend'e POST /api/vision/plate-events gönderilir.
Gönderilen görüntü YALNIZCA plaka kırpıntısıdır (KVKK); tam kare hiçbir yere kaydedilmez.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional

import cv2
import numpy as np

from app.agents.base_agent import BaseCameraAgent
from app.agents.voting import PlateVoter, Reading, VoteResult
from app.backend_client import BackendClient, utc_now_iso
from app.model_registry import ModelRegistry
from app.pipeline import tr_plate
from app.pipeline.recognizer import annotate_plates, to_base64_jpeg

log = logging.getLogger(__name__)


class GateAgent(BaseCameraAgent):
    agent_type = "Gate"

    def __init__(self, agent_id: str, source, gate: str, registry: ModelRegistry,
                 backend: Optional[BackendClient], voter: PlateVoter, send_crop: bool = True,
                 roi: Optional[list] = None, **kw):
        super().__init__(agent_id, source, **kw)
        gate = (gate or "Entry").capitalize()
        if gate not in ("Entry", "Exit"):
            raise ValueError(f"Geçersiz gate değeri: {gate} (Entry | Exit olmalı)")
        self.gate = gate
        self.registry = registry
        self.backend = backend
        self.voter = voter
        self.send_crop = send_crop
        self.roi = roi  # [x1, y1, x2, y2] — yalnızca bu bölgede plaka ara (isteğe bağlı)
        self.last_plate: Optional[str] = None
        self.last_decision: Optional[Dict[str, Any]] = None
        self._overlay_text: Optional[str] = None
        self._overlay_until = 0.0
        # Canlı önizleme: kamera tam hızda gösterilir, son tespitler üzerine çizilir
        self.live_preview = True
        self._last_results: list = []
        self._last_results_time = 0.0

    def info(self) -> Dict[str, Any]:
        d = super().info()
        d["gate"] = self.gate
        d["lastPlate"] = self.last_plate
        return d

    # ------------------------------------------------------------------
    def process_frame(self, frame: np.ndarray, now: float) -> Optional[np.ndarray]:
        if not self.registry.plate_detector.ready:
            reason = self.registry.unavailable_reason(["plate"]) or "Plaka modeli hazır değil"
            self.last_error = reason
            return _banner(frame, "Model bekleniyor...", (0, 140, 255))

        work = frame
        ox, oy = 0, 0
        if self.roi:
            x1, y1, x2, y2 = [int(v) for v in self.roi]
            work = frame[max(0, y1):y2, max(0, x1):x2]
            ox, oy = max(0, x1), max(0, y1)

        results = self.registry.recognizer.recognize(work, fast=True)
        for r in results:
            r.bbox = [r.bbox[0] + ox, r.bbox[1] + oy, r.bbox[2] + ox, r.bbox[3] + oy]

        best = next((r for r in results if r.plate), None)
        if best is not None:
            decision = self.voter.add(Reading(
                text=best.plate, valid=best.format_valid, confidence=best.confidence,
                timestamp=now, crop=best.crop, raw_text=best.raw_text))
            if decision is not None:
                self._emit(decision)

        self._last_results = results
        self._last_results_time = time.time()
        return None  # çizim canlı önizlemede (draw_overlay) yapılır

    def draw_overlay(self, frame: np.ndarray) -> Optional[np.ndarray]:
        if not self.registry.plate_detector.ready:
            return _banner(frame, "Model bekleniyor...", (0, 140, 255))
        # Son tespit 1 sn'den eskiyse kutuyu çizme (araç gitmiş olabilir)
        results = self._last_results if time.time() - self._last_results_time < 1.0 else []
        annotated = annotate_plates(frame, results)
        if self.roi:
            x1, y1, x2, y2 = [int(v) for v in self.roi]
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (255, 200, 0), 1)
        label = "GIRIS" if self.gate == "Entry" else "CIKIS"
        status = (f"{self.id} [{label}]  Kamera {self.camera_fps:.0f} FPS | "
                  f"Tespit {self.fps:.1f} FPS  oy: {self.voter.pending}")
        annotated = _banner(annotated, status, (40, 40, 40))
        if self._overlay_text and time.time() < self._overlay_until:
            cv2.putText(annotated, self._overlay_text, (10, annotated.shape[0] - 15), cv2.FONT_HERSHEY_SIMPLEX,
                        0.8, (0, 255, 255), 2, cv2.LINE_AA)
        return annotated

    # ------------------------------------------------------------------
    def _emit(self, decision: VoteResult) -> None:
        self.last_plate = decision.plate
        image_b64 = to_base64_jpeg(decision.crop, quality=85, max_width=400) if self.send_crop else None
        log.info("[%s] karar: %s (geçerli=%s, güven=%.2f, oy %d/%d)", self.id, decision.plate, decision.valid,
                 decision.confidence, decision.votes, decision.total)
        self._overlay_text = f"{tr_plate.format_display(decision.plate)} -> gonderiliyor"
        self._overlay_until = time.time() + 4
        if self.backend is None:
            return
        ts = utc_now_iso()
        self.backend.submit(self._send, decision, image_b64, ts)

    def _send(self, decision: VoteResult, image_b64: Optional[str], ts: str) -> None:
        ok, body = self.backend.send_plate_event(
            self.id, self.gate, decision.plate, decision.confidence, decision.valid, image_b64, ts,
            lot_code=self.lot_code)
        if ok and isinstance(body, dict):
            self.last_decision = body
            self._overlay_text = f"{tr_plate.format_display(decision.plate)}: {body.get('decision')}"
            self._overlay_until = time.time() + 5
        elif not ok:
            self._overlay_text = f"{tr_plate.format_display(decision.plate)}: backend'e ulasilamadi"
            self._overlay_until = time.time() + 5


def _banner(frame: np.ndarray, text: str, color) -> np.ndarray:
    out = frame.copy()
    cv2.rectangle(out, (0, 0), (out.shape[1], 30), color, -1)
    cv2.putText(out, text, (8, 21), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
    return out
