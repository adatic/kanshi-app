"""ゴールデンテストの入力の網羅性（CLAUDE.md §6.2「全件抽出」）。`npm test` で走る。

保存した唐詩三百首のファイルから対象を数え直し、golden/sources.json・golden/input.json と過不足なく一致することを確かめる。
全集の全文やネットワークは使わない。
"""

import json
import unittest
from pathlib import Path

from find_golden_sources import SELECTION_TYPES
from golden_text import lines_of

ROOT = Path(__file__).resolve().parent.parent
SOURCES = json.loads((ROOT / "golden" / "sources.json").read_text(encoding="utf-8"))
INPUT = json.loads((ROOT / "golden" / "input.json").read_text(encoding="utf-8"))
SELECTION = json.loads(
    (ROOT / "data" / "raw" / f"chinese-poetry-{SOURCES['upstream']['commit'][:7]}" / "tangshisanbaishou.json").read_text(encoding="utf-8")
)


def expected_targets() -> list[tuple[int, int, str]]:
    """（分類の番号, 詩の番号, 枠）。七言絕句は全件、樂府は4句×7字のものだけ。"""
    out = []
    for si, section in enumerate(SELECTION["content"]):
        group = SELECTION_TYPES.get(section["type"])
        if group is None:
            continue
        for pi, p in enumerate(section["content"]):
            if group != "七言絕句" and [len(x) for x in lines_of(p["paragraphs"])] != [7] * 4:
                continue
            out.append((si, pi, group))
    return out


class CoverageTest(unittest.TestCase):
    def test_sources_cover_every_target_exactly_once(self):
        recorded = [(p["selection"]["section"], p["selection"]["index"], p["group"]) for p in SOURCES["poems"]]
        self.assertEqual(len(recorded), len(set(recorded)), "重複がある")
        self.assertEqual(sorted(recorded), sorted(expected_targets()))

    def test_every_seven_char_quatrain_in_the_selection_is_included(self):
        quatrains = [t for t in expected_targets() if t[2] == "七言絕句"]
        section = next(s for s in SELECTION["content"] if s["type"] == "七言絕句")
        self.assertEqual(len(quatrains), len(section["content"]))
        included = [p for p in INPUT["poems"] if p["included"]]
        self.assertEqual(len(included), len(quatrains))

    def test_recorded_selection_text_matches_the_stored_file(self):
        for p in SOURCES["poems"]:
            sel = p["selection"]
            poem = SELECTION["content"][sel["section"]]["content"][sel["index"]]
            self.assertEqual(sel["text"], "".join(lines_of(poem["paragraphs"])), p["id"])
            self.assertEqual((sel["chapter"], sel["author"]), (poem["chapter"], poem["author"]), p["id"])

    def test_included_poems_have_four_seven_char_lines(self):
        for p in INPUT["poems"]:
            if p["included"]:
                self.assertEqual([len(x) for x in p["lines"]], [7] * 4, p["id"])


if __name__ == "__main__":
    unittest.main()
