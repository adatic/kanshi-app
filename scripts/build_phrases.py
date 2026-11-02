#!/usr/bin/env python3
"""詩語頻度表 data/phrases/ を作る（CLAUDE.md §4.3「詩語頻度表」）。

入力：全唐詩（scripts/fetch_corpus.py が .cache/ に取得したもの）、data/chars.json、data/variants.json。
同じ入力からは常に同じ出力を出す（§9）。

- 七言句（7字の句）を取り出し、2字語（1-2・3-4・5-6・6-7字目）と3字語（5-7字目）を数える。
  字の位置が信用できない句（外字の書き表し・欠字・校勘の記号を含む句）と、詩でないレコード（data/corpus-exclude.json）は使わない
- 出現回数1の語は除く
- 各語に、平仄パターン（読みが複数ある字は、ありうるパターンをすべて。データにない字は「？」）、末字の韻目、
  出現回数、位置ごとの出現回数、用例（全集の並び順で最初の3句。同じ句は重ねない）を付ける
- 平仄・韻目は平仄データから引く。エンジンと同じく、データにない字は異体字の対応（variants.json）の候補の読みを使う
- 先頭の字ごとのファイル（data/phrases/<先頭の字の符号位置>.json）に分け、索引 data/phrases/index.json を作る
- 平仄パターンで探すための索引 data/phrases/search/<字数>-<パターン>.json も作る（平→h 仄→z データにない字→q）。
  用例は持たず、語・出現回数・末字の韻目（data/rhymes.json の並びの番号）・位置ごとの出現回数だけ。
  画面はパターンに合うファイルだけを読み、用例は先頭の字ごとのファイルから必要なときに読む

使い方:
  python3 scripts/build_phrases.py           # 生成して書き出す
  python3 scripts/build_phrases.py --check   # コミット済みのファイルと一致するか確かめる（書き出さない）
"""

from __future__ import annotations

import argparse
import itertools
import json
import re
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path

from fetch_corpus import corpus_files
from golden_text import HAN

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "phrases"
EXCLUDE = ROOT / "data" / "corpus-exclude.json"

_PAREN = re.compile(r"[（(][^）)]*[）)]")
_QUOTES = re.compile(r"[「」『』“”‘’]")
_SPLIT = re.compile(r"[，。？！；：、\s]")
_ALL_HAN = re.compile(f"^[{HAN}]+$")

# （開始位置, 字数, 位置の名前）。位置は1始まりで名付ける
SLOTS = [(0, 2, "1-2"), (2, 2, "3-4"), (4, 2, "5-6"), (5, 2, "6-7"), (4, 3, "5-7")]
MAX_EXAMPLES = 3
MIN_COUNT = 2
UNKNOWN = "？"


def reading_lookup(chars: dict, variants: dict):
    """字 → 読みの一覧（エンジンと同じ：データにあればその読み＋異体字の候補の読み、なければ候補の読み）。"""

    def readings(c: str) -> list[dict]:
        own = chars.get(c, [])
        others = [v for v in variants.get(c, []) if v != c and v in chars]
        return own + [r for v in others for r in chars[v]]

    return readings


def pz(tone: str) -> str:
    return "平" if tone == "平" else "仄"


def patterns(word: str, readings) -> list[str]:
    """ありうる平仄パターン。データにない字は「？」。"""
    options = []
    for c in word:
        rs = readings(c)
        options.append(sorted({pz(r["tone"]) for r in rs}) if rs else [UNKNOWN])
    return sorted("".join(p) for p in itertools.product(*options))


def last_rhymes(word: str, readings, rhyme_order: dict[str, int]) -> list[str]:
    return sorted({r["rhyme"] for r in readings(word[-1])}, key=lambda r: rhyme_order[r])


def phrase_lines(paragraphs: list[str]) -> list[str]:
    """詩語に使う句を取り出す。字の位置が信用できない句は使わない。

    - 括弧つきの注記（「(一作：…)」など）と鉤括弧（会話の引用）は取り除く
    - 句読点で区切った句のうち、漢字以外の文字を含む句は捨てる。外字を部品で書き表したもの（「{炙火=肉}」）、
      欠字の「□」、校勘の「[一]」などで、残った漢字の並びが本文の字の位置と一致しないため
    """
    text = _QUOTES.sub("", _PAREN.sub("", "".join(paragraphs)))
    return [part for part in _SPLIT.split(text) if part and _ALL_HAN.match(part)]


