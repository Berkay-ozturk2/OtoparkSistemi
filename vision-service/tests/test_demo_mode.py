"""Demo/simülasyon modu testleri: demo kamera yapılandırması, demo dedektörü, sentetik içerik, video döngüsü."""
import importlib.util
import random
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np

from app.agents.gate_agent import GateAgent
from app.agents.manager import AgentManager, load_camera_config
from app.agents.occupancy_agent import OccupancyAgent
from app.agents.voting import PlateVoter
from app.config import BASE_DIR, Settings
from app.pipeline.demo_detector import ColorVehicleDetector
from app.pipeline.occupancy import evaluate_slots, load_layout

SLOTS = BASE_DIR / "config" / "slots.json"
DEMO_YAML = BASE_DIR / "config" / "cameras.demo.yaml"


def _load_demo_uret():
    spec = importlib.util.spec_from_file_location("demo_uret", BASE_DIR / "tools" / "demo_uret.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class DemoConfigTests(unittest.TestCase):
    def test_demo_yaml_builds_three_agents(self):
        cfgs = load_camera_config(DEMO_YAML)
        self.assertEqual({c["id"] for c in cfgs}, {"giris-demo", "cikis-demo", "doluluk-demo"})
        settings = Settings.load(environ={"CAMERAS_FILE": "config/cameras.demo.yaml"})
        self.assertEqual(settings.cameras_file, DEMO_YAML)
        mgr = AgentManager(settings, registry=SimpleNamespace(), backend=None)
        mgr.load()
        occ = mgr.get("doluluk-demo")
        self.assertIsInstance(occ, OccupancyAgent)
        self.assertEqual(occ.detector_kind, "color")
        self.assertEqual(mgr.get("giris-demo").gate, "Entry")
        self.assertEqual(mgr.get("cikis-demo").gate, "Exit")
        self.assertTrue(all(a.enabled and a.lot_code == "GAZI" for a in mgr.agents.values()))


class DemoContentTests(unittest.TestCase):
    def test_color_detector_matches_synthetic_frame(self):
        du = _load_demo_uret()
        w, h, slots = du.load_slots(SLOTS)
        frame = du.lot_background(w, h, slots, du.DISABLED_SLOTS)
        parked = {"A02", "A05", "B01", "C08"}            # A02 engelli cep: ince mavi işaret araç sayılmamalı
        for code, poly in slots:
            if code in parked:
                du.draw_car_top(frame, poly, du.CAR_COLORS[1])
        dets = ColorVehicleDetector().detect(frame)
        obs = evaluate_slots(load_layout(SLOTS).scaled(w, h), [d.bbox for d in dets], [d.confidence for d in dets], 0.35)
        self.assertEqual({o.code for o in obs if o.occupied}, parked)

    def test_schedule_contains_violation_scenario(self):
        du = _load_demo_uret()
        sched = du.build_schedule(["A01", "A02", "B01"], 900, 10, random.Random(7))
        self.assertTrue(sched["A02"], "A02 (engelli) için izinsiz park senaryosu olmalı")
        self.assertTrue(sched["B01"])

    def test_plate_render_and_photo(self):
        du = _load_demo_uret()
        img = du.render_plate("34DMO101")
        self.assertEqual(img.shape[2], 3)
        self.assertGreater(img.shape[1], img.shape[0] * 4)        # plaka oranı
        with tempfile.TemporaryDirectory() as d:
            paths = du.make_plate_photos(Path(d), ["34DMO101"])
            self.assertTrue(paths[0].exists())
            self.assertEqual(cv2.imread(str(paths[0])).shape[:2], (720, 1280))

    def test_short_videos_are_written(self):
        du = _load_demo_uret()
        with tempfile.TemporaryDirectory() as d:
            occ = du.make_occupancy_video(Path(d) / "doluluk.mp4", SLOTS, seconds=2, fps=5)
            gate = du.make_gate_video(Path(d) / "giris.mp4", ["06DMO202"], "GIRIS", fps=5)
            for p in (occ, gate):
                cap = cv2.VideoCapture(str(p))
                self.assertTrue(cap.isOpened(), p)
                self.assertGreater(int(cap.get(cv2.CAP_PROP_FRAME_COUNT)), 5)
                cap.release()


class VideoLoopTests(unittest.TestCase):
    def test_video_loops_without_error(self):
        with tempfile.TemporaryDirectory() as d:
            path = str(Path(d) / "kisa.avi")
            vw = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"MJPG"), 25, (64, 48))
            if not vw.isOpened():
                self.skipTest("VideoWriter desteklenmiyor")
            for i in range(4):
                vw.write(np.full((48, 64, 3), i * 50, np.uint8))
            vw.release()
            registry = SimpleNamespace(plate_detector=SimpleNamespace(ready=True),
                                       recognizer=SimpleNamespace(recognize=lambda *a, **k: []),
                                       unavailable_reason=lambda n: None)
            agent = GateAgent("giris-demo", path, gate="Entry", registry=registry, backend=None,
                              voter=PlateVoter(), target_fps=0)
            agent.start()
            try:
                end = time.time() + 5
                while time.time() < end and agent.loops < 3:
                    time.sleep(0.05)
                self.assertGreaterEqual(agent.loops, 3)        # en az 3 kez başa sardı
                self.assertEqual(agent.status, "Running")       # hata durumuna düşmedi
            finally:
                agent.stop()


if __name__ == "__main__":
    unittest.main()
