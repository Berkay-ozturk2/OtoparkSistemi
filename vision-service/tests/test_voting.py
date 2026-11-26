"""Çok kareli oylama ve tekrar önleme testleri."""
import unittest

from app.agents.voting import PlateVoter, Reading


def R(text, t, valid=True, conf=0.8):
    return Reading(text=text, valid=valid, confidence=conf, timestamp=t, crop=None, raw_text=text)


class VotingTests(unittest.TestCase):
    def test_needs_min_reads(self):
        v = PlateVoter(window_seconds=1.5, min_reads=3)
        self.assertIsNone(v.add(R("34ABC123", 0.0)))
        self.assertIsNone(v.add(R("34ABC123", 0.2)))
        res = v.add(R("34ABC123", 0.4))
        self.assertIsNotNone(res)
        self.assertEqual(res.plate, "34ABC123")
        self.assertTrue(res.valid)
        self.assertEqual(res.votes, 3)

    def test_majority_wins_and_mean_confidence(self):
        v = PlateVoter(min_reads=3)
        v.add(R("34ABC123", 0.0, conf=0.9))
        v.add(R("34ABC128", 0.1, conf=0.95))
        res = v.add(R("34ABC123", 0.2, conf=0.7))
        self.assertEqual(res.plate, "34ABC123")
        self.assertAlmostEqual(res.confidence, 0.8, places=3)
        self.assertEqual((res.votes, res.total), (2, 3))

    def test_tie_broken_by_confidence(self):
        v = PlateVoter(min_reads=2)
        v.add(R("34ABC123", 0.0, conf=0.6))
        res = v.add(R("34ABC128", 0.1, conf=0.9))
        self.assertEqual(res.plate, "34ABC128")

    def test_valid_preferred_over_invalid(self):
        v = PlateVoter(min_reads=3)
        v.add(R("34ABC12X", 0.0, valid=False))
        v.add(R("34ABC12X", 0.1, valid=False))
        res = v.add(R("34ABC123", 0.2))
        self.assertEqual(res.plate, "34ABC123")
        self.assertTrue(res.valid)

    def test_window_expires_old_reads(self):
        v = PlateVoter(window_seconds=1.5, min_reads=3)
        v.add(R("34ABC123", 0.0))
        v.add(R("34ABC123", 0.5))
        self.assertIsNone(v.add(R("34ABC123", 2.5)))  # ilk ikisi pencere dışında
        self.assertEqual(v.pending, 1)

    def test_cooldown_blocks_repeat(self):
        v = PlateVoter(min_reads=1, cooldown_seconds=30)
        self.assertIsNotNone(v.add(R("34ABC123", 0.0)))
        self.assertIsNone(v.add(R("34ABC123", 5.0)))
        self.assertIsNone(v.add(R("34ABC128", 6.0)))   # 1 karakter farklı okuma da engellenir
        self.assertIsNotNone(v.add(R("06AB123", 7.0)))   # başka araç hemen geçebilir
        self.assertIsNotNone(v.add(R("34ABC123", 31.0)))  # süre doldu

    def test_invalid_requires_agreement_and_is_rate_limited(self):
        v = PlateVoter(min_reads=3, invalid_cooldown_seconds=15, cooldown_seconds=30)
        v.add(R("ABCD", 0.0, valid=False))
        v.add(R("EFGH", 0.1, valid=False))
        self.assertIsNone(v.add(R("IJKL", 0.2, valid=False)))  # hepsi farklı — gönderme
        v.reset()
        v.add(R("34ABX12", 1.0, valid=False))
        v.add(R("34ABX12", 1.1, valid=False))
        res = v.add(R("ZZZZ", 1.2, valid=False))
        self.assertIsNotNone(res)
        self.assertFalse(res.valid)
        self.assertEqual(res.plate, "34ABX12")
        v.add(R("99QQQ1", 2.0, valid=False))
        v.add(R("99QQQ1", 2.1, valid=False))
        self.assertIsNone(v.add(R("99QQQ1", 2.2, valid=False)))  # geçersiz gönderim seyreltilir

    def test_send_invalid_disabled(self):
        v = PlateVoter(min_reads=2, send_invalid=False)
        v.add(R("XXXX1", 0.0, valid=False))
        self.assertIsNone(v.add(R("XXXX1", 0.1, valid=False)))

    def test_short_text_ignored(self):
        v = PlateVoter(min_reads=1)
        self.assertIsNone(v.add(R("34", 0.0, valid=False)))

    def test_best_crop_selected(self):
        v = PlateVoter(min_reads=2)
        v.add(Reading("34ABC123", True, 0.5, 0.0, crop="dusuk"))
        res = v.add(Reading("34ABC123", True, 0.9, 0.1, crop="yuksek"))
        self.assertEqual(res.crop, "yuksek")


if __name__ == "__main__":
    unittest.main()
