#!/usr/bin/env python3
"""ゴールデンテストの入力 golden/input.json と、照合のレポート data/reports/golden-input.md を作る（CLAUDE.md §6.2）。

入力は golden/sources.json（照合先）と、scripts/fetch_golden_sources.py が保存した data/raw/chinese-poetry-*/excerpt.json だけ。
ネットワークは使わない。同じ入力からは常に同じ出力を出す（§9）。

使い方:
  python3 scripts/build_golden_input.py           # 生成して書き出す
  python3 scripts/build_golden_input.py --check   # コミット済みのファイルと一致するか確かめる（書き出さない）
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from golden_text import diffs, lines_of

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "golden" / "sources.json"
INPUT = ROOT / "golden" / "input.json"
REPORT = ROOT / "data" / "reports" / "golden-input.md"

INCLUDED_GROUP = "七言絕句"


def window_text(excerpt: dict, ref: dict) -> str:
    poem = excerpt[ref["file"]][str(ref["index"])]
    lines = lines_of(poem["paragraphs"])
    return "".join(lines[ref["window"] : ref["window"] + 4])


def split4(text: str) -> list[str]:
    return [text[i : i + 7] for i in range(0, 28, 7)]


def build() -> dict[Path, str]:
    doc = json.loads(SOURCES.read_text(encoding="utf-8"))
    commit = doc["upstream"]["commit"]
    excerpt = json.loads((ROOT / "data" / "raw" / f"chinese-poetry-{commit[:7]}" / "excerpt.json").read_text(encoding="utf-8"))

    poems = []
    for p in doc["poems"]:
        sel = p["selection"]
        text = window_text(excerpt, p["text"]) if p["text"] is not None else None
        cross = window_text(excerpt, p["crosscheck"]) if p["crosscheck"] is not None else None
        if text is not None and len(text) != 28:
            raise SystemExit(f"エラー: {p['id']} の本文が28字ではない: {text}")
        poems.append(
            {
                "id": p["id"],
                "group": p["group"],
                "included": p["group"] == INCLUDED_GROUP and text is not None,
                "title": sel["chapter"],
                "author": sel["author"],
                "lines": split4(text) if text is not None else None,
                "source": p["text"],
                "review": p["textReview"],
                "diffs": {
                    # [位置(1始まり), 本文の字, 比べた版の字]
                    "selection": diffs(text, sel["text"]) if text is not None else None,
                    "crosscheck": diffs(text, cross) if text is not None and cross is not None else None,
                },
            }
        )

    input_doc = {
        "description": "ゴールデンテストの入力（scripts/build_golden_input.py が生成。手で編集しない）。included が true の詩をエンジンに通す。本文は chinese-poetry の 全唐诗/poet.tang（繁体字）から取った。",
        "upstream": doc["upstream"],
        "poems": poems,
    }
    return {INPUT: json.dumps(input_doc, ensure_ascii=False, indent=2) + "\n", REPORT: report(poems)}


def fmt_diffs(ds) -> str:
    if ds is None:
        return "（比べられない）"
    return "、".join(f"{pos}字目 {a}／{b}" for pos, a, b in ds) or "なし"


def report(poems: list[dict]) -> str:
    included = [p for p in poems if p["included"]]
    out = [
        "# ゴールデンテストの入力：照合のレポート",
        "",
        "`scripts/build_golden_input.py` が生成する。手で編集しない。",
        "",
        "- 対象：chinese-poetry `蒙学/tangshisanbaishou.json`（唐詩三百首）の分類「七言絕句」",
        "- 本文：chinese-poetry `全唐诗/poet.tang.*.json`（繁体字）から照合して取った。唐詩三百首のファイルの本文は、簡体字からの機械変換の誤りを含むため使わない（DATA_SOURCES.md）",
        "- 字の違いは「本文の字／比べた版の字」。「唐詩三百首」は選定に使ったファイルの本文、「御定全唐詩」は chinese-poetry `御定全唐詩/` の本文",
        "",
        f"ゴールデンに入れる詩：{len(included)}首",
        "",
        "| ID | 題 | 作者 | 本文 | 照合先（一致字数） | 唐詩三百首との違い | 御定全唐詩との違い |",
        "|---|---|---|---|---|---|---|",
    ]
    for p in included:
        s = p["source"]
        out.append(
            f"| {p['id']} | {p['title']} | {p['author']} | {'／'.join(p['lines'])} | {s['file']} #{s['index']}「{s['title']}」（{s['score']}） | {fmt_diffs(p['diffs']['selection'])} | {fmt_diffs(p['diffs']['crosscheck'])} |"
        )
    others = [p for p in poems if not p["included"]]
    out += [
        "",
        "## ゴールデンに入れていない詩",
        "",
        "唐詩三百首の分類「樂府」のうち4句×7字の詩。七言絶句として扱うかは人間が判断する。照合先が決まらない詩は、本文を推測で埋めずに理由を示す。",
        "",
        "| ID | 題 | 作者 | 本文 | 照合先が決まらない理由 |",
        "|---|---|---|---|---|",
    ]
    for p in others:
        body = "／".join(p["lines"]) if p["lines"] else "—"
        out.append(f"| {p['id']} | {p['title']} | {p['author']} | {body} | {'・'.join(p['review']) or '—'} |")
    return "\n".join(out) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="書き出さずに、コミット済みのファイルと一致するか確かめる")
    args = parser.parse_args()
    outputs = build()
    if args.check:
        stale = [p.relative_to(ROOT) for p, c in outputs.items() if not p.exists() or p.read_text(encoding="utf-8") != c]
        if stale:
            print("ゴールデンの入力がコミット済みのファイルと一致しない（python3 scripts/build_golden_input.py で再生成する）:", file=sys.stderr)
            for p in stale:
                print(f"  {p}", file=sys.stderr)
            return 1
        print(f"ゴールデンの入力の再現を確認した（{len(outputs)}ファイル）")
        return 0
    for p, c in outputs.items():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(c, encoding="utf-8")
        print(f"書き出し {p.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
