// 選んだマスの条件と詩語候補（apps/web/src/assist.ts）。平仄は架空のデータで与える（CLAUDE.md §0）。
import { describe, expect, it } from "vitest";
import { analyze, constraintsAt } from "@kanshi/engine";
import type { PhraseEntry } from "@kanshi/engine";
import {
  SLOTS,
  checkCandidates,
  constraintView,
  filledWord,
  findPhrase,
  rhymeFor,
  rowsToEntries,
  searchFileNames,
  slotCandidates,
  slotPattern,
  slotsAt,
} from "../src/assist";
import { P, R, R2, RHYME_A, RHYME_B, RYO, Z, baseLines, build, fixtureData, replaceAt } from "../../../packages/engine/test/fixture";

const HN = baseLines("heiki-nyuin");
// HN = ○○●●●○◎ / ●●○○●●◎ / ●●○○○●● / ○○●●●○◎
const gridOf = (lines: string[]) => [...build(...lines).replaceAll("\n", "")];
const slot = (name: string) => SLOTS.find((s) => s.name === name)!;
const entry = (w: string, n: number, p: string[], r: string[] = [], at: Record<string, number> = {}): PhraseEntry => ({ w, n, at, p, r, e: [] });

describe("slotsAt", () => {
  it("マスを含む語の位置（2字語 1-2・3-4・5-6・6-7、3字語 5-7）", () => {
    expect(slotsAt(0).map((s) => s.name)).toEqual(["1-2"]);
    expect(slotsAt(3).map((s) => s.name)).toEqual(["3-4"]);
    expect(slotsAt(4).map((s) => s.name)).toEqual(["5-6", "5-7"]);
    expect(slotsAt(5).map((s) => s.name)).toEqual(["5-6", "6-7", "5-7"]);
    expect(slotsAt(6).map((s) => s.name)).toEqual(["6-7", "5-7"]);
  });
});

describe("slotPattern", () => {
  it("定型の○●は平仄、◐はそのまま、◎は平にする", () => {
    const a = analyze(gridOf(HN), fixtureData);
    // 転句の定型は ◐●◐○○●●
    expect(slotPattern(a, fixtureData, 2, slot("1-2"))).toBe("◐仄");
    expect(slotPattern(a, fixtureData, 2, slot("5-6"))).toBe("平仄");
    // 起句の定型は ◐○◐●●○◎
    expect(slotPattern(a, fixtureData, 0, slot("5-7"))).toBe("仄平平");
  });

  it("詩格の候補で定型が違う位置は◐（起句末が未入力：5字目は入韻型●、不入韻型◐）", () => {
    const a = analyze(gridOf(replaceAt(HN, 0, 6, "＿")), fixtureData);
    expect(slotPattern(a, fixtureData, 0, slot("5-6"))).toBe("◐平");
  });

  it("詩格が決まらなければ、すべて◐", () => {
    let lines = HN;
    for (let i = 0; i < 4; i++) lines = replaceAt(lines, i, 1, "＿");
    expect(slotPattern(analyze(gridOf(lines), fixtureData), fixtureData, 2, slot("5-7"))).toBe("◐◐◐");
  });
});

describe("searchFileNames", () => {
  it("平は h、仄は z、◐は h・z と、データにない字の q", () => {
    expect(searchFileNames("平仄")).toEqual(["2-hz"]);
    expect(searchFileNames("◐仄")).toEqual(["2-hz", "2-zz", "2-qz"]);
    expect(searchFileNames("仄◐平")).toEqual(["3-zhh", "3-zzh", "3-zqh"]);
  });
});

describe("rowsToEntries", () => {
  it("索引の行を語にし、同じ語が複数のファイルにあればパターンをまとめる", () => {
    const rhymes = [RHYME_A, RHYME_B];
    const slots = ["1-2", "3-4", "5-6", "6-7", "5-7"];
    const entries = rowsToEntries(
      [
        { name: "2-hz", rows: [["甲乙", 4, [1], [3, 0, 1, 0, 0]]] },
        { name: "2-zz", rows: [["甲乙", 4, [1], [3, 0, 1, 0, 0]], ["丙丁", 2, [], [0, 0, 0, 2, 0]]] },
      ],
      rhymes,
      slots,
    );
    expect(entries).toEqual([
      { w: "甲乙", n: 4, at: { "1-2": 3, "5-6": 1 }, p: ["平仄", "仄仄"], r: [RHYME_B], e: [] },
      { w: "丙丁", n: 2, at: { "6-7": 2 }, p: ["仄仄"], r: [], e: [] },
    ]);
  });
});

describe("slotCandidates", () => {
  const entries = [
    entry(P[20]! + Z[20]!, 9, ["平仄"]),
    entry(Z[21]! + Z[22]!, 7, ["仄仄"]),
    entry(P[20]! + P[21]!, 5, ["平平"]),
    entry(Z[23]! + Z[20]!, 3, ["仄仄"]),
  ];

  it("パターンに合う語を、出現回数の多い順に返す", () => {
    expect(slotCandidates(entries, { pattern: "◐仄", fixed: [null, null] }).map((e) => e.n)).toEqual([9, 7, 3]);
  });

  it("すでに入っている字と同じ位置に同じ字がある語だけを返す", () => {
    expect(slotCandidates(entries, { pattern: "◐仄", fixed: [null, Z[20]!] }).map((e) => e.n)).toEqual([9, 3]);
    expect(slotCandidates(entries, { pattern: "◐◐", fixed: [P[20]!, null] }).map((e) => e.n)).toEqual([9, 5]);
  });

  it("末字の韻目で絞り込む", () => {
    const rhymed = [entry(P[20]! + R[0]!, 4, ["平平"], [RHYME_A]), entry(P[21]! + R2[0]!, 6, ["平平"], [RHYME_B])];
    expect(slotCandidates(rhymed, { pattern: "平平", fixed: [null, null], rhyme: RHYME_A }).map((e) => e.n)).toEqual([4]);
  });

  it("語の位置がすべて埋まっていれば候補は出さない", () => {
    expect(slotCandidates(entries, { pattern: "◐仄", fixed: [P[20]!, Z[20]!] })).toEqual([]);
  });
});

