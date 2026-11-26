"""Ajan mantığı testleri: sahte tanıyıcı/araç dedektörü ile (model gerektirmez)."""
import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np

from app.agents.base_agent import mask_source, parse_source
from app.agents.gate_agent import GateAgent
from app.agents.manager import AgentManager
from app.agents.occupancy_agent import OccupancyAgent
from app.agents.voting import PlateVoter
from app.backend_client import BackendClient
from app.config import Settings
from app.pipeline.recognizer import PlateResult
from app.pipeline.vehicle_detector import VehicleDetection
from tests.mock_backend import MockBackend


class FakeRecognizer:
    def __init__(self, texts):
        self.texts = list(texts)

    def recognize(self, image, fast=False):
        text = self.texts.pop(0) if self.texts else ""
        if not text:
            return []
        return [PlateResult(text, text, 0.85, True, [10, 10, 60, 30], 0.9, 0.94, "fake",
                            crop=np.full((20, 50, 3), 200, np.uint8))]


class FakeVehicles:
    ready = True

    def __init__(self, boxes):
        self.boxes = boxes

    def detect(self, image, conf=0.35):
        return [VehicleDetection(b, 0.9, 2) for b in self.boxes]


def wait_for(cond, timeout=3.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if cond():
            return True
        time.sleep(0.02)
    return False


class GateAgentTests(unittest.TestCase):
    def test_votes_then_posts_once(self):
        with MockBackend() as mb:
            backend = BackendClient(mb.url, "dev-vision-key", timeout=2, retries=1)
            registry = SimpleNamespace(plate_detector=SimpleNamespace(ready=True),
                                       recognizer=FakeRecognizer(["34ABC123"] * 6),
                                       unavailable_reason=lambda need: None)
            agent = GateAgent("giris-1", "0", gate="Entry", registry=registry, backend=backend,
                              voter=PlateVoter(window_seconds=1.5, min_reads=3, cooldown_seconds=30))
            frame = np.zeros((120, 160, 3), np.uint8)
            for i in range(6):
                agent.process_frame(frame, 100.0 + i * 0.2)
                out = agent.draw_overlay(frame)               # canlı önizleme çizimi
                self.assertEqual(out.shape, frame.shape)
            self.assertTrue(wait_for(lambda: len(mb.requests) >= 1))
            time.sleep(0.2)
            self.assertEqual(len(mb.requests), 1)           # cooldown: yalnızca bir kez
            body = mb.requests[0][1]
            self.assertEqual((body["cameraId"], body["gate"], body["plate"], body["formatValid"]),
                             ("giris-1", "Entry", "34ABC123", True))
            self.assertAlmostEqual(body["confidence"], 0.85)
            self.assertTrue(body["imageBase64"])            # plaka kırpıntısı
            self.assertEqual(agent.info()["lastPlate"], "34ABC123")
            backend.close()

    def test_model_not_ready(self):
        registry = SimpleNamespace(plate_detector=SimpleNamespace(ready=False),
                                   unavailable_reason=lambda need: "Modeller hâlâ yükleniyor")
        agent = GateAgent("cikis-1", "0", gate="Exit", registry=registry, backend=None, voter=PlateVoter())
        agent.process_frame(np.zeros((50, 50, 3), np.uint8), 0.0)
        self.assertIn("yükleniyor", agent.last_error)

    def test_invalid_gate(self):
        with self.assertRaises(ValueError):
            GateAgent("x", "0", gate="Side", registry=None, backend=None, voter=PlateVoter())


class OccupancyAgentTests(unittest.TestCase):
    def test_changes_and_full_report(self):
        with tempfile.TemporaryDirectory() as d, MockBackend() as mb:
            slots = Path(d) / "slots.json"
            slots.write_text(json.dumps({"imageWidth": 200, "imageHeight": 100, "slots": [
                {"code": "A01", "polygon": [[0, 0], [100, 0], [100, 100], [0, 100]]},
                {"code": "A02", "polygon": [[100, 0], [200, 0], [200, 100], [100, 100]]}]}))
            backend = BackendClient(mb.url, "dev-vision-key", timeout=2, retries=1)
            vehicles = FakeVehicles([[0, 0, 100, 100]])
            registry = SimpleNamespace(vehicle_detector=vehicles, unavailable_reason=lambda need: None)
            agent = OccupancyAgent("doluluk-1", "x.mp4", registry=registry, backend=backend, slots_file=slots,
                                   smoothing=3, full_report_seconds=3600)
            frame = np.zeros((200, 400, 3), np.uint8)   # slots.json'dan 2 kat büyük: poligonlar ölçeklenir
            vehicles.boxes = [[0, 0, 200, 200]]
            agent.process_frame(frame, 0)               # ilk kare: tam rapor
            for _ in range(3):
                agent.process_frame(frame, 0)            # değişiklik yok -> gönderim yok
            vehicles.boxes = [[0, 0, 200, 200], [200, 0, 400, 200]]
            for _ in range(3):
                agent.process_frame(frame, 0)            # A02 doldu -> 1 değişiklik
            self.assertTrue(wait_for(lambda: len(mb.requests) >= 2))
            time.sleep(0.2)
            self.assertEqual(len(mb.requests), 2)
            first, second = mb.requests[0][1], mb.requests[1][1]
            self.assertEqual({s["code"]: s["occupied"] for s in first["slots"]}, {"A01": True, "A02": False})
            self.assertEqual([(s["code"], s["occupied"]) for s in second["slots"]], [("A02", True)])
            self.assertEqual(agent.occupied_count, 2)
            backend.close()


class ManagerTests(unittest.TestCase):
    def test_builds_agents_from_yaml(self):
        s = Settings.load(environ={})
        mgr = AgentManager(s, registry=SimpleNamespace(), backend=None)
        mgr.load()
        info = {a["id"]: a for a in mgr.list_info()}
        self.assertEqual(set(info), {"giris-1", "cikis-1", "doluluk-1"})
        self.assertEqual((info["giris-1"]["type"], info["giris-1"]["gate"]), ("Gate", "Entry"))
        self.assertEqual((info["cikis-1"]["gate"]), "Exit")
        self.assertEqual(info["doluluk-1"]["type"], "Occupancy")
        self.assertTrue(all(a["status"] == "Stopped" and not a["enabled"] for a in info.values()))
        hb = mgr.heartbeat_payload()
        self.assertEqual(set(hb[0]), {"id", "type", "lotCode", "status", "fps", "lastError"})


class VideoLoopTests(unittest.TestCase):
    def test_file_source_runs_and_loops(self):
        """Kısa bir video dosyası üretip ajanın okuyup başa sardığını ve anlık görüntü ürettiğini doğrular."""
        with tempfile.TemporaryDirectory() as d:
            path = str(Path(d) / "kisa.avi")
            vw = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"MJPG"), 10, (64, 48))
            if not vw.isOpened():
                self.skipTest("VideoWriter bu ortamda desteklenmiyor")
            for i in range(5):
                vw.write(np.full((48, 64, 3), i * 40, np.uint8))
            vw.release()
            registry = SimpleNamespace(plate_detector=SimpleNamespace(ready=True),
                                       recognizer=FakeRecognizer([]), unavailable_reason=lambda n: None)
            agent = GateAgent("giris-1", path, gate="Entry", registry=registry, backend=None,
                              voter=PlateVoter(), target_fps=50)
            agent.start()
            try:
                self.assertTrue(wait_for(lambda: agent.frames_processed >= 12, 5))  # 5 karelik video -> sarmış olmalı
                self.assertEqual(agent.status, "Running")
                self.assertTrue(agent.snapshot().startswith(b"\xff\xd8"))
            finally:
                agent.stop()
            self.assertEqual(agent.status, "Stopped")

    def test_missing_file_sets_error(self):
        registry = SimpleNamespace(plate_detector=SimpleNamespace(ready=True), recognizer=FakeRecognizer([]),
                                   unavailable_reason=lambda n: None)
        agent = GateAgent("g", "samples/yok.mp4", gate="Entry", registry=registry, backend=None, voter=PlateVoter())
        agent.start()
        try:
            self.assertTrue(wait_for(lambda: agent.status == "Error"))
            self.assertIn("bulunamadı", agent.last_error)
        finally:
            agent.stop()


