#!/usr/bin/env python3
"""data/raw/ の元データから、エンジンが読むデータとレポートを生成する（CLAUDE.md §4.3）。

ネットワークは使わない。同じ入力からは常に同じ出力を出す（§9）。

生成物:
  data/rhymes.json        平水韻106韻目の一覧（元データの見出し順）
  data/chars.json         字 → 読み（声調・韻目）の一覧
  data/variants.json      入力字（新字体・簡体字）→ データ上の字の候補
  data/kokuji.json        国字の一覧（出典つき）
  data/reports/*.txt|md   生成時のレポート

使い方:
  python3 scripts/build_data.py           # 生成して書き出す
  python3 scripts/build_data.py --check   # 生成結果がコミット済みのファイルと一致するか確かめる（書き出さない）
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data"
REPORTS = OUT / "reports"

WIKISOURCE = RAW / "wikisource-pingshui-8264804.wiki"
WASEI = RAW / "wikipedia-ja-wasei-kanji-109822326.wiki"
OPENCC_DIR = RAW / "opencc-ver.1.4.2"
ST_CHARS = OPENCC_DIR / "STCharacters.txt"
JP_SHINJITAI = OPENCC_DIR / "JPShinjitaiCharacters.txt"
CORRECTIONS = OUT / "corrections.json"

# 元データの見出し（上平聲・下平聲・上聲・去聲・入聲）→ 韻目名の接頭辞と声調。
# 韻目名は CLAUDE.md の例（"上平四支"・"下平十一尤"・"去声四寘"）の書き方にそろえる。
SECTION_PREFIX = {
    "上平聲": ("上平", "平"),
    "下平聲": ("下平", "平"),
    "上聲": ("上声", "上"),
    "去聲": ("去声", "去"),
    "入聲": ("入声", "入"),
}

# 本体の字のあとに【詞】【辭】の印で別に列挙された字。意味は元データに書かれていない。
# 本体と混ぜず、Reading.note に印をそのまま残す（扱いは人間が判断する）。
SUPPLEMENT_MARKERS = ("【詞】", "【辭】")

HEADING_RE = re.compile(r"^(上平聲|下平聲|上聲|去聲|入聲)([一二三四五六七八九十]+)\{\{\+\+\|(.)\}\}$")
PART_RE = re.compile(r"^==(上平聲部|下平聲部|上聲部|去聲部|入聲部)==$")
# 本文以外で、あってよい行（ページの枠組み）
FRAME_RE = re.compile(r"^(\{\{Header\|.*\}\}|\{\{PD-old\}\}|\{\{wikipedia\}\}|\[\[Category:[^\]]+\]\])$")


def is_cjk(ch: str) -> bool:
    o = ord(ch)
    return (
        0x3400 <= o <= 0x4DBF
        or 0x4E00 <= o <= 0x9FFF
        or 0xF900 <= o <= 0xFAFF
        or 0x20000 <= o <= 0x323AF
        or 0x2F800 <= o <= 0x2FA1F
    )


class BuildError(Exception):
    pass


# ---------------------------------------------------------------------------
# 平水韻（ウィキソース）


def parse_wikisource(text: str):
    """戻り値: (rhymes, entries)

    rhymes:  [{"id": "上平一東", "tone": "平"}...]（見出し順）
    entries: [(char, rhyme_id, marker or None, line_no)...]（出現順）
    """
    rhymes: list[dict] = []
    entries: list[tuple[str, str, str | None, int]] = []
    current: str | None = None
    for line_no, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or PART_RE.match(line) or FRAME_RE.match(line):
            continue
        m = HEADING_RE.match(line)
        if m:
            prefix, tone = SECTION_PREFIX[m.group(1)]
            current = f"{prefix}{m.group(2)}{m.group(3)}"
            if any(r["id"] == current for r in rhymes):
                raise BuildError(f"{line_no}行目: 韻目 {current} の見出しが2回ある")
            rhymes.append({"id": current, "tone": tone})
            continue
        marker = None
        for mk in SUPPLEMENT_MARKERS:
            if line.startswith(mk):
                marker, line = mk, line[len(mk):]
                break
        if current is None:
            raise BuildError(f"{line_no}行目: 韻目の見出しより前に本文がある: {raw!r}")
        bad = [c for c in line if not is_cjk(c)]
        if bad:
            raise BuildError(f"{line_no}行目: 漢字以外の文字を含む {bad!r}: {raw!r}")
        for ch in line:
            entries.append((ch, current, marker, line_no))
    return rhymes, entries


def build_chars(rhymes, entries):
    """字ごとの読みを作る。同じ韻目への重複は1つにまとめ、レポートに出す。"""
    tone_of = {r["id"]: r["tone"] for r in rhymes}
    order = {r["id"]: i for i, r in enumerate(rhymes)}
    # char -> rhyme -> (marker, first_line)
    seen: dict[str, dict[str, tuple[str | None, int]]] = {}
    dup_lines: list[str] = []
    for ch, rhyme, marker, line_no in entries:
        readings_by_rhyme = seen.setdefault(ch, {})
        if rhyme not in readings_by_rhyme:
            readings_by_rhyme[rhyme] = (marker, line_no)
            continue
        prev_marker, prev_line = readings_by_rhyme[rhyme]
        kind = f"{prev_marker or '本体'}と{marker or '本体'}"
        dup_lines.append(f"{ch}\t{rhyme}\t{kind}\t{prev_line}行目・{line_no}行目")
        # 本体に載っていれば本体を優先する（【詞】【辭】の印は付けない）
        if prev_marker is not None and marker is None:
            readings_by_rhyme[rhyme] = (None, prev_line)

    chars: dict[str, list[dict]] = {}
    for ch in sorted(seen, key=ord):
        readings = []
        for rhyme in sorted(seen[ch], key=lambda r: order[r]):
            marker, _ = seen[ch][rhyme]
            reading = {"tone": tone_of[rhyme], "rhyme": rhyme}
            if marker:
                reading["note"] = marker
            readings.append(reading)
        chars[ch] = readings
    return chars, dup_lines


def apply_corrections(chars, rhymes, corrections):
    """data/corrections.json の修正を当てる。当たらない修正はエラーにする。"""
    tone_of = {r["id"]: r["tone"] for r in rhymes}
    order = {r["id"]: i for i, r in enumerate(rhymes)}
    applied: list[str] = []
    for c in corrections:
        ch, rhyme, action = c["char"], c["rhyme"], c["action"]
        if rhyme not in tone_of:
            raise BuildError(f"修正: 韻目 {rhyme} は存在しない")
        if not c.get("reason") or not c.get("evidence"):
            raise BuildError(f"修正: {ch} {rhyme} に理由（reason）か根拠（evidence）がない")
        readings = chars.get(ch, [])
        present = [r for r in readings if r["rhyme"] == rhyme]
        if action == "add":
            if present and "note" not in present[0]:
                raise BuildError(f"修正: {ch} はすでに {rhyme} の本体に載っている（修正が不要）")
            readings = [r for r in readings if r["rhyme"] != rhyme]
            readings.append({"tone": tone_of[rhyme], "rhyme": rhyme})
            readings.sort(key=lambda r: order[r["rhyme"]])
        else:
            raise BuildError(f"修正: 未対応の action {action!r}")
        chars[ch] = readings
        applied.append(f"{action}\t{ch}\t{rhyme}\t{c['reason']}")
    return dict(sorted(chars.items(), key=lambda kv: ord(kv[0]))), applied


# ---------------------------------------------------------------------------
# 異体字の対応（OpenCC）


def parse_opencc(text: str) -> dict[str, list[str]]:
    table: dict[str, list[str]] = {}
    for line_no, raw in enumerate(text.splitlines(), 1):
        if not raw or raw.startswith("#"):
            continue
        key, _, values = raw.partition("\t")
        if not values:
            raise BuildError(f"OpenCC {line_no}行目: 形式が想定と違う: {raw!r}")
        if key in table:
            raise BuildError(f"OpenCC {line_no}行目: {key} が2回定義されている")
        table[key] = values.split(" ")
    return table


def _collect_variant_candidates(key, chars, jp, st):
    """候補の出現順を保ち、同じ候補の由来をすべて残す。"""
    sources: dict[str, list[str]] = {}

    def add(candidate: str, source: str):
        sources.setdefault(candidate, []).append(source)

    if key in chars:
        add(key, "自身")
    for candidate in jp.get(key, []):
        add(candidate, "新字体→旧字体")
    for candidate in st.get(key, []):
        add(candidate, "簡体字→繁体字")
    return list(sources), sources


def build_variants(chars, jp: dict[str, list[str]], st: dict[str, list[str]]):
    """入力字 → データにある字の候補。

    候補は「その字自身（データにあれば）」「新字体→旧字体」「簡体字→繁体字」の順に並べる。
    順序に優先の意味はない。どれを採るかはエンジンも決めない（§4.3）。
    """
    variants: dict[str, list[str]] = {}
    ambiguous: list[str] = []
    unmapped: list[str] = []
    # 字単位の対応だけを使う（語単位の見出しは除く）
    for key in sorted((k for k in set(jp) | set(st) if len(k) == 1), key=ord):
        candidates, sources = _collect_variant_candidates(key, chars, jp, st)

        known = [c for c in candidates if c in chars]
        # 一対多かどうかは、平仄データに絞る前の候補で判定する。
        # データにない候補も「平仄データにない」と書いて残し、黙って一つに決めない。
        if len(candidates) > 1:
            detail = "／".join(
                f"{c}（{'・'.join(sources[c])}: "
                f"{format_readings(chars[c]) if c in chars else '平仄データにない'}）"
                for c in candidates
            )
            ambiguous.append(f"{key}\t{len(known)}/{len(candidates)}\t{detail}")
        if not known:
            others = [c for c in candidates if c != key]
            kinds = "・".join(dict.fromkeys(src for c in others for src in sources[c]))
            unmapped.append((0 if key in jp else 1, ord(key), f"{key}\t{kinds}\t候補: {' '.join(others)}"))
            continue
        if known == [key]:
            continue  # データ上で自分自身にしか対応しない字は variants.json に載せない
        variants[key] = known
    # 日本語入力で出会いやすい新字体由来の字を先に並べる
    return variants, ambiguous, [row for _, _, row in sorted(unmapped)]


def format_readings(readings: list[dict]) -> str:
    return " ".join(r["rhyme"] + (r.get("note") or "") for r in readings)


# ---------------------------------------------------------------------------
# 国字（ウィキペディア「和製漢字」の例の表）

KOKUJI_SECTION = ("== 和製漢字の例 ==", "== 通用範囲 ==")
TEMPLATE_CHAR_RE = re.compile(r"^\{\{JIS\d+フォント\|(.)\}\}")
DOUBT_RE = re.compile(r"\{\{(要出典|疑問点)\|")
# 備考で、その字が国字であることに留保を付けている言い回し（出典の表で使われているもの）
HEDGE_PHRASES = ("国字でない可能性", "国字とは言い難い")


def parse_kokuji(text: str):
    start = text.index(KOKUJI_SECTION[0])
    end = text.index(KOKUJI_SECTION[1], start)
    rows = text[start:end].split("\n|-\n")
    result: list[dict] = []
    for row in rows:
        lines = row.strip().splitlines()
        head = next((ln for ln in lines if ln.startswith("!") and "!!" not in ln), None)
        if head is None:
            continue
        cell = head[1:]
        m = TEMPLATE_CHAR_RE.match(cell)
        ch = m.group(1) if m else cell[:1]
        if not is_cjk(ch):
            raise BuildError(f"国字の表: 行見出しから字を取り出せない: {head!r}")
        notes = []
        if DOUBT_RE.search(cell):
            notes.append("出典の行見出しに「要出典」「疑問点」の印がある")
        for phrase in HEDGE_PHRASES:
            if phrase in row:
                notes.append(f"出典の備考に「{phrase}」とある")
        entry = {"char": ch}
        if notes:
            entry["note"] = "。".join(notes)
        if any(e["char"] == ch for e in result):
            raise BuildError(f"国字の表: {ch} が2回ある")
        result.append(entry)
    return result


# ---------------------------------------------------------------------------
# 出力


def dump_chars(chars) -> str:
    # 1字1行。重複定義をテキストのまま検査できるようにする（scripts/check-data.test.ts）。
    lines = [
        f"  {json.dumps(ch, ensure_ascii=False)}: {json.dumps(rs, ensure_ascii=False, separators=(',', ':'))}"
        for ch, rs in chars.items()
    ]
    return "{\n" + ",\n".join(lines) + "\n}\n"


def dump_json(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2) + "\n"


def report(title: str, explanation: list[str], rows: list[str]) -> str:
    head = [f"# {title}", *[f"# {e}" for e in explanation], f"# 件数: {len(rows)}", ""]
    return "\n".join(head + rows) + "\n"


def build() -> dict[Path, str]:
    for p in (WIKISOURCE, WASEI, ST_CHARS, JP_SHINJITAI):
        if not p.exists():
            raise BuildError(f"{p.relative_to(ROOT)} がない。先に scripts/fetch_sources.py を実行する")

    ws_text = WIKISOURCE.read_text(encoding="utf-8")
    if unicodedata.normalize("NFC", ws_text) != ws_text:
        raise BuildError("平水韻の元データに NFC 正規化で変わる字がある（互換漢字など）。扱いを決めてから進める")
    rhymes, entries = parse_wikisource(ws_text)
    chars, dup_lines = build_chars(rhymes, entries)
    corrections = json.loads(CORRECTIONS.read_text(encoding="utf-8"))["corrections"]
    chars, applied = apply_corrections(chars, rhymes, corrections)

    jp = parse_opencc(JP_SHINJITAI.read_text(encoding="utf-8"))
    st = parse_opencc(ST_CHARS.read_text(encoding="utf-8"))
    variants, ambiguous, unmapped = build_variants(chars, jp, st)

    kokuji = parse_kokuji(WASEI.read_text(encoding="utf-8"))
    kokuji_overlap = [
        f"{k['char']}\t{format_readings(chars[k['char']])}" for k in kokuji if k["char"] in chars
    ]

    supplement_only = [ch for ch, rs in chars.items() if all("note" in r for r in rs)]
    supplement_extra = [
        ch for ch, rs in chars.items() if any("note" in r for r in rs) and not all("note" in r for r in rs)
    ]
    multi = [ch for ch, rs in chars.items() if len(rs) > 1]
    both_tones = [ch for ch, rs in chars.items() if len({r["tone"] == "平" for r in rs}) > 1]

    summary = "\n".join(
        [
            "# データ生成の概要",
            "",
            "`scripts/build_data.py` が生成する。手で編集しない。",
            "",
            "| 項目 | 件数 |",
            "|---|---|",
            f"| 韻目 | {len(rhymes)} |",
            f"| 収録字（重複を除く） | {len(chars)} |",
            f"| 読み（字×韻目） | {sum(len(rs) for rs in chars.values())} |",
            f"| 複数の韻目に載る字 | {len(multi)} |",
            f"| 平と仄の両方に載る字（両韻字） | {len(both_tones)} |",
            f"| 【詞】【辭】欄にだけ載る字 | {len(supplement_only)} |",
            f"| 本体にも載り、別の韻目の【詞】【辭】欄にも載る字 | {len(supplement_extra)} |",
            f"| 元データ内の重複（同じ字・同じ韻目） | {len(dup_lines)} |",
            f"| 当てた修正（corrections.json） | {len(applied)} |",
            f"| 異体字の対応（variants.json の見出し字） | {len(variants)} |",
            f"| 対応の候補が2字以上になる字（ambiguous.txt） | {len(ambiguous)} |",
            f"| 対応先がデータにない字（unmapped.txt） | {len(unmapped)} |",
            f"| 国字（kokuji.json） | {len(kokuji)} |",
            f"| 国字の一覧にあり、平水韻にも載る字 | {len(kokuji_overlap)} |",
            "",
        ]
    )

    kokuji_doc = {
        "source": {
            "title": "ウィキペディア日本語版「和製漢字」の「和製漢字の例」の表",
            "url": "https://ja.wikipedia.org/w/index.php?oldid=109822326",
            "revision": 109822326,
            "license": "CC BY-SA 4.0",
            "caveat": "網羅的な一覧ではない。記事には「未検証」「独自研究」「正確性」の注意書きがある。",
        },
        "chars": kokuji,
    }

    return {
        OUT / "rhymes.json": dump_json(rhymes),
        OUT / "chars.json": dump_chars(chars),
        OUT / "variants.json": dump_json(variants),
        OUT / "kokuji.json": dump_json(kokuji_doc),
        REPORTS / "summary.md": summary,
        REPORTS / "unmapped.txt": report(
            "対応できなかった字",
            [
                "新字体→旧字体・簡体字→繁体字の対応はあるが、どの候補も平仄データ（chars.json）にない字。",
                "新字体→旧字体の対応がある字を先に、簡体字→繁体字だけの字を後に並べる。",
                "書式: 入力字<TAB>対応の種類<TAB>候補",
            ],
            unmapped,
        ),
        REPORTS / "ambiguous.txt": report(
            "対応の候補が複数になる字",
            [
                "新字体→旧字体・簡体字→繁体字の対応で、候補（その字自身を含む）が2字以上になる字。",
                "平仄データにある候補はすべて variants.json に載せた（一つに決めていない）。平仄データにない候補もここに残す。",
                "書式: 入力字<TAB>平仄データにある候補の数/候補の数<TAB>候補（対応の種類: その字の韻目）／…",
            ],
            ambiguous,
        ),
        REPORTS / "source-duplicates.txt": report(
            "元データ内の重複",
            ["同じ韻目に同じ字が2回以上載っている箇所。chars.json では1つにまとめた（本体と【詞】【辭】が重なる場合は本体を採った）。"],
            dup_lines,
        ),
        REPORTS / "corrections-applied.txt": report(
            "当てた修正",
            ["data/corrections.json から当てた修正。根拠は corrections.json を見る。"],
            applied,
        ),
        REPORTS / "supplement-only.txt": report(
            "【詞】【辭】欄にだけ載る字",
            ["元データの本体には載らず、【詞】【辭】欄にだけ載る字。意味は元データに書かれていない。"],
            [f"{ch}\t{format_readings(chars[ch])}" for ch in supplement_only],
        ),
        REPORTS / "kokuji-overlap.txt": report(
            "国字の一覧にあり、平水韻にも載る字",
            ["kokuji.json と chars.json の両方にある字。どちらを採るかは人間が判断する。"],
            kokuji_overlap,
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="書き出さずに、コミット済みのファイルと一致するか確かめる")
    args = parser.parse_args()
    try:
        outputs = build()
    except BuildError as e:
        print(f"エラー: {e}", file=sys.stderr)
        return 1

    if args.check:
        stale = [
            p.relative_to(ROOT)
            for p, content in outputs.items()
            if not p.exists() or p.read_text(encoding="utf-8") != content
        ]
        if stale:
            print("生成結果がコミット済みのファイルと一致しない（python3 scripts/build_data.py で再生成する）:", file=sys.stderr)
            for p in stale:
                print(f"  {p}", file=sys.stderr)
            return 1
        print(f"データ生成の再現を確認した（{len(outputs)}ファイル）")
        return 0

    for p, content in outputs.items():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        print(f"書き出し {p.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