describe("rhymeFor", () => {
  it("押韻の位置でなければ絞り込まない", () => {
    const c = constraintsAt(gridOf(HN), fixtureData, 2, 6);
    expect(rhymeFor(c, null)).toBeUndefined();
    expect(rhymeFor(c, RHYME_B)).toBeUndefined();
  });

  it("押韻の位置では、設定で選んだ韻目、なければほかの押韻字の韻目（一つに決まるとき）", () => {
    const c = constraintsAt(gridOf(HN), fixtureData, 3, 6);
    expect(rhymeFor(c, null)).toBe(RHYME_A);
    expect(rhymeFor(c, RHYME_B)).toBe(RHYME_B);
  });

  it("ほかの押韻字がなければ絞り込まない", () => {
    let lines = HN;
    for (const l of [0, 1, 3]) lines = replaceAt(lines, l, 6, "＿");
    expect(rhymeFor(constraintsAt(gridOf(lines), fixtureData, 3, 6), null)).toBeUndefined();
  });
});

describe("checkCandidates", () => {
  // 転句の5-6字目（定型は○●）を空ける
  const grid = gridOf(replaceAt(replaceAt(HN, 2, 4, "＿"), 2, 5, "＿"));
  const ok = entry(P[24]! + Z[24]!, 9, ["平仄"]);
  const ng = entry(Z[25]! + Z[26]!, 8, ["仄仄"]); // 5字目が仄：定型と違い、下三連（三仄）にもなる
  const dep = entry(RYO[1]! + Z[27]!, 7, ["平仄", "仄仄"]); // 両韻字：仄で読むと違反

  it("置くと違反が出る語は除いて数え、読みによって違反が出る語はそうと示す", () => {
    const r = checkCandidates([ok, ng, dep], grid, fixtureData, {}, 2, slot("5-6"));
    expect(r.shown.map((c) => [c.word, c.status])).toEqual([
      [ok.w, "ok"],
      [dep.w, "depends"],
    ]);
    expect(r.shown[1]!.dependent.length).toBeGreaterThan(0);
    expect([r.excluded, r.remaining]).toEqual([1, 0]);
  });

  it("limit 件そろったら調べるのをやめ、残りの件数を返す", () => {
    const r = checkCandidates([ok, ng, dep], grid, fixtureData, {}, 2, slot("5-6"), 1);
    expect(r.shown.map((c) => c.word)).toEqual([ok.w]);
    expect([r.excluded, r.remaining]).toEqual([0, 2]);
  });

  it("位置ごとの出現回数を付ける", () => {
    const withAt = { ...ok, at: { "1-2": 2, "5-6": 7 } };
    expect(checkCandidates([withAt], grid, fixtureData, {}, 2, slot("5-6")).shown[0]!.slotCount).toBe(7);
  });
});

describe("filledWord と findPhrase", () => {
  it("語の位置がすべて埋まっていれば、その語。未入力があれば null", () => {
    const grid = gridOf(HN);
    expect(filledWord(grid, 2, slot("5-7"))).toBe(grid.slice(18, 21).join(""));
    expect(filledWord(gridOf(replaceAt(HN, 2, 5, "＿")), 2, slot("5-7"))).toBeNull();
  });

  it("「々」は直前の字にして引く", () => {
    const grid = gridOf(HN);
    grid[15] = "々";
    expect(filledWord(grid, 2, slot("1-2"))).toBe(grid[14]! + grid[14]!);
  });

  it("頻度表のファイルから語を引く。なければ null", () => {
    const groups = { "2": [entry("甲乙", 3, ["平仄"])], "3": [entry("甲乙丙", 2, ["平仄平"])] };
    expect(findPhrase(groups, "甲乙")?.n).toBe(3);
    expect(findPhrase(groups, "甲乙丙")?.n).toBe(2);
    expect(findPhrase(groups, "甲丙")).toBeNull();
    expect(findPhrase(undefined, "甲乙")).toBeNull();
  });
});

describe("constraintView", () => {
  it("平・仄それぞれを置いたときに出る違反を、規則名つきで示す", () => {
    const c = constraintsAt(gridOf(replaceAt(HN, 2, 3, "＿")), fixtureData, 2, 3); // 転句4字目（定型は○）
    const v = constraintView(c, fixtureData);
    expect(v.required).toBe("平");
    const zi = v.options.find((o) => o.pz === "仄")!;
    expect(zi.ok).toBe(false);
    expect(zi.problems.some((p) => p.startsWith("定型との不一致："))).toBe(true);
    expect(v.options.find((o) => o.pz === "平")).toMatchObject({ ok: true, problems: [] });
  });
});
