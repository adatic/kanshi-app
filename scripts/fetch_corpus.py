#!/usr/bin/env python3
"""詩語頻度表の元にする全唐詩（chinese-poetry `全唐诗/poet.tang.*.json`）を、作業用のキャッシュ .cache/ に取得する。

全文は約25MBあるのでリポジトリには入れない。取得するファイルとその SHA-256 は data/corpus.json に固定し、
取得のたびに検証する（一致しなければ保存しない）。コミットはゴールデンテストと同じ（golden/sources.json）。

使い方:
  python3 scripts/fetch_corpus.py                       # 欠けているファイルだけ取得して検証
  python3 scripts/fetch_corpus.py --write-manifest DIR  # 手元の clone（DIR）から data/corpus.json を作る（初回だけ）
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

from fetch_golden_sources import raw_url
from fetch_sources import http_get

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "data" / "corpus.json"
PATTERN = "全唐诗/poet.tang.*.json"


def _load_manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def cache_dir(commit: str) -> Path:
    return ROOT / ".cache" / f"chinese-poetry-{commit[:7]}"


def corpus_files() -> tuple[str, list[tuple[str, Path]]]:
    """（コミット, [(上流のパス, キャッシュのパス)]）。ファイルは番号の順。"""
    doc = _load_manifest()
    out = cache_dir(doc["commit"])
    return doc["commit"], [(f, out / f) for f in doc["files"]]


def write_manifest(repo: Path) -> int:
    commit = json.loads((ROOT / "golden" / "sources.json").read_text(encoding="utf-8"))["upstream"]["commit"]
    head = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    if head != commit:
        print(f"エラー: {repo} のコミットが {head} です。{commit} を checkout してください。", file=sys.stderr)
        return 1
    files = sorted(repo.glob(PATTERN), key=lambda p: int(p.name.split(".")[-2]))
    doc = {
        "description": "詩語頻度表の元にする全唐詩のファイルと SHA-256（scripts/fetch_corpus.py が検証に使う）。",
        "repo": "https://github.com/chinese-poetry/chinese-poetry",
        "commit": commit,
        "license": "MIT",
        "files": {f.relative_to(repo).as_posix(): hashlib.sha256(f.read_bytes()).hexdigest() for f in files},
    }
    MANIFEST.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"書き出し {MANIFEST.relative_to(ROOT)}（{len(files)}ファイル）")
    return 0


def fetch() -> int:
    doc = _load_manifest()
    commit = doc["commit"]
    ok = True
    for path, expected in doc["files"].items():
        dest = cache_dir(commit) / path
        if dest.exists() and hashlib.sha256(dest.read_bytes()).hexdigest() == expected:
            continue
        body = http_get(raw_url(commit, path))
        digest = hashlib.sha256(body).hexdigest()
        if digest != expected:
            print(f"NG   {path}: SHA-256 が一致しません（期待値 {expected}、実際 {digest}）", file=sys.stderr)
            ok = False
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(body)
        print(f"取得 {path}")
    print("全唐詩のキャッシュを検証した" if ok else "取得に失敗したファイルがある")
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--write-manifest", type=Path, metavar="DIR", help="手元の clone から data/corpus.json を作る")
    args = parser.parse_args()
    return write_manifest(args.write_manifest) if args.write_manifest else fetch()


if __name__ == "__main__":
    sys.exit(main())
