"""Kamera paylaşımı, fotoğraf kaynağı ve giriş/çıkış geçişi testleri (gerçek kamera gerekmez)."""
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import cv2
import numpy as np

from app.agents import shared_camera
from app.agents.gate_agent import GateAgent
from app.agents.manager import AgentManager
from app.agents.occupancy_agent import OccupancyAgent
from app.agents.shared_camera import SharedWebcam, SharedWebcamReader, StillImageCapture
from app.agents.voting import PlateVoter


class FakeCap:
    """Her read'de artan değerli küçük kare döndüren sahte webcam."""
    opened = 0

    def __init__(self):
        FakeCap.opened += 1
        self.n = 0
        self.released = False

    def read(self):
        time.sleep(0.01)
        self.n += 1
        return True, np.full((24, 32, 3), self.n % 255, np.uint8)

    def release(self):
        self.released = True


def wait_for(cond, timeout=3.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


class SharedWebcamTests(unittest.TestCase):
    def setUp(self):
        FakeCap.opened = 0
        self.patch = mock.patch.object(shared_camera, "open_webcam", lambda *a, **k: FakeCap())
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        SharedWebcam._registry.clear()

    def test_two_readers_share_one_camera(self):
        r1, r2 = SharedWebcamReader(7), SharedWebcamReader(7)
        ok1, f1 = r1.read()
        ok2, f2 = r2.read()
        self.assertTrue(ok1 and ok2)
        self.assertEqual(f1.shape, (24, 32, 3))
        self.assertEqual(FakeCap.opened, 1)              # kamera yalnızca BİR kez açıldı
        self.assertIs(r1.cam, r2.cam)
        r1.release()
        self.assertIn(7, SharedWebcam._registry)          # bir okuyucu hâlâ kullanıyor
        r2.release()
        self.assertNotIn(7, SharedWebcam._registry)       # son okuyucu bırakınca kapandı

    def test_error_when_camera_missing(self):
        with mock.patch.object(shared_camera, "open_webcam", lambda *a, **k: None):
            r = SharedWebcamReader(9, first_frame_timeout=0.5)
            ok, frame = r.read()
            self.assertFalse(ok)
            self.assertTrue(wait_for(lambda: r.error is not None))
            self.assertIn("Webcam 9", r.error)
            r.release()


class StillImageTests(unittest.TestCase):
    def test_still_image_repeats_frame(self):
        with tempfile.TemporaryDirectory() as d:
            p = str(Path(d) / "otopark.jpg")
            cv2.imwrite(p, np.full((40, 60, 3), 128, np.uint8))
            cap = StillImageCapture(p)
            self.assertTrue(cap.isOpened())
            for _ in range(3):
                ok, frame = cap.read()
                self.assertTrue(ok)
                self.assertEqual(frame.shape, (40, 60, 3))


class GateSwitchTests(unittest.TestCase):
    def test_starting_exit_stops_entry_on_same_webcam(self):
        mgr = AgentManager.__new__(AgentManager)  # ayar/yükleme olmadan
        mgr.agents = {}
        registry = SimpleNamespace(plate_detector=SimpleNamespace(ready=False), unavailable_reason=lambda n: "x")
        entry = GateAgent("giris-1", "0", gate="Entry", registry=registry, backend=None, voter=PlateVoter())
        exit_ = GateAgent("cikis-1", "0", gate="Exit", registry=registry, backend=None, voter=PlateVoter())
        other = GateAgent("cikis-2", "1", gate="Exit", registry=registry, backend=None, voter=PlateVoter())
        for a in (entry, exit_, other):
            mgr.agents[a.id] = a
            a.start = mock.MagicMock()
            a.stop = mock.MagicMock()
        entry._thread = SimpleNamespace(is_alive=lambda: True)   # giriş çalışıyor gibi
        other._thread = SimpleNamespace(is_alive=lambda: True)
        mgr.start("cikis-1")
        entry.stop.assert_called_once()        # aynı webcam -> giriş durduruldu
        other.stop.assert_not_called()         # farklı webcam -> dokunulmadı
        exit_.start.assert_called_once()


if __name__ == "__main__":
    unittest.main()
