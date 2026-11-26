"""OCR yardımcıları: karakter birleştirme, satır gruplama, aday seçimi, ön işleme; YOLO çözümleme."""
import tempfile
import unittest
from pathlib import Path

import numpy as np

from app.pipeline.ocr import (DEFAULT_CHAR_CLASSES, assemble_characters, choose_best, group_lines,
                              load_char_classes, preprocess_variants)
from app.pipeline.yolo_backend import decode_yolov8_output, letterbox, nms

C = DEFAULT_CHAR_CLASSES


def char_det(ch, x, y, w=10, h=20, conf=0.9, classes=C):
    return [x, y, x + w, y + h, conf, classes.index(ch)]


class AssembleTests(unittest.TestCase):
    def test_single_line_sorted_by_x(self):
        text = "34ABC123"
        dets = [char_det(ch, 12 * i, 5) for i, ch in enumerate(text)]
        dets = np.array(dets[::-1], dtype=np.float32)  # ters sırada ver
        out, conf = assemble_characters(dets, C)
        self.assertEqual(out, text)
        self.assertAlmostEqual(conf, 0.9, places=4)

    def test_two_line_plate(self):
        # Kare plaka: üst satır "34AB", alt satır "1234"
        top = [char_det(ch, 5 + 12 * i, 2) for i, ch in enumerate("34AB")]
        bottom = [char_det(ch, 5 + 12 * i, 30) for i, ch in enumerate("1234")]
        dets = np.array(bottom + top, dtype=np.float32)
        out, _ = assemble_characters(dets, C)
        self.assertEqual(out, "34AB1234")

    def test_slightly_tilted_line_stays_single(self):
        text = "06AB1234"
        dets = np.array([char_det(ch, 12 * i, 5 + i * 1.5) for i, ch in enumerate(text)], dtype=np.float32)
        out, _ = assemble_characters(dets, C)
        self.assertEqual(out, text)

    def test_low_conf_and_duplicates_removed(self):
        dets = [char_det("3", 0, 0), char_det("4", 12, 0), char_det("A", 12, 0, conf=0.5),  # kopya
                char_det("Z", 24, 0, conf=0.1)]  # düşük güven
        out, _ = assemble_characters(np.array(dets, dtype=np.float32), C, min_conf=0.25)
        self.assertEqual(out, "34")

    def test_empty(self):
        self.assertEqual(assemble_characters(np.zeros((0, 6)), C), ("", 0.0))

    def test_group_lines_empty(self):
        self.assertEqual(group_lines([]), [])


