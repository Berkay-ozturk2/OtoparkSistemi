"""Cep doluluk (poligon kesişimi) ve yumuşatma testleri."""
import json
import unittest

from app.config import BASE_DIR
from app.pipeline.occupancy import (Slot, SlotLayout, SlotObservation, SlotSmoother, compute_slot_ratios,
                                    evaluate_slots, footprint, iou, load_layout)


def square_layout():
    return SlotLayout(200, 100, [
        Slot("A01", [(0, 0), (100, 0), (100, 100), (0, 100)]),
        Slot("A02", [(100, 0), (200, 0), (200, 100), (100, 100)]),
    ])


class IouTests(unittest.TestCase):
    def test_identical(self):
        self.assertAlmostEqual(iou([0, 0, 10, 10], [0, 0, 10, 10]), 1.0)

    def test_disjoint(self):
        self.assertEqual(iou([0, 0, 10, 10], [20, 20, 30, 30]), 0.0)

    def test_half_overlap(self):
        # kesişim 50, birleşim 150
        self.assertAlmostEqual(iou([0, 0, 10, 10], [5, 0, 15, 10]), 50 / 150)

    def test_degenerate(self):
        self.assertEqual(iou([0, 0, 0, 0], [0, 0, 0, 0]), 0.0)


class RatioTests(unittest.TestCase):
    def test_full_cover(self):
        r = compute_slot_ratios(square_layout(), [[0, 0, 100, 100]])
        self.assertAlmostEqual(r["A01"][0], 1.0, places=2)
        self.assertAlmostEqual(r["A02"][0], 0.0, places=2)
        self.assertEqual(r["A01"][1], 0)
        self.assertEqual(r["A02"][1], -1)

    def test_partial_cover(self):
        r = compute_slot_ratios(square_layout(), [[50, 0, 150, 100]])
        self.assertAlmostEqual(r["A01"][0], 0.5, delta=0.02)
        self.assertAlmostEqual(r["A02"][0], 0.5, delta=0.02)

    def test_overlapping_boxes_not_double_counted(self):
        r = compute_slot_ratios(square_layout(), [[0, 0, 60, 100], [40, 0, 100, 100]])
        self.assertAlmostEqual(r["A01"][0], 1.0, delta=0.02)

    def test_triangle_polygon_mask(self):
        layout = SlotLayout(100, 100, [Slot("T1", [(0, 0), (100, 0), (0, 100)])])
        # Üçgenin dışındaki sağ-alt kare: kesişim ~0
        r = compute_slot_ratios(layout, [[60, 60, 100, 100]])
        self.assertLess(r["T1"][0], 0.02)
        # Sol-üst kare üçgenin içinde: 40x40 / 5000
        r = compute_slot_ratios(layout, [[0, 0, 40, 40]])
        self.assertAlmostEqual(r["T1"][0], 1600 / 5000, delta=0.03)

    def test_box_outside_image(self):
        r = compute_slot_ratios(square_layout(), [[-50, -50, 10, 10]])
        self.assertAlmostEqual(r["A01"][0], 0.01, delta=0.01)

    def test_footprint(self):
        self.assertEqual(footprint([0, 0, 10, 100], 0.5), (0, 50.0, 10, 100))
        r = compute_slot_ratios(square_layout(), [[0, 0, 100, 100]], footprint_fraction=0.3)
        self.assertAlmostEqual(r["A01"][0], 0.3, delta=0.02)


class EvaluateTests(unittest.TestCase):
    def test_threshold(self):
        obs = {o.code: o for o in evaluate_slots(square_layout(), [[0, 0, 100, 100], [100, 0, 120, 100]], [0.9, 0.8], 0.35)}
        self.assertTrue(obs["A01"].occupied)
        self.assertFalse(obs["A02"].occupied)  # yalnızca %20 kaplı
        self.assertGreater(obs["A01"].confidence, 0.8)
        self.assertGreaterEqual(obs["A02"].confidence, 0.5)
        for o in obs.values():
            self.assertTrue(0 <= o.confidence <= 1)

    def test_empty_frame(self):
        obs = evaluate_slots(square_layout(), [], [], 0.35)
        self.assertTrue(all(not o.occupied for o in obs))
        self.assertTrue(all(o.confidence == 1.0 for o in obs))

    def test_scaled_layout(self):
        layout = square_layout().scaled(400, 200)
        self.assertEqual(layout.slots[1].polygon[1], (400.0, 0.0))
        obs = {o.code: o for o in evaluate_slots(layout, [[0, 0, 200, 200]], [0.9])}
        self.assertTrue(obs["A01"].occupied)


class SmootherTests(unittest.TestCase):
    def obs(self, occ):
        return [SlotObservation("A01", 0.5 if occ else 0.0, occ, 0.9)]

    def test_first_observation_reported(self):
        sm = SlotSmoother(5)
        ch = sm.update(self.obs(False))
        self.assertEqual(len(ch), 1)
        self.assertFalse(ch[0].occupied)

    def test_single_flicker_ignored(self):
        sm = SlotSmoother(5)
        sm.update(self.obs(False))
        for _ in range(3):
            self.assertEqual(sm.update(self.obs(False)), [])
        self.assertEqual(sm.update(self.obs(True)), [])   # 1/5 dolu — titreme
        self.assertFalse(sm.state["A01"])

    def test_majority_switches(self):
        sm = SlotSmoother(5)
        for _ in range(5):
            sm.update(self.obs(False))
        changes = []
        for _ in range(3):
            changes += sm.update(self.obs(True))
        self.assertEqual(len(changes), 1)
        self.assertTrue(changes[0].occupied)
        self.assertTrue(sm.state["A01"])
        self.assertLessEqual(changes[0].confidence, 0.9)

    def test_snapshot(self):
        sm = SlotSmoother(3)
        sm.update([SlotObservation("A01", 1, True, 0.9), SlotObservation("A02", 0, False, 1.0)])
        snap = {o.code: o.occupied for o in sm.snapshot()}
        self.assertEqual(snap, {"A01": True, "A02": False})


class SlotsFileTests(unittest.TestCase):
    """config/slots.json sözleşme bölüm 10 ile uyumlu mu?"""

    def test_slots_json(self):
        layout = load_layout(BASE_DIR / "config" / "slots.json")
        codes = [s.code for s in layout.slots]
        expected = [f"A{i:02d}" for i in range(1, 11)] + [f"B{i:02d}" for i in range(1, 11)] + [f"C{i:02d}" for i in range(1, 9)]
        self.assertEqual(codes, expected)
        self.assertEqual((layout.image_width, layout.image_height), (1280, 720))
        for s in layout.slots:
            for x, y in s.polygon:
                self.assertTrue(0 <= x <= 1280 and 0 <= y <= 720)
        # Cepler örtüşmemeli
        r = compute_slot_ratios(layout, [])
        self.assertEqual(len(r), 28)

    def test_round_trip(self):
        layout = load_layout(BASE_DIR / "config" / "slots.json")
        again = SlotLayout.from_dict(json.loads(json.dumps(layout.to_dict())))
        self.assertEqual([s.code for s in again.slots], [s.code for s in layout.slots])


if __name__ == "__main__":
    unittest.main()
