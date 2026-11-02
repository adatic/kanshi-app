"""scripts/build_phrases.py の単体テスト（詩語の数え方の境界）。`npm test` で走る。

平仄・韻目は架空の小さなデータで与え、実在の字の平仄を記憶で使わない（CLAUDE.md §0）。
"""

import unittest

from build_phrases import MAX_EXAMPLES, count_phrases, last_rhymes, patterns, reading_lookup

LINE = "甲乙丙丁戊己庚"  # 7字


class CountPhrasesTest(unittest.TestCase):
    def test_slots_of_a_seven_char_line(self):
        counted = count_phrases([("作者", "題", [LINE + "，" + LINE + "。"])])
        # 2回出てくる語だけが残る。2字語は 1-2・3-4・5-6・6-7、3字語は 5-7
        self.assertEqual(sorted(counted), sorted(["甲乙", "丙丁", "戊己", "己庚", "戊己庚"]))
        self.assertEqual(counted["己庚"]["at"], {"6-7": 2})
        self.assertEqual(counted["戊己庚"]["at"], {"5-7": 2})

    def test_words_seen_once_are_dropped(self):
        counted = count_phrases([("作者", "題", [LINE + "。"])])
        self.assertEqual(counted, {})

    def test_lines_other_than_seven_chars_are_ignored(self):
        counted = count_phrases([("作者", "題", ["甲乙丙丁戊，甲乙丙丁戊。"])])
        self.assertEqual(counted, {})

    def test_count_and_positions(self):
        # 甲乙 は1-2字目に2回、3-4字目に1回
        counted = count_phrases([("作者", "題", ["甲乙丙丁戊己庚，甲乙辛壬癸子丑，寅卯甲乙辰巳午。"])])
        self.assertEqual(counted["甲乙"]["n"], 3)
        self.assertEqual(counted["甲乙"]["at"], {"1-2": 2, "3-4": 1})

    def test_examples_are_the_first_distinct_lines_in_corpus_order(self):
        poems = [("甲", "一", [LINE + "，" + LINE + "。"])] + [(f"作者{i}", f"題{i}", [f"甲乙{c}丑寅卯辰。"]) for i, c in enumerate("子丑寅卯")]
        counted = count_phrases(poems)
        ex = counted["甲乙"]["e"]
        self.assertEqual(len(ex), MAX_EXAMPLES)
        self.assertEqual(ex[0], ["甲", "一", LINE])  # 同じ句は重ねない
        self.assertEqual([e[0] for e in ex[1:]], ["作者0", "作者1"])

    def test_inline_notes_are_removed_before_counting(self):
        counted = count_phrases([("作者", "題", [LINE + "(一作：子丑)，", LINE + "。"])])
        self.assertIn("甲乙", counted)


DATA = {
    "平": [{"tone": "平", "rhyme": "上平一東"}],
    "仄": [{"tone": "去", "rhyme": "去声一送"}],
    "兩": [{"tone": "平", "rhyme": "下平一先"}, {"tone": "上", "rhyme": "上声一董"}],
}
ORDER = {"上平一東": 0, "下平一先": 1, "上声一董": 2, "去声一送": 3}


class PatternTest(unittest.TestCase):
    def setUp(self):
        self.readings = reading_lookup(DATA, {"變": ["仄"], "多": ["平", "仄"]})

    def test_single_readings(self):
        self.assertEqual(patterns("平仄", self.readings), ["平仄"])

    def test_every_possible_pattern_for_a_char_with_both_tones(self):
        self.assertEqual(patterns("兩平", self.readings), ["仄平", "平平"])

    def test_unknown_char_is_a_question_mark(self):
        self.assertEqual(patterns("平無", self.readings), ["平？"])

    def test_variant_candidates_are_used_like_the_engine(self):
        self.assertEqual(patterns("變", self.readings), ["仄"])
        self.assertEqual(patterns("多", self.readings), ["仄", "平"])

    def test_last_rhymes_are_all_readings_in_rhyme_order(self):
        self.assertEqual(last_rhymes("平兩", self.readings, ORDER), ["下平一先", "上声一董"])
        self.assertEqual(last_rhymes("平無", self.readings, ORDER), [])


if __name__ == "__main__":
    unittest.main()
