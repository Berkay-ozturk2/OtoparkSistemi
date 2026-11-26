"""Gerçek plaka modeli ile duman testi (model/çalıştırma ortamı yoksa atlanır).

ultralytics ya da onnxruntime kuruluysa models/plate_detector_tr.(pt|onnx) yüklenir ve
sentetik bir görüntüde hata vermeden çalıştığı doğrulanır. samples/test_plate.jpg varsa
o resimde en az bir plaka bulunması beklenir.
"""
import unittest

import numpy as np

from app.config import BASE_DIR
from app.pipeline.plate_detector import PlateDetector


def _runtime_available():
    for mod in ("ultralytics", "onnxruntime"):
        try:
            __import__(mod)
            return True
        except Exception:
            continue
    return False


MODEL = BASE_DIR / "models" / "plate_detector_tr.pt"


@unittest.skipUnless(_runtime_available() and (MODEL.exists() or MODEL.with_suffix(".onnx").exists()),
                     "ultralytics/onnxruntime ya da model dosyası yok")
class PlateModelSmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.det = PlateDetector(MODEL)
        cls.loaded = cls.det.load()

    def test_loads(self):
        self.assertTrue(self.loaded, self.det.error)

    def test_runs_on_blank_image(self):
        dets = self.det.detect(np.zeros((480, 640, 3), np.uint8), conf=0.4)
        self.assertIsInstance(dets, list)

    def test_sample_image(self):
        import cv2
        path = BASE_DIR / "samples" / "test_plate.jpg"
        if not path.exists():
            self.skipTest("samples/test_plate.jpg yok")
        img = cv2.imread(str(path))
        dets = self.det.detect(img, conf=0.4)
        self.assertGreaterEqual(len(dets), 1)


if __name__ == "__main__":
    unittest.main()
