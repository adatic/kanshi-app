"""scripts/build_data.py の単体テスト。`npm test`（npm run data:unit）で走る。

入力は架空の小さな表で、生成ロジックの境界だけを確かめる。
平仄・韻目の正誤は扱わない（読みは形を満たすだけの仮の値）。
"""

import unittest

from build_data import BuildError, apply_corrections, build_chars, build_variants, parse_kokuji, parse_wikisource

R = {"tone": "平", "rhyme": "上平一東"}  # 仮の読み


class BuildVariantsTest(unittest.TestCase):
    def run_variants(self, chars, jp=None, st=None):
        return build_variants({c: [R] for c in chars}, jp or {}, st or {})

    def test_one_to_many_with_one_known_candidate_is_reported(self):
        # 甲 → 乙 丙 のうち、データにあるのは丙だけ
        variants, ambiguous, unmapped = self.run_variants(["丙"], jp={"甲": ["乙", "丙"]})
        self.assertEqual(variants, {"甲": ["丙"]})
        self.assertEqual(len(ambiguous), 1)
        self.assertTrue(ambiguous[0].startswith("甲\t1/2\t"))
        self.assertIn("乙（新字体→旧字体: 平仄データにない）", ambiguous[0])
        self.assertEqual(unmapped, [])

    def test_one_to_many_with_all_known_keeps_every_candidate(self):
        variants, ambiguous, _ = self.run_variants(["乙", "丙"], st={"甲": ["乙", "丙"]})
        self.assertEqual(variants, {"甲": ["乙", "丙"]})
        self.assertTrue(ambiguous[0].startswith("甲\t2/2\t"))

    def test_key_itself_counts_as_a_candidate_when_known(self):
        # 甲 自身がデータにあり、さらに 乙 にも対応する
        variants, ambiguous, _ = self.run_variants(["甲", "乙"], jp={"甲": ["乙"]})
        self.assertEqual(variants, {"甲": ["甲", "乙"]})
        self.assertIn("甲（自身: 上平一東）", ambiguous[0])

    def test_known_self_with_unknown_other_is_reported_but_not_listed(self):
        variants, ambiguous, unmapped = self.run_variants(["甲"], jp={"甲": ["乙"]})
        self.assertEqual(variants, {})
        self.assertTrue(ambiguous[0].startswith("甲\t1/2\t"))
        self.assertEqual(unmapped, [])

    def test_one_to_one_is_not_ambiguous(self):
        variants, ambiguous, unmapped = self.run_variants(["乙"], jp={"甲": ["乙"]})
        self.assertEqual(variants, {"甲": ["乙"]})
        self.assertEqual(ambiguous, [])
        self.assertEqual(unmapped, [])

    def test_no_known_candidate_goes_to_unmapped(self):
        variants, _, unmapped = self.run_variants([], st={"甲": ["乙"]})
        self.assertEqual(variants, {})
        self.assertEqual(unmapped, ["甲\t簡体字→繁体字\t候補: 乙"])

    def test_unmapped_lists_shinjitai_before_simplified(self):
        _, _, unmapped = self.run_variants([], jp={"丁": ["乙"]}, st={"丙": ["丑"]})
        # 丙（U+4E19）は丁（U+4E01）より後ろの字だが、新字体由来の丁を先に並べる
        self.assertEqual([row[0] for row in unmapped], ["丁", "丙"])

    def test_multi_char_keys_are_ignored(self):
        variants, ambiguous, unmapped = self.run_variants(["乙"], st={"甲乙": ["乙"]})
        self.assertEqual((variants, ambiguous, unmapped), ({}, [], []))


WIKI = """\
==上平聲部==
上平聲一{{++|東}}

東同

【詞】中同

上平聲二{{++|冬}}

冬
==上聲部==
上聲一{{++|董}}

董同
"""


