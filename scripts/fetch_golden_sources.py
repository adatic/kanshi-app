#!/usr/bin/env python3
"""golden/sources.json に記録した上流ファイルを版を固定して取得し、照合先の詩だけを data/raw/ に保存する。

- 上流ファイルは、記録したコミットの raw URL から取り、golden/sources.json の SHA-256 で検証する
- 検証できたら、本文と照合に使う詩（ファイルと番号）だけを抜き出して保存する（上流は1ファイル約千首と大きいため）
- 選定に使う唐詩三百首のファイルと、ライセンス文は丸ごと保存する

使い方:
  python3 scripts/fetch_golden_sources.py
"""

from __future__ import annotations

import hashlib
import json
import sys
import urllib.parse
from pathlib import Path

from fetch_sources import http_get

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "golden" / "sources.json"


def raw_dir(commit: str) -> Path:
    return ROOT / "data" / "raw" / f"chinese-poetry-{commit[:7]}"


def raw_url(commit: str, path: str) -> str:
    return f"https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/{commit}/{urllib.parse.quote(path)}"


def main() -> int:
    doc = json.loads(SOURCES.read_text(encoding="utf-8"))
    commit = doc["upstream"]["commit"]
    out = raw_dir(commit)
    out.mkdir(parents=True, exist_ok=True)

    needed: dict[str, set[int]] = {}
    for p in doc["poems"]:
        for key in ("text", "crosscheck"):
            if p[key] is not None:
                needed.setdefault(p[key]["file"], set()).add(p[key]["index"])

    excerpt: dict[str, dict[str, dict]] = {}
    ok = True
    for path, expected in doc["files"].items():
        body = http_get(raw_url(commit, path))
        digest = hashlib.sha256(body).hexdigest()
        if digest != expected:
            print(f"NG   {path}: SHA-256 が一致しません（期待値 {expected}、実際 {digest}）", file=sys.stderr)
            ok = False
            continue
        if path == doc["selection"]["file"]:
            (out / "tangshisanbaishou.json").write_bytes(body)
        if path in needed:
            poems = json.loads(body)
            excerpt[path] = {str(i): poems[i] for i in sorted(needed[path])}
        print(f"ok   {path}")

    license_body = http_get(raw_url(commit, "LICENSE"))
    (out / "LICENSE").write_bytes(license_body)
    if not ok:
        return 1
    (out / "excerpt.json").write_text(json.dumps(excerpt, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"書き出し {(out / 'excerpt.json').relative_to(ROOT)}（{sum(len(v) for v in excerpt.values())}首）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
