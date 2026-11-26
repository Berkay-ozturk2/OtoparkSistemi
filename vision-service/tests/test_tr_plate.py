"""TR plaka biçimi testleri (python -m pytest  veya  python -m unittest discover tests)."""
import unittest

from app.pipeline import tr_plate as tp


class NormalizeTests(unittest.TestCase):
    def test_strips_spaces_punctuation_and_case(self):
        self.assertEqual(tp.normalize(" 34 abc-123 "), "34ABC123")
        self.assertEqual(tp.normalize("06.AB.1234"), "06AB1234")

    def test_strips_tr_prefix(self):
        self.assertEqual(tp.normalize("TR 34 ABC 123"), "34ABC123")
        self.assertEqual(tp.normalize("tr34abc123"), "34ABC123")

    def test_turkish_characters(self):
        self.assertEqual(tp.normalize("34 şğü 12"), "34SGU12")
        self.assertEqual(tp.normalize("35 İÖÇ 123"), "35IOC123")

    def test_empty(self):
        self.assertEqual(tp.normalize(None), "")
        self.assertEqual(tp.normalize("  -  "), "")


class ValidityTests(unittest.TestCase):
    def test_valid_patterns(self):
        for p in ["34A1234", "34A12345", "06AB123", "06AB1234", "35ABC12", "35ABC123", "01A1234", "81ZZZ999"]:
            self.assertTrue(tp.is_valid(p), p)

    def test_invalid_city_codes(self):
        for p in ["00ABC123", "82ABC123", "99AB123"]:
            self.assertFalse(tp.is_valid(p), p)

    def test_invalid_group_lengths(self):
        for p in ["34A123", "34A123456", "34AB12", "34AB12345", "34ABC1", "34ABC1234", "34ABCD12", "34123"]:
            self.assertFalse(tp.is_valid(p), p)

    def test_forbidden_letters(self):
        for p in ["34Q1234", "34WX123", "34ABX12"]:
            self.assertFalse(tp.is_valid(p), p)

    def test_seed_driver_plate(self):
        self.assertTrue(tp.is_valid("06ABC123"))


class DisplayTests(unittest.TestCase):
    def test_format_display(self):
        self.assertEqual(tp.format_display("34ABC123"), "34 ABC 123")
        self.assertEqual(tp.format_display("06A12345"), "06 A 12345")
        self.assertEqual(tp.format_display("tr 06ab1234"), "06 AB 1234")

    def test_format_display_invalid_returns_normalized(self):
        self.assertEqual(tp.format_display("xx 12"), "XX12")


class CorrectionTests(unittest.TestCase):
    def test_already_valid_unchanged(self):
        r = tp.correct("34 ABC 123")
        self.assertTrue(r.valid)
        self.assertEqual(r.plate, "34ABC123")
        self.assertEqual(r.changes, 0)

    def test_letter_in_digit_region(self):
        # Rakam bölgesinde O->0, I->1, S->5, B->8, Z->2, G->6
        self.assertEqual(tp.correct("34ABC1O3").plate, "34ABC103")
        self.assertEqual(tp.correct("34ABCI23").plate, "34ABC123")
        self.assertEqual(tp.correct("O6AB1234").plate, "06AB1234")
        self.assertEqual(tp.correct("34ABC5B2").plate, "34ABC582")
        self.assertEqual(tp.correct("34ABCZG1").plate, "34ABC261")

    def test_digit_in_letter_region(self):
        # Harf bölgesinde 0->O, 1->I, 2->Z, 5->S, 8->B, 6->G
        self.assertEqual(tp.correct("3408C123").plate, "34OBC123")
        self.assertEqual(tp.correct("34A8C123").plate, "34ABC123")
        self.assertEqual(tp.correct("065T1234").plate, "06ST1234")

    def test_city_code_correction(self):
        self.assertEqual(tp.correct("S4ABC123").plate, "54ABC123")
        self.assertEqual(tp.correct("I6ABC123").plate, "16ABC123")

    def test_tr_prefix_and_noise(self):
        r = tp.correct("TR 34-ABC-123")
        self.assertEqual((r.plate, r.valid), ("34ABC123", True))
        # Baştaki gürültü karakteri (ör. bayrak bandından "I") atılır
        r = tp.correct("I34ABC123")
        self.assertTrue(r.valid)
        self.assertEqual(r.plate, "34ABC123")

    def test_unfixable_returns_raw(self):
        r = tp.correct("HELLO")
        self.assertFalse(r.valid)
        self.assertEqual(r.plate, "HELLO")
        r = tp.correct("")
        self.assertFalse(r.valid)

    def test_prefers_fewest_changes(self):
        # "34AB1234" zaten geçerli (2 harf + 4 rakam); 3 harf yorumu (34AB1 ->?) seçilmemeli
        self.assertEqual(tp.correct("34AB1234").plate, "34AB1234")

    def test_candidates_sorted(self):
        cands = tp.candidates("34ABC1O3")
        self.assertTrue(cands)
        self.assertEqual(cands[0][1], "34ABC103")
        costs = [c for c, _ in cands]
        self.assertEqual(costs, sorted(costs))

    def test_all_city_codes_valid(self):
        for code in tp.iter_all_city_codes():
            self.assertTrue(tp.is_valid(code + "AB123"), code)


class LevenshteinTests(unittest.TestCase):
    def test_distance(self):
        self.assertEqual(tp.levenshtein("34ABC123", "34ABC123"), 0)
        self.assertEqual(tp.levenshtein("34ABC123", "34ABC128"), 1)
        self.assertEqual(tp.levenshtein("34ABC123", "34AB123"), 1)
        self.assertEqual(tp.levenshtein("", "ABC"), 3)


if __name__ == "__main__":
    unittest.main()
