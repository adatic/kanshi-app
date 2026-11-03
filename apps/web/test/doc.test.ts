// 詩の記録（apps/web/src/doc.ts）。字は平仄に関わらない架空の扱い（CLAUDE.md §0）。
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  addRequired,
  commitPending,
  committedGrid,
  currentRequired,
  currentSettings,
  diffLines,
  historyView,
  newDoc,
  pendingEdits,
  record,
  removeRequired,
  replay,
  requiredWarnings,
  setSettings,
  setWorking,
} from "../src/doc";
import { BLANK, emptyGrid, writeAt } from "../src/grid";
import { P } from "../../../packages/engine/test/fixture";

const T = (n: number) => `2026-11-03T10:00:${String(n).padStart(2, "0")}.000Z`;
const write = (grid: readonly string[], index: number, text: string) => writeAt(grid, index, text).grid;
const word = (...cs: string[]) => cs.join("");

describe("newDoc", () => {
  it("空のマス目、記録なし、既定の設定と空の必須要素のスナップショットが1件", () => {
    const d = newDoc(T(0));
    expect(committedGrid(d)).toEqual(emptyGrid());
    expect(d.working).toEqual(emptyGrid());
    expect(d.events).toEqual([]);
    expect(d.snapshots).toEqual([{ at: T(0), required: [], settings: DEFAULT_SETTINGS }]);
  });
});

describe("diffLines", () => {
  it("句ごとに、最初に違う位置から最後に違う位置までを前・後として返す", () => {
    let g = emptyGrid();
    g = write(g, 1, P[0]!);
    g = write(g, 4, P[1]!);
    g = write(g, 14, P[2]! + P[3]!);
    expect(diffLines(emptyGrid(), g)).toEqual([
      { line: 0, slot: 1, before: BLANK.repeat(4), after: word(P[0]!, BLANK, BLANK, P[1]!) },
      { line: 2, slot: 0, before: BLANK.repeat(2), after: word(P[2]!, P[3]!) },
    ]);
  });
});

describe("未確定の変更と確定", () => {
  it("手入力は未確定としてため、記録にはしない", () => {
    const d = setWorking(newDoc(T(0)), write(emptyGrid(), 14, word(P[0]!, P[1]!, P[2]!)));
    expect(d.events).toEqual([]);
    expect(pendingEdits(d)).toEqual([{ line: 2, slot: 0, before: BLANK.repeat(3), after: word(P[0]!, P[1]!, P[2]!) }]);
  });

  it("確定すると句ごとに作者の記録が1件ずつ増え、未確定はなくなる", () => {
    const g = write(write(emptyGrid(), 0, P[0]!), 14, P[1]!);
    const d = commitPending(setWorking(newDoc(T(0)), g), T(1));
    expect(d.events).toEqual([
      { at: T(1), actor: "author", line: 0, slot: 0, before: BLANK, after: P[0], origin: null },
      { at: T(1), actor: "author", line: 2, slot: 0, before: BLANK, after: P[1], origin: null },
    ]);
    expect(pendingEdits(d)).toEqual([]);
    expect(committedGrid(d)).toEqual(g);
  });

  it("except の句（いま書いている句）は確定せずに残す", () => {
    const g = write(write(emptyGrid(), 0, P[0]!), 14, P[1]!);
    const d = commitPending(setWorking(newDoc(T(0)), g), T(1), { except: 2 });
    expect(d.events.map((e) => e.line)).toEqual([0]);
    expect(pendingEdits(d).map((e) => e.line)).toEqual([2]);
  });

  it("理由は確定した記録に添える。空の理由は付けない", () => {
    const g = write(emptyGrid(), 0, P[0]!);
    expect(commitPending(setWorking(newDoc(T(0)), g), T(1), { reason: "  月を先に置く " }).events[0]!.reason).toBe("月を先に置く");
    expect("reason" in commitPending(setWorking(newDoc(T(0)), g), T(1), { reason: "  " }).events[0]!).toBe(false);
  });

  it("未確定がなければ何も足さない", () => {
    const d = newDoc(T(0));
    expect(commitPending(d, T(1))).toBe(d);
  });
});