class ClassesTests(unittest.TestCase):
    def test_file_priority(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "char_classes.txt"
            p.write_text("# yorum\nA\nB\n0\n", encoding="utf-8")
            self.assertEqual(load_char_classes(p, {0: "x"}), ["A", "B", "0"])

    def test_model_names_then_default(self):
        self.assertEqual(load_char_classes(None, {1: "b", 0: "a"}), ["A", "B"])
        self.assertEqual(load_char_classes(None, {0: "plate"}), C)
        self.assertEqual(load_char_classes(Path("/yok/dosya.txt"), None), C)


class ChooseBestTests(unittest.TestCase):
    def test_valid_beats_higher_conf_invalid(self):
        r = choose_best([("34ABCXYZ", 0.99, "gray"), ("34ABC123", 0.7, "clahe")], "easyocr")
        self.assertEqual((r.text, r.valid, r.variant), ("34ABC123", True, "clahe"))

    def test_correction_lowers_confidence(self):
        r = choose_best([("34ABCI23", 0.8, "gray")], "easyocr")
        self.assertEqual(r.text, "34ABC123")
        self.assertLess(r.confidence, 0.8)

    def test_no_candidates(self):
        r = choose_best([], "easyocr")
        self.assertEqual((r.text, r.valid, r.confidence), ("", False, 0.0))


class PreprocessTests(unittest.TestCase):
    def test_variants(self):
        crop = (np.random.default_rng(0).random((30, 120, 3)) * 255).astype(np.uint8)
        out = dict(preprocess_variants(crop, ("color", "gray", "clahe", "adaptive", "otsu"), target_height=96))
        self.assertEqual(set(out), {"color", "gray", "clahe", "adaptive", "otsu"})
        self.assertEqual(out["color"].shape, (96, 384, 3))
        for k in ("gray", "clahe", "adaptive", "otsu"):
            self.assertEqual(out[k].shape, (96, 384))
        self.assertTrue(set(np.unique(out["otsu"])).issubset({0, 255}))

    def test_empty_crop(self):
        self.assertEqual(preprocess_variants(np.zeros((0, 0, 3), np.uint8)), [])


class YoloUtilsTests(unittest.TestCase):
    def test_letterbox(self):
        img = np.zeros((360, 640, 3), np.uint8)
        out, r, (left, top) = letterbox(img, 640)
        self.assertEqual(out.shape, (640, 640, 3))
        self.assertAlmostEqual(r, 1.0)
        self.assertEqual((left, top), (0, 140))

    def test_nms(self):
        boxes = np.array([[0, 0, 10, 10], [1, 1, 11, 11], [50, 50, 60, 60]], dtype=np.float32)
        keep = nms(boxes, np.array([0.9, 0.8, 0.7]), 0.5)
        self.assertEqual(list(keep), [0, 2])

    def test_decode_output(self):
        # 1 sınıf, 3 aday (cx, cy, w, h, skor); letterbox: ölçek 0.5, üst pay 10
        pred = np.array([
            [100, 100, 40, 20, 0.9],
            [102, 101, 40, 20, 0.8],   # ilkinin kopyası -> NMS ile elenir
            [300, 300, 20, 20, 0.1],   # eşik altı
        ], dtype=np.float32).T[None]   # [1, 5, 3]
        dets = decode_yolov8_output(pred, 0.25, 0.45, scale=0.5, pad=(0, 10), orig_shape=(1000, 1000))
        self.assertEqual(dets.shape, (1, 6))
        np.testing.assert_allclose(dets[0, :4], [160, 160, 240, 200], atol=1e-3)
        self.assertAlmostEqual(float(dets[0, 4]), 0.9, places=5)

    def test_decode_class_filter(self):
        pred = np.array([[10, 10, 4, 4, 0.1, 0.9], [50, 50, 4, 4, 0.8, 0.1]], dtype=np.float32).T[None]
        dets = decode_yolov8_output(pred, 0.25, 0.45, 1.0, (0, 0), (100, 100), classes=[0])
        self.assertEqual(dets.shape[0], 1)
        self.assertEqual(int(dets[0, 5]), 0)


if __name__ == "__main__":
    unittest.main()


class FakeEasyReader:
    """easyocr.Reader.readtext taklidi: (köşe noktaları, metin, güven) listesi döndürür."""

    def __init__(self, result):
        self.result = result

    def readtext(self, img, **kw):
        return self.result


def quad(x1, y1, x2, y2):
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]


class EasyOcrJoinTests(unittest.TestCase):
    def make(self, result):
        from app.pipeline.ocr import EasyOcrEngine
        eng = EasyOcrEngine(variants=("gray",))
        eng._reader = FakeEasyReader(result)
        return eng

    def test_tr_band_and_split_groups_joined(self):
        eng = self.make([(quad(0, 10, 15, 40), "TR", 0.9), (quad(20, 10, 60, 40), "34", 0.95),
                         (quad(65, 10, 120, 40), "ABC", 0.9), (quad(125, 10, 180, 40), "123", 0.85)])
        crop = np.full((40, 180, 3), 255, np.uint8)
        r = eng.read(crop)
        self.assertEqual((r.text, r.valid, r.engine), ("34ABC123", True, "easyocr"))
        self.assertGreater(r.confidence, 0.8)

    def test_two_line_plate(self):
        eng = self.make([(quad(10, 50, 90, 90), "1234", 0.9), (quad(10, 5, 90, 45), "34 AB", 0.9)])
        r = eng.read(np.full((96, 100, 3), 255, np.uint8))
        self.assertEqual(r.text, "34AB1234")

    def test_correction_applied(self):
        eng = self.make([(quad(0, 0, 100, 30), "34 A8C 1O3", 0.8)])
        r = eng.read(np.full((30, 100, 3), 255, np.uint8))
        self.assertEqual((r.text, r.valid), ("34ABC103", True))
        self.assertEqual(r.raw, "34A8C1O3")

    def test_not_ready_returns_empty(self):
        from app.pipeline.ocr import EasyOcrEngine, NullOcr
        self.assertEqual(EasyOcrEngine().read(np.zeros((10, 10, 3), np.uint8)).text, "")
        self.assertEqual(NullOcr().read(np.zeros((10, 10, 3), np.uint8)).engine, "none")
