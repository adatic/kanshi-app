#!/usr/bin/env python3
"""元データを版を固定して取得し、data/raw/ に保存する（CLAUDE.md §4.3）。

ネットワークを使うのはこのスクリプトだけ。生成（build_data.py）は data/raw/ だけを読む。
取得した中身は SHA-256 で検証し、一致しなければ保存せずに失敗する。
上流が版を消した・内容が変わった場合は、DATA_SOURCES.md を見直したうえでハッシュを更新すること。

使い方:
  python3 scripts/fetch_sources.py           # 欠けているファイルだけ取得
  python3 scripts/fetch_sources.py --force   # すべて取得し直して検証
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
USER_AGENT = "kanshi-app/0.1 (https://github.com/adatic/kanshi-app; data fetch)"

OPENCC_TAG = "ver.1.4.2"
OPENCC_BASE = f"https://raw.githubusercontent.com/BYVoid/OpenCC/{OPENCC_TAG}"

UNICODE_VERSION = "18.0.0"


def mediawiki_revision(api: str, revid: int) -> str:
    query = urllib.parse.urlencode(
        {
            "action": "query",
            "prop": "revisions",
            "revids": str(revid),
            "rvprop": "ids|content",
            "rvslots": "main",
            "format": "json",
            "formatversion": "2",
        }
    )
    return f"{api}?{query}"


# path: data/raw/ からの相対パス
# kind: "mediawiki" は API の JSON から本文（wikitext）を取り出して保存する
#       "zip-member" は zip を取得して archive_sha256 で検証し、member だけを取り出して保存する
SOURCES = [
    {
        "path": "wikisource-pingshui-8264804.wiki",
        "kind": "mediawiki",
        "url": mediawiki_revision("https://zh.wikisource.org/w/api.php", 8264804),
        "sha256": "c0003fa238f6cb2c767f7747fae33eecde8c06da3eb661ab9d48bbff655857d9",
    },
    {
        "path": "wikipedia-ja-wasei-kanji-109822326.wiki",
        "kind": "mediawiki",
        "url": mediawiki_revision("https://ja.wikipedia.org/w/api.php", 109822326),
        "sha256": "c8701426f6a5bd74b96337ef037851a6d613a16a5c47812cd1b77fc8950cfe1c",
    },
    {
        # 定型（data/forms.json）の照合元。律句・一三五不論・下三連・孤平・反法粘法・挟み平
        "path": "wikipedia-ja-kintaishi-96547510.wiki",
        "kind": "mediawiki",
        "url": mediawiki_revision("https://ja.wikipedia.org/w/api.php", 96547510),
        "sha256": "c3a73f2b499138d8113e7d89cc78e406f10e80eedcaa67d47bb91b610d10198d",
    },
    {
        # 定型（data/forms.json）の照合元。七言の4基本句式・相対相黏・七絶仄起首句入韻の例・孤雁入群格
        "path": "wikipedia-zh-kintaishi-92701000.wiki",
        "kind": "mediawiki",
        "url": mediawiki_revision("https://zh.wikipedia.org/w/api.php", 92701000),
        "sha256": "e59a50cfe955864e950d62e26a56d48b2e8d0fd5afbea2cf71e04772046b3247",
    },
    {
        "path": f"opencc-{OPENCC_TAG}/STCharacters.txt",
        "kind": "file",
        "url": f"{OPENCC_BASE}/data/dictionary/STCharacters.txt",
        "sha256": "a0ca1601c70648cf48b33c3c6210ccbecc5c7eead4b4c3daf76587ba2c03582b",
    },
    {
        "path": f"opencc-{OPENCC_TAG}/JPShinjitaiCharacters.txt",
        "kind": "file",
        "url": f"{OPENCC_BASE}/data/dictionary/JPShinjitaiCharacters.txt",
        "sha256": "12cec7250b873ef52b36d8f92218d4f92c0aaf5d8cd7c58fe42d9785bdcdc43a",
    },
    {
        "path": f"opencc-{OPENCC_TAG}/LICENSE",
        "kind": "file",
        "url": f"{OPENCC_BASE}/LICENSE",
        "sha256": "b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308",
    },
    {
        "path": f"unicode-{UNICODE_VERSION}/Unihan_Variants.txt",
        "kind": "zip-member",
        "url": f"https://www.unicode.org/Public/{UNICODE_VERSION}/ucd/Unihan.zip",
        "archive_sha256": "4c93ea9c1f636451729a840978f1667a53886af37ba854fdcce109721c63d43e",
        "member": "Unihan_Variants.txt",
        "sha256": "4ccfd34b08ac7b9c14353f6668ba43e3796d85c4cdce7952b635be16015aafa2",
    },
    {
        "path": f"unicode-{UNICODE_VERSION}/license.txt",
        "kind": "file",
        "url": "https://www.unicode.org/license.txt",
        "sha256": "e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96",
    },
]


def http_get(url: str) -> bytes:
    """GET する。429（混雑）なら Retry-After だけ待って最大5回まで取り直す。"""
    for attempt in range(5):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return res.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 4:
                raise
            wait = int(e.headers.get("Retry-After", "10"))
            print(f"  429 Too Many Requests: {wait}秒待って再試行します", file=sys.stderr)
            time.sleep(wait)
    raise AssertionError("unreachable")


def extract_mediawiki_content(body: bytes) -> bytes:
    data = json.loads(body)
    page = data["query"]["pages"][0]
    content = page["revisions"][0]["slots"]["main"]["content"]
    return content.encode("utf-8")


def fetch(source: dict, force: bool) -> bool:
    dest = RAW / source["path"]
    if dest.exists() and not force:
        ok = hashlib.sha256(dest.read_bytes()).hexdigest() == source["sha256"]
        print(f"{'ok  ' if ok else 'NG  '} {source['path']}（既存ファイルを検証）")
        return ok
    print(f"取得 {source['path']}")
    body = http_get(source["url"])
    if source["kind"] == "mediawiki":
        body = extract_mediawiki_content(body)
    elif source["kind"] == "zip-member":
        archive_digest = hashlib.sha256(body).hexdigest()
        if archive_digest != source["archive_sha256"]:
            print(
                f"NG   {source['path']}: zip の SHA-256 が一致しません\n"
                f"     期待値 {source['archive_sha256']}\n"
                f"     実際   {archive_digest}",
                file=sys.stderr,
            )
            return False
        with zipfile.ZipFile(io.BytesIO(body)) as zf:
            body = zf.read(source["member"])
    digest = hashlib.sha256(body).hexdigest()
    if digest != source["sha256"]:
        print(
            f"NG   {source['path']}: SHA-256 が一致しません\n"
            f"     期待値 {source['sha256']}\n"
            f"     実際   {digest}",
            file=sys.stderr,
        )
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(body)
    print(f"ok   {source['path']}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--force", action="store_true", help="既存ファイルがあっても取得し直す")
    args = parser.parse_args()
    results = [fetch(s, args.force) for s in SOURCES]
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