def count_phrases(poems):
    """poems: [(作者, 題, 段落の一覧)]（全集の並び順）。→ {語: {"n", "at", "e"}}"""
    counts: Counter = Counter()
    at: dict[str, Counter] = defaultdict(Counter)
    examples: dict[str, list] = defaultdict(list)
    for author, title, paragraphs in poems:
        for line in phrase_lines(paragraphs):
            if len(line) != 7:
                continue
            for start, size, name in SLOTS:
                w = line[start : start + size]
                counts[w] += 1
                at[w][name] += 1
                ex = examples[w]
                if len(ex) < MAX_EXAMPLES and all(e[2] != line for e in ex):
                    ex.append([author, title, line])
    return {w: {"n": n, "at": dict(sorted(at[w].items())), "e": examples[w]} for w, n in counts.items() if n >= MIN_COUNT}


def _corpus_poems(path: str, cache: Path) -> list[dict]:
    if not cache.exists():
        raise SystemExit(f"エラー: {cache.relative_to(ROOT)} がない。先に python3 scripts/fetch_corpus.py を実行する")
    return json.loads(cache.read_text(encoding="utf-8"))


def load_exclusions() -> set[tuple[str, int]]:
    """数えないレコード（data/corpus-exclude.json）。記録した作者・題が実際のレコードと一致することを確かめる。"""
    records = json.loads(EXCLUDE.read_text(encoding="utf-8"))["records"]
    caches = dict(corpus_files()[1])
    out = set()
    for r in records:
        poem = _corpus_poems(r["file"], caches[r["file"]])[r["index"]]
        if (poem["author"], poem["title"]) != (r["author"], r["title"]):
            raise SystemExit(f"エラー: 除外の一覧の {r['file']} #{r['index']} が記録と違う（{poem['author']}「{poem['title']}」）")
        out.add((r["file"], r["index"]))
    return out


def load_corpus():
    excluded = load_exclusions()
    for path, cache in corpus_files()[1]:
        for i, p in enumerate(_corpus_poems(path, cache)):
            if (path, i) not in excluded:
                yield p["author"], p["title"], p["paragraphs"]


def _group_phrases(counted: dict, readings, rhyme_order: dict[str, int]) -> dict[str, dict[str, list]]:
    """集計した語に読みの情報を付け、先頭字・字数ごとに出現回数順でまとめる。"""
    by_first: dict[str, dict[str, list]] = defaultdict(lambda: {"2": [], "3": []})
    for word, info in counted.items():
        entry = {
            "w": word,
            "n": info["n"],
            "at": info["at"],
            "p": patterns(word, readings),
            "r": last_rhymes(word, readings, rhyme_order),
            "e": info["e"],
        }
        by_first[word[0]][str(len(word))].append(entry)
    for groups in by_first.values():
        for entries in groups.values():
            entries.sort(key=lambda e: (-e["n"], e["w"]))
    return by_first


SEARCH = OUT / "search"
PATTERN_CODE = {"平": "h", "仄": "z", UNKNOWN: "q"}


def search_files(by_first: dict[str, dict[str, list]], rhyme_order: dict[str, int]) -> dict[str, list]:
    """字数×平仄パターンごとの探索用の一覧。名前（"2-hz" など）→ [[語, 出現回数, [韻目の番号], [位置ごとの出現回数]], ...]。
    読みが複数あってパターンが複数ある語は、それぞれのファイルに入る。出現回数の多い順、同じなら語の順。"""
    files: dict[str, list] = defaultdict(list)
    slot_names = [name for _, _, name in SLOTS]
    for groups in by_first.values():
        for length, entries in groups.items():
            for e in entries:
                row = [e["w"], e["n"], [rhyme_order[r] for r in e["r"]], [e["at"].get(name, 0) for name in slot_names]]
                for pattern in e["p"]:
                    files[f"{length}-{''.join(PATTERN_CODE[c] for c in pattern)}"].append(row)
    for rows in files.values():
        rows.sort(key=lambda r: (-r[1], r[0]))
    return dict(files)


