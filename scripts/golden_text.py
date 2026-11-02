"""ゴールデンテストの本文の扱い（照合と整形）を、探索・生成・テストで共有する。"""

from __future__ import annotations

import re

HAN = "㐀-䶿一-鿿豈-﫿\U00020000-\U0003ffff"
_PAREN = re.compile(r"[（(][^）)]*[）)]")
_SPLIT = re.compile(r"[，。？！；：、\s]")
_NON_HAN = re.compile(f"[^{HAN}]")

# 照合の基準（CLAUDE.md §6.2：本文は推測で埋めない）
MIN_SCORE = 24  # 28字中、位置ごとに一致する字数がこれ未満なら採らない
ANONYMOUS = {"佚名", "無名氏", "不詳"}


def lines_of(paragraphs: list[str]) -> list[str]:
    """詩の本文を句に分ける。括弧つきの注記（「(江南 一作：江湖)」など）を除き、句読点で区切り、漢字だけを残す。"""
    text = _PAREN.sub("", "".join(paragraphs))
    return [s for s in (_NON_HAN.sub("", part) for part in _SPLIT.split(text)) if s]


def windows(lines: list[str]):
    """連続する7字×4句の窓（開始句の番号、28字）を返す。"""
    for i in range(len(lines) - 3):
        w = lines[i : i + 4]
        if all(len(x) == 7 for x in w):
            yield i, "".join(w)


def score(a: str, b: str) -> int:
    """位置ごとに一致する字数。"""
    return sum(x == y for x, y in zip(a, b))


def same_author(a: str, b: str) -> bool:
    return a == b or (a in ANONYMOUS and b in ANONYMOUS)


def choose(target: str, author: str, candidates: list[dict]) -> tuple[dict | None, list[str], list[dict]]:
    """候補（score・author・text を持つ dict）から照合先を一つ選ぶ。

    戻り値: (選んだ候補または None, 選べない理由, 同文の重出として選ばなかった候補)
    - 作者が一致する候補のうち、一致する字数が最も多いもの
    - 最高点の候補が複数でも、本文（28字）がすべて同じなら、全集の中の同じ詩の重出なので最初の候補を採る
    - 一致が MIN_SCORE 未満、本文の違う候補が同点で並ぶ、作者が一致する候補がない、のいずれかなら選ばない
    """
    same = [c for c in candidates if same_author(author, c["author"])]
    if not same:
        return None, ["作者が一致する候補がない"], []
    top = max(c["score"] for c in same)
    best = [c for c in same if c["score"] == top]
    reasons = []
    if top < MIN_SCORE:
        reasons.append(f"一致が{top}字で、基準の{MIN_SCORE}字に届かない")
    if len({c["text"] for c in best}) > 1:
        reasons.append(f"一致{top}字で本文の違う候補が{len(best)}件ある")
    if reasons:
        return None, reasons, []
    return best[0], [], best[1:]


def diffs(a: str, b: str) -> list[list]:
    """位置（1始まり）ごとの字の違い。[[位置, aの字, bの字], ...]"""
    return [[i + 1, x, y] for i, (x, y) in enumerate(zip(a, b)) if x != y]