class SourceTests(unittest.TestCase):
    def test_parse_and_mask(self):
        self.assertEqual(parse_source("0"), 0)
        self.assertEqual(parse_source("rtsp://a:b@h/s"), "rtsp://a:b@h/s")
        self.assertTrue(Path(parse_source("samples/x.mp4")).as_posix().endswith("samples/x.mp4"))
        self.assertEqual(mask_source("rtsp://admin:gizli@10.0.0.5:554/s"), "rtsp://***@10.0.0.5:554/s")


class SettingsTests(unittest.TestCase):
    def test_env_override(self):
        s = Settings.load(environ={"BACKEND_URL": "http://x:1/", "CONFIDENCE": "0.6", "PREFER_ONNX": "true",
                                   "VOTE_MIN_READS": "4"})
        self.assertEqual((s.BACKEND_URL, s.CONFIDENCE, s.PREFER_ONNX, s.VOTE_MIN_READS), ("http://x:1", 0.6, True, 4))

    def test_env_file(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / ".env"
            p.write_text('# yorum\nVISION_API_KEY="gizli"\nCORS_ORIGINS=http://a,http://b  # not\n', encoding="utf-8")
            s = Settings.load(env_file=p, environ={})
            self.assertEqual(s.VISION_API_KEY, "gizli")
            self.assertEqual(s.cors_origins, ["http://a", "http://b"])


if __name__ == "__main__":
    unittest.main()