def build() -> dict[Path, str]:
    chars = json.loads((ROOT / "data" / "chars.json").read_text(encoding="utf-8"))
    variants = json.loads((ROOT / "data" / "variants.json").read_text(encoding="utf-8"))
    rhymes = json.loads((ROOT / "data" / "rhymes.json").read_text(encoding="utf-8"))
    rhyme_order = {r["id"]: i for i, r in enumerate(rhymes)}
    readings = reading_lookup(chars, variants)
    by_first = _group_phrases(count_phrases(load_corpus()), readings, rhyme_order)

    outputs: dict[Path, str] = {}
    index = {}
    for first in sorted(by_first, key=ord):
        groups = by_first[first]
        name = f"{ord(first):x}.json"
        index[first] = {"file": name, "2": len(groups["2"]), "3": len(groups["3"])}
        outputs[OUT / name] = json.dumps(groups, ensure_ascii=False, separators=(",", ":")) + "\n"

    commit = json.loads((ROOT / "data" / "corpus.json").read_text(encoding="utf-8"))["commit"]
    index_doc = {
        "description": "詩語頻度表の索引（scripts/build_phrases.py が生成。手で編集しない）。先頭の字 → ファイルと語数。各ファイルは {\"2\": 2字語, \"3\": 3字語}。語は {w: 語, n: 出現回数, at: 位置ごとの出現回数, p: ありうる平仄パターン（？はデータにない字）, r: 末字の韻目, e: 用例 [作者, 題, 句]（最大3件）}、出現回数の多い順。",
        "source": {"repo": "https://github.com/chinese-poetry/chinese-poetry", "commit": commit, "files": "全唐诗/poet.tang.*.json", "license": "MIT"},
        "slots": [name for _, _, name in SLOTS],
        "minCount": MIN_COUNT,
        "counts": {"2": sum(v["2"] for v in index.values()), "3": sum(v["3"] for v in index.values()), "files": len(index)},
        "chars": index,
    }
    outputs[OUT / "index.json"] = json.dumps(index_doc, ensure_ascii=False, indent=1) + "\n"

    search = search_files(by_first, rhyme_order)
    for name, rows in sorted(search.items()):
        outputs[SEARCH / f"{name}.json"] = json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + "\n"
    search_doc = {
        "description": "平仄パターンで詩語を探すための索引（scripts/build_phrases.py が生成。手で編集しない）。ファイル名は <字数>-<パターン>（平→h 仄→z データにない字→q）。各ファイルは [語, 出現回数, [末字の韻目の data/rhymes.json での番号], [位置ごとの出現回数]] の一覧で、出現回数の多い順。用例は先頭の字ごとのファイル（../index.json）にある。",
        "slots": [name for _, _, name in SLOTS],
        "files": {name: len(rows) for name, rows in sorted(search.items())},
    }
    outputs[SEARCH / "index.json"] = json.dumps(search_doc, ensure_ascii=False, indent=1) + "\n"
    return outputs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="書き出さずに、コミット済みのファイルと一致するか確かめる")
    args = parser.parse_args()
    outputs = build()
    existing = {p for p in OUT.rglob("*.json")} if OUT.exists() else set()
    if args.check:
        stale = [p for p, c in outputs.items() if not p.exists() or p.read_text(encoding="utf-8") != c]
        extra = sorted(existing - set(outputs))
        if stale or extra:
            print(f"詩語頻度表がコミット済みのファイルと一致しない（違うファイル {len(stale)}件、余分なファイル {len(extra)}件）。python3 scripts/build_phrases.py で再生成する", file=sys.stderr)
            for p in (stale + extra)[:10]:
                print(f"  {p.relative_to(ROOT)}", file=sys.stderr)
            return 1
        print(f"詩語頻度表の再現を確認した（{len(outputs)}ファイル）")
        return 0
    if OUT.exists():
        shutil.rmtree(OUT)
    SEARCH.mkdir(parents=True)
    for p, c in outputs.items():
        p.write_text(c, encoding="utf-8")
    print(f"書き出し {OUT.relative_to(ROOT)}/（{len(outputs)}ファイル）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
