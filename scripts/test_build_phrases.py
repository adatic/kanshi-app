"""scripts/build_phrases.py の単体テスト（詩語の数え方の境界）。`npm test` で走る。

平仄・韻目は架空の小さなデータで与え、実在の字の平仄を記憶で使わない（CLAUDE.md §0）。
"""

import json
import unittest

from build_phrases import EXCLUDE, MAX_EXAMPLES, count_phrases, search_files, last_rhymes, load_corpus, load_exclusions, patterns, phrase_lines, reading_lookup
from fetch_corpus import corpus_files

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


class PhraseLinesTest(unittest.TestCase):
    """詩語に使う句の取り出し（Codex レビュー m4-phrases 往復1 R1）。"""

    def test_lines_with_a_described_character_are_dropped(self):
        # 外字を部品で書き表した「{炙火=肉}」の中の字を、独立した字として数えない（韓愈「縣齋有懷」の句）
        self.assertEqual(phrase_lines(["絲竹羅酒{炙火=肉}，甲乙丙丁戊己庚。"]), ["甲乙丙丁戊己庚"])

    def test_lines_with_missing_or_note_marks_are_dropped(self):
        self.assertEqual(phrase_lines(["甲乙丙□戊己庚，甲乙丙丁[一]戊己，子丑寅卯辰巳午。"]), ["子丑寅卯辰巳午"])

    def test_quotation_marks_are_removed_but_the_line_is_kept(self):
        self.assertEqual(phrase_lines(["城邊問官使：「早晚發西京？"]), ["城邊問官使", "早晚發西京"])

    def test_inline_notes_in_parentheses_are_removed(self):
        self.assertEqual(phrase_lines(["甲乙丙丁戊己庚（一作：子丑）。"]), ["甲乙丙丁戊己庚"])

    def test_described_character_does_not_become_a_phrase(self):
        counted = count_phrases([("韓愈", "縣齋有懷", ["絲竹羅酒{炙火=肉}。"]), ("裴諴", "南歌子詞", ["爭知{炙火=肉}裏心。"])])
        self.assertNotIn("炙火", counted)


class ExclusionTest(unittest.TestCase):
    def test_every_excluded_record_matches_its_author_and_title(self):
        # 除外の一覧の番号がずれていたら、作者・題が一致せず止まる
        excluded = load_exclusions()
        self.assertEqual(len(excluded), 4)

    def test_load_corpus_skips_exactly_the_excluded_records(self):
        # 実際の全集（.cache/）を load_corpus に通し、除外した4件だけが外れることを確かめる
        records = json.loads(EXCLUDE.read_text(encoding="utf-8"))["records"]
        excluded = {(r["author"], r["title"]) for r in records}
        total = sum(len(json.loads(cache.read_text(encoding="utf-8"))) for _, cache in corpus_files()[1])
        loaded = [(a, t) for a, t, _ in load_corpus()]
        self.assertEqual(len(loaded), total - len(records))
        self.assertEqual([x for x in loaded if x in excluded], [])
        # 同じファイルの、除外していない直前のレコードは残る
        caches = dict(corpus_files()[1])
        skipped = {(r["file"], r["index"]) for r in records}
        for r in records:
            i = r["index"] - 1
            while (r["file"], i) in skipped:
                i -= 1
            neighbor = json.loads(caches[r["file"]].read_text(encoding="utf-8"))[i]
            self.assertIn((neighbor["author"], neighbor["title"]), loaded)


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


class SearchFilesTest(unittest.TestCase):
    """平仄パターンで探すための索引（字数×パターンごとのファイル）。"""

    def entry(self, w, n, p, r, at):
        return {"w": w, "n": n, "at": at, "p": p, "r": r, "e": [["作者", "題", "句"]]}

    def test_files_by_length_and_pattern(self):
        by_first = {
            "甲": {"2": [self.entry("甲乙", 5, ["平仄"], ["韻B"], {"1-2": 5})], "3": [self.entry("甲乙丙", 2, ["平？平"], ["韻A"], {"5-7": 2})]},
            "丁": {"2": [self.entry("丁戊", 3, ["仄仄"], [], {"3-4": 1, "6-7": 2})], "3": []},
        }
        files = search_files(by_first, {"韻A": 0, "韻B": 1})
        self.assertEqual(sorted(files), ["2-hz", "2-zz", "3-hqh"])  # 平→h 仄→z データにない字→q
        # 語、出現回数、末字の韻目（rhymes.json の並びの番号）、位置ごとの出現回数（1-2・3-4・5-6・6-7・5-7 の順）。用例は持たない
        self.assertEqual(files["2-hz"], [["甲乙", 5, [1], [5, 0, 0, 0, 0]]])
        self.assertEqual(files["2-zz"], [["丁戊", 3, [], [0, 1, 0, 2, 0]]])
        self.assertEqual(files["3-hqh"], [["甲乙丙", 2, [0], [0, 0, 0, 0, 2]]])

    def test_a_phrase_with_several_patterns_is_in_each_file(self):
        by_first = {"甲": {"2": [self.entry("甲乙", 2, ["平仄", "仄仄"], [], {"1-2": 2})], "3": []}}
        files = search_files(by_first, {})
        self.assertEqual(sorted(files), ["2-hz", "2-zz"])

    def test_entries_are_sorted_by_count_then_word(self):
        by_first = {
            "甲": {"2": [self.entry("甲乙", 2, ["平平"], [], {}), self.entry("甲丙", 9, ["平平"], [], {})], "3": []},
            "丁": {"2": [self.entry("丁戊", 2, ["平平"], [], {})], "3": []},
        }
        self.assertEqual([e[0] for e in search_files(by_first, {})["2-hh"]], ["甲丙", "丁戊", "甲乙"])
