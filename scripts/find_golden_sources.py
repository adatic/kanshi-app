#!/usr/bin/env python3
"""ゴールデンテストの詩ごとに、本文の照合先を全集の全文から探し、golden/sources.json に書く（CLAUDE.md §6.2）。

全集の全文が要るので、chinese-poetry を手元に clone して、そのパスを渡して実行する。CI では実行しない。
結果（どのファイルの何番目の詩か、上流ファイルのハッシュ）は golden/sources.json に固定され、
以後は scripts/fetch_golden_sources.py がその詩だけを取得し、scripts/build_golden_input.py が入力を作る。

  git clone https://github.com/chinese-poetry/chinese-poetry <dir>
  git -C <dir> checkout <COMMIT>
  python3 scripts/find_golden_sources.py <dir>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

from golden_text import choose, lines_of, score, windows

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "golden" / "sources.json"

COMMIT = "b8594f81a89752241442f2ce267d6f66f96704ee"
SELECTION = "蒙学/tangshisanbaishou.json"
SELECTION_TYPES = {"七言絕句": "七言絕句", "樂府": "樂府（4句×7字）"}
TEXT_GLOB = "全唐诗/poet.tang.*.json"  # 本文に使う
CROSS_GLOB = "御定全唐詩/json/*.json"  # 照合の比較にだけ使う
NEAR = 22  # 記録する近い候補の下限


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_corpus(repo: Path, pattern: str) -> list[dict]:
    key = (lambda p: int(p.name.split(".")[-2])) if "poet.tang" in pattern else (lambda p: p.name)
    out = []
    for f in sorted(repo.glob(pattern), key=key):
        rel = f.relative_to(repo).as_posix()
        for i, p in enumerate(json.loads(f.read_text(encoding="utf-8"))):
            out.append({"file": rel, "index": i, "title": p["title"], "author": p["author"], "lines": lines_of(p["paragraphs"])})
    return out


def candidates(target: str, corpus: list[dict]) -> list[dict]:
    found = []
    for poem in corpus:
        for start, text in windows(poem["lines"]):
            sc = score(target, text)
            if sc >= NEAR:
                found.append({"file": poem["file"], "index": poem["index"], "title": poem["title"], "author": poem["author"], "window": start, "score": sc, "text": text})
    found.sort(key=lambda c: (-c["score"], c["file"], c["index"], c["window"]))
    return found


def strip(c: dict | None) -> dict | None:
    return None if c is None else {k: v for k, v in c.items() if k != "text"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("repo", type=Path, help="chinese-poetry を clone したディレクトリ")
    args = parser.parse_args()
    repo: Path = args.repo
    head = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    if head != COMMIT:
        print(f"エラー: {repo} のコミットが {head} です。{COMMIT} を checkout してください。", file=sys.stderr)
        return 1

    selection = json.loads((repo / SELECTION).read_text(encoding="utf-8"))
    text_corpus = load_corpus(repo, TEXT_GLOB)
    cross_corpus = load_corpus(repo, CROSS_GLOB)

    poems = []
    used_files = {SELECTION}
    counter = {g: 0 for g in SELECTION_TYPES.values()}
    for si, section in enumerate(selection["content"]):
        group = SELECTION_TYPES.get(section["type"])
        if group is None:
            continue
        for pi, p in enumerate(section["content"]):
            target_lines = lines_of(p["paragraphs"])
            if group == "樂府（4句×7字）" and [len(x) for x in target_lines] != [7] * 4:
                continue
            target = "".join(target_lines)
            counter[group] += 1
            text_cands = candidates(target, text_corpus)
            cross_cands = candidates(target, cross_corpus)
            text, reasons, text_dups = choose(target, p["author"], text_cands)
            cross, cross_reasons, _ = choose(target, p["author"], cross_cands)
            if text is not None:
                used_files.add(text["file"])
            if cross is not None:
                used_files.add(cross["file"])
            poems.append(
                {
                    "id": f"{'q' if group == '七言絕句' else 'y'}{counter[group]:02d}",
                    "group": group,
                    "selection": {"section": si, "index": pi, "type": section["type"], "chapter": p["chapter"], "author": p["author"], "text": target},
                    "text": strip(text),
                    "textReview": reasons,
                    "textDuplicates": [strip(c) for c in text_dups],
                    "crosscheck": strip(cross),
                    "crosscheckReview": cross_reasons,
                    "nearCandidates": [strip(c) for c in text_cands[:5]],
                }
            )

    doc = {
        "description": "ゴールデンテストの詩ごとの本文の照合先（scripts/find_golden_sources.py が生成）。本文は text（全唐诗 poet.tang）から取り、crosscheck（御定全唐詩）とは比較にだけ使う。",
        "upstream": {"repo": "https://github.com/chinese-poetry/chinese-poetry", "commit": COMMIT, "license": "MIT"},
        "selection": {"file": SELECTION, "types": SELECTION_TYPES},
        "files": {f: sha256(repo / f) for f in sorted(used_files)},
        "poems": poems,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    review = [p["id"] for p in poems if p["textReview"]]
    print(f"書き出し {OUT.relative_to(ROOT)}：{len(poems)}首（要確認 {len(review)}首: {', '.join(review) or 'なし'}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
