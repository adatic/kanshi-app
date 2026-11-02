"""scripts/golden_text.py の単体テスト（照合の規則の境界）。`npm test` で走る。"""

import unittest

from golden_text import MIN_SCORE, choose, diffs, lines_of, score, windows

A = "甲乙丙丁戊己庚" * 4  # 28字


def cand(author: str, sc: int, text: str = A, **kw) -> dict:
    return {"author": author, "score": sc, "text": text, "file": "f", "index": 0, **kw}


class LinesOfTest(unittest.TestCase):
    def test_strips_punctuation_and_inline_notes(self):
        self.assertEqual(lines_of(["故人西辭黃鶴樓，煙花三月下揚州。", "孤帆遠影碧空盡，唯見長江天際流。 (唯 通：惟)"]),
                         ["故人西辭黃鶴樓", "煙花三月下揚州", "孤帆遠影碧空盡", "唯見長江天際流"])

    def test_strips_a_note_that_spans_paragraphs(self):
        self.assertEqual(lines_of(["回樂烽前沙似雪，受降城外月如霜。(回樂", "一作：回樂", "）", "不知何處吹蘆管，一夜徵人盡望鄉。"]),
                         ["回樂烽前沙似雪", "受降城外月如霜", "不知何處吹蘆管", "一夜徵人盡望鄉"])


class WindowsTest(unittest.TestCase):
    def test_only_four_consecutive_seven_char_lines(self):
        lines = ["一二三四五六七", "一二三四五六七", "一二三四五", "一二三四五六七", "一二三四五六七", "一二三四五六七", "一二三四五六七"]
        self.assertEqual([i for i, _ in windows(lines)], [3])


class ChooseTest(unittest.TestCase):
    def test_picks_the_best_candidate_by_the_same_author(self):
        best, reasons, dups = choose(A, "李白", [cand("杜甫", 28), cand("李白", 26, A[:-1] + "X"), cand("李白", 25, A[:-2] + "XY")])
        self.assertEqual((best["score"], reasons, dups), (26, [], []))

    def test_no_candidate_by_the_same_author(self):
        best, reasons, _ = choose(A, "王維", [cand("王涯", 28)])
        self.assertIsNone(best)
        self.assertEqual(reasons, ["作者が一致する候補がない"])

    def test_anonymous_names_are_the_same_author(self):
        best, _, _ = choose(A, "佚名", [cand("無名氏", 28)])
        self.assertIsNotNone(best)

    def test_below_the_threshold_is_not_chosen(self):
        best, reasons, _ = choose(A, "李白", [cand("李白", MIN_SCORE - 1)])
        self.assertIsNone(best)
        self.assertIn(f"基準の{MIN_SCORE}字", reasons[0])

    def test_threshold_itself_is_chosen(self):
        best, _, _ = choose(A, "李白", [cand("李白", MIN_SCORE)])
        self.assertIsNotNone(best)

    def test_tie_with_different_texts_is_not_chosen(self):
        best, reasons, _ = choose(A, "李白", [cand("李白", 27, A[:-1] + "X"), cand("李白", 27, "X" + A[1:])])
        self.assertIsNone(best)
        self.assertIn("本文の違う候補が2件", reasons[0])

    def test_tie_with_identical_texts_takes_the_first_as_a_duplicate(self):
        first = cand("李白", 28, file="a")
        second = cand("李白", 28, file="b")
        best, reasons, dups = choose(A, "李白", [first, second])
        self.assertEqual((best["file"], reasons, [d["file"] for d in dups]), ("a", [], ["b"]))


class ScoreAndDiffsTest(unittest.TestCase):
    def test_position_wise(self):
        self.assertEqual(score("甲乙丙", "甲丁丙"), 2)
        self.assertEqual(diffs("甲乙丙", "甲丁丙"), [[2, "乙", "丁"]])


if __name__ == "__main__":
    unittest.main()