describe("record（詩語候補・必須要素・例の詩などの操作）", () => {
  it("先に未確定の手入力を確定し、そのあと操作を記録する", () => {
    let d = setWorking(newDoc(T(0)), write(emptyGrid(), 7, P[0]!)); // 承句に手入力（未確定）
    d = record(d, T(1), write(d.working, 18, word(P[1]!, P[2]!)), { actor: "dictionary", origin: `phrase:${P[1]}${P[2]}` });
    expect(d.events.map((e) => [e.actor, e.line, e.slot, e.after, e.origin])).toEqual([
      ["author", 1, 0, P[0], null],
      ["dictionary", 2, 4, word(P[1]!, P[2]!), `phrase:${P[1]}${P[2]}`],
    ]);
    expect(pendingEdits(d)).toEqual([]);
  });

  it("複数の句にわたる操作は、句ごとに記録する", () => {
    let d = commitPending(setWorking(newDoc(T(0)), write(write(emptyGrid(), 0, P[0]!), 21, P[1]!)), T(1));
    d = record(d, T(2), emptyGrid(), { actor: "author", origin: "clear" });
    expect(d.events.slice(2).map((e) => [e.line, e.before, e.after, e.origin])).toEqual([
      [0, P[0], BLANK, "clear"],
      [3, P[1], BLANK, "clear"],
    ]);
  });

  it("理由は、その操作で足した記録すべてに添える", () => {
    let d = setWorking(newDoc(T(0)), write(emptyGrid(), 7, P[0]!));
    d = record(d, T(1), write(d.working, 18, P[1]!), { actor: "dictionary", origin: "phrase:x", reason: "用例を見て" });
    expect(d.events.map((e) => e.reason)).toEqual(["用例を見て", "用例を見て"]);
  });

  it("変化のない操作は何も足さない", () => {
    const d = newDoc(T(0));
    expect(record(d, T(1), emptyGrid(), { actor: "author", origin: "clear" })).toBe(d);
  });
});

describe("replay", () => {
  it("記録を最初から順にたどると、確定済みのマス目になる", () => {
    let d = newDoc(T(0));
    d = commitPending(setWorking(d, write(d.working, 0, word(P[0]!, P[1]!))), T(1));
    d = record(d, T(2), write(d.working, 1, P[2]!), { actor: "dictionary", origin: "phrase:y" });
    d = commitPending(setWorking(d, write(d.working, 27, P[3]!)), T(3));
    expect(replay(d.events)).toEqual({ grid: d.working });
  });

  it("記録の「前」がその時点のマス目と合わなければ、どこで合わないかを返す", () => {
    const events = [
      { at: T(1), actor: "author" as const, line: 0, slot: 0, before: BLANK, after: P[0]!, origin: null },
      { at: T(2), actor: "author" as const, line: 0, slot: 0, before: P[5]!, after: P[1]!, origin: null },
    ];
    expect(replay(events)).toEqual({ error: "2件目の記録（起句の1字目）の「前」が、その時点のマス目と合いません。" });
  });

  it("位置や字数が範囲の外の記録は誤り", () => {
    const bad = [{ at: T(1), actor: "author" as const, line: 0, slot: 6, before: BLANK.repeat(2), after: P[0]! + P[1]!, origin: null }];
    expect(replay(bad)).toEqual({ error: "1件目の記録の位置か字数が正しくありません。" });
  });
});