class ParseAndBuildCharsTest(unittest.TestCase):
    def test_supplement_marker_is_kept_and_body_wins_on_duplicate(self):
        rhymes, entries = parse_wikisource(WIKI)
        self.assertEqual([r["id"] for r in rhymes], ["上平一東", "上平二冬", "上声一董"])
        chars, dups = build_chars(rhymes, entries)
        self.assertEqual(chars["中"], [{"tone": "平", "rhyme": "上平一東", "note": "【詞】"}])
        # 同は本体と【詞】の両方に載る → 本体を採り、重複として記録する
        self.assertEqual(
            chars["同"],
            [{"tone": "平", "rhyme": "上平一東"}, {"tone": "上", "rhyme": "上声一董"}],
        )
        self.assertEqual(len(dups), 1)
        self.assertTrue(dups[0].startswith("同\t上平一東\t本体と【詞】"))

    def test_non_han_text_stops_the_build(self):
        with self.assertRaises(BuildError):
            parse_wikisource("上平聲一{{++|東}}\n東Public\n")

    def test_body_before_first_heading_stops_the_build(self):
        with self.assertRaises(BuildError):
            parse_wikisource("東同\n")


class ApplyCorrectionsTest(unittest.TestCase):
    def setUp(self):
        self.rhymes, entries = parse_wikisource(WIKI)
        self.chars, _ = build_chars(self.rhymes, entries)

    def correction(self, **kw):
        base = {"action": "add", "char": "冬", "rhyme": "上平一東", "reason": "r", "evidence": ["e"]}
        return {**base, **kw}

    def test_add_inserts_reading_in_rhyme_order(self):
        chars, applied = apply_corrections(self.chars, self.rhymes, [self.correction()])
        self.assertEqual(
            chars["冬"],
            [{"tone": "平", "rhyme": "上平一東"}, {"tone": "平", "rhyme": "上平二冬"}],
        )
        self.assertEqual(len(applied), 1)

    def test_add_promotes_supplement_reading_to_body(self):
        chars, _ = apply_corrections(self.chars, self.rhymes, [self.correction(char="中")])
        self.assertEqual(chars["中"], [{"tone": "平", "rhyme": "上平一東"}])

    def test_unneeded_correction_stops_the_build(self):
        with self.assertRaises(BuildError):
            apply_corrections(self.chars, self.rhymes, [self.correction(char="東")])

    def test_correction_without_evidence_stops_the_build(self):
        with self.assertRaises(BuildError):
            apply_corrections(self.chars, self.rhymes, [self.correction(evidence=[])])

    def test_unknown_rhyme_stops_the_build(self):
        with self.assertRaises(BuildError):
            apply_corrections(self.chars, self.rhymes, [self.correction(rhyme="上平九十九無")])


KOKUJI_WIKI = """\
== 和製漢字の例 ==
{| class="sortable wikitable"
!和製漢字!!訓読み!!音読み!!備考
|-
!峠{{r|"x"|page=1}}
|とうげ||-||古くからある。
|-
!{{JIS90フォント|辻}}
|つじ||-||国字でない可能性がある<ref>x</ref>。
|-
!搾
|しぼ（る）||サク||異体字。国字とは言い難い<ref>x</ref>。
|-
!萩{{要出典|date=2024年1月}}
|はぎ||-||
|}

== 通用範囲 ==
"""


class ParseKokujiTest(unittest.TestCase):
    def test_hedges_in_remarks_and_header_marks_become_notes(self):
        result = {e["char"]: e.get("note") for e in parse_kokuji(KOKUJI_WIKI)}
        self.assertEqual(list(result), ["峠", "辻", "搾", "萩"])
        self.assertIsNone(result["峠"])
        self.assertEqual(result["辻"], "出典の備考に「国字でない可能性」とある")
        self.assertEqual(result["搾"], "出典の備考に「国字とは言い難い」とある")
        self.assertEqual(result["萩"], "出典の行見出しに「要出典」「疑問点」の印がある")


if __name__ == "__main__":
    unittest.main()