describe("必須要素と設定のスナップショット", () => {
  it("必須要素には r1, r2… と ID を振り、登録・削除のたびにスナップショットを足す。ID は使い回さない", () => {
    let d = addRequired(newDoc(T(0)), T(1), "甲乙");
    d = addRequired(d, T(2), "丙丁");
    expect(currentRequired(d)).toEqual([
      { id: "r1", word: "甲乙" },
      { id: "r2", word: "丙丁" },
    ]);
    d = removeRequired(d, T(3), "r1");
    d = addRequired(d, T(4), "戊己");
    expect(currentRequired(d)).toEqual([
      { id: "r2", word: "丙丁" },
      { id: "r3", word: "戊己" },
    ]);
    expect(d.snapshots).toHaveLength(5);
  });

  it("設定を変えるとスナップショットを足し、必須要素は引き継ぐ。同じ設定なら足さない", () => {
    let d = addRequired(newDoc(T(0)), T(1), "甲乙");
    d = setSettings(d, T(2), { ...DEFAULT_SETTINGS, rhyme: "上平一東" });
    expect(currentSettings(d).rhyme).toBe("上平一東");
    expect(currentRequired(d)).toEqual([{ id: "r1", word: "甲乙" }]);
    expect(setSettings(d, T(3), { ...DEFAULT_SETTINGS, rhyme: "上平一東" })).toBe(d);
  });
});

describe("requiredWarnings（必須要素の消失警告）", () => {
  const w = word(P[0]!, P[1]!);

  it("一度入っていた語がなくなったら lost", () => {
    let d = addRequired(newDoc(T(0)), T(1), w);
    d = record(d, T(2), write(d.working, 0, w), { actor: "author", origin: "required:r1" });
    expect(requiredWarnings(d)).toEqual([]);
    d = setWorking(d, write(d.working, 1, P[9]!)); // 未確定の書き換えでも、いまのマス目から消えれば警告
    expect(requiredWarnings(d)).toEqual([{ id: "r1", word: w, kind: "lost" }]);
  });

  it("28字が埋まったのに一度も入っていなければ missing。埋まる前は警告しない", () => {
    const d = addRequired(newDoc(T(0)), T(1), w);
    const full = Array.from({ length: 28 }, (_, i) => P[2 + (i % 20)]!);
    expect(requiredWarnings(setWorking(d, full.map((c, i) => (i === 27 ? BLANK : c))))).toEqual([]);
    expect(requiredWarnings(setWorking(d, full))).toEqual([{ id: "r1", word: w, kind: "missing" }]);
  });

  it("未確定の入力で入っていれば警告しない", () => {
    const d = setWorking(addRequired(newDoc(T(0)), T(1), w), write(emptyGrid(), 9, w));
    expect(requiredWarnings(d)).toEqual([]);
  });
});

describe("historyView", () => {
  it("新しい順に、誰が・どこを・前→後・どこから・理由を示す", () => {
    let d = addRequired(newDoc(T(0)), T(1), word(P[0]!, P[1]!));
    d = record(d, T(2), write(d.working, 0, word(P[0]!, P[1]!)), { actor: "author", origin: "required:r1" });
    d = record(d, T(3), write(d.working, 18, word(P[2]!, P[3]!)), { actor: "dictionary", origin: `phrase:${P[2]}${P[3]}`, reason: "用例" });
    d = commitPending(setWorking(d, write(d.working, 27, P[4]!)), T(4));
    expect(historyView(d)).toEqual([
      { at: T(4), who: "作者", where: "結句の7字目", before: BLANK, after: P[4], origin: "手入力", reason: null },
      { at: T(3), who: "辞書候補", where: "転句の5-6字目", before: BLANK.repeat(2), after: word(P[2]!, P[3]!), origin: "詩語候補", reason: "用例" },
      { at: T(2), who: "作者", where: "起句の1-2字目", before: BLANK.repeat(2), after: word(P[0]!, P[1]!), origin: `必須要素「${P[0]}${P[1]}」`, reason: null },
    ]);
  });

  it("例の詩・すべて消す・貼り付けモードからの移しも、どこからかを示す", () => {
    let d = record(newDoc(T(0)), T(1), write(emptyGrid(), 0, P[0]!), { actor: "author", origin: "sample" });
    d = record(d, T(2), write(d.working, 7, P[1]!), { actor: "author", origin: "paste" });
    d = record(d, T(3), emptyGrid(), { actor: "author", origin: "clear" });
    expect(historyView(d).map((r) => r.origin)).toEqual(["すべて消す", "すべて消す", "貼り付けモードから", "例の詩"]);
  });
});
