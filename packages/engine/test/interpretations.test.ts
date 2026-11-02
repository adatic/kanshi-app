// 両韻字・異体字の候補ごとの判定（CLAUDE.md §4.1「多音字・両韻字」）と、字の情報・記号列。
import { describe, expect, it } from "vitest";
import { analyze } from "../src/index";
import type { Analysis, Finding } from "../src/types";
import {
  KOKUJI,
  P,
  R,
  RHY2,
  RHYME_A,
  RHYME_B,
  RYO,
  UNKNOWN,
  VAR_ONE,
  VAR_TWO,
  Z,
  baseLines,
  build,
  fixtureData,
  replaceAt,
} from "./fixture";

const HN = baseLines("heiki-nyuin");
// HN = ○○●●●○◎ / ●●○○●●◎ / ●●○○○●● / ○○●●●○◎
const run = (lines: string[]) => analyze(build(...lines), fixtureData);
const keyOf = (f: Finding) => `${f.severity}:${f.rule}:${f.line}:${f.positions.join(",")}`;
const nonOk = (fs: Finding[]) => fs.filter((f) => f.severity !== "ok").map(keyOf).sort();
/** 解釈ごとに「選んだ読みの声調 → 指摘」 */
const byTone = (a: Analysis, index: number) =>
  Object.fromEntries(a.interpretations.map((i) => [i.readings[index]!.tone, nonOk(i.findings)]));

describe("両韻字（平と仄の両方の読みを持つ字）", () => {
  it("◐の位置なら、どちらの読みでも違反はなく、仄で読むと一三五不論の揺れ", () => {
    const a = run(replaceAt(HN, 0, 0, RYO[0]!)); // 起句1字目（律句は○）
    expect(a.chars[0]![0]!.readings.map((r) => r.tone)).toEqual(["平", "去"]);
    expect(a.symbols[0]![0]).toBe("◎");
    expect(byTone(a, 0)).toEqual({ 平: [], 去: ["variant:ichisango-furon:0:0"] });
    // 解釈によって違う指摘は、全体の findings には入れない
    expect(nonOk(a.findings)).toEqual([]);
  });

  it("4字目なら、平で読めば違反、仄で読めば適合（どちらかに決めない）", () => {
    const a = run(replaceAt(HN, 0, 3, RYO[0]!)); // 起句4字目（定型は●）
    expect(byTone(a, 3)).toEqual({
      平: ["violation:kohei:0:3", "violation:nishi-fudo:0:1,3", "violation:pattern:0:3"],
      去: [],
    });
    expect(nonOk(a.findings)).toEqual([]);
    const kohei = a.interpretations.flatMap((i) => i.findings).find((f) => f.rule === "kohei")!;
    expect(kohei.interpretation).toEqual({ 3: { tone: "平", rhyme: "上平二冬" } });
  });

  it("どの解釈にも共通する指摘は全体の findings に入る", () => {
    let lines = replaceAt(HN, 0, 0, RYO[0]!);
    lines = replaceAt(lines, 3, 6, "●"); // 結句の押韻字を仄に
    const a = run(lines);
    expect(a.interpretations).toHaveLength(2);
    expect(nonOk(a.findings)).toEqual(["violation:rhyme-tone:3:6"]);
  });

  it("首句の2字目が両韻字なら、解釈ごとに詩格が変わる", () => {
    const a = run(replaceAt(HN, 0, 1, RYO[0]!));
    const forms = Object.fromEntries(a.interpretations.map((i) => [i.readings[1]!.tone, i.form.id]));
    expect(forms).toEqual({ 平: "heiki-nyuin", 去: "sokki-nyuin" });
    expect(a.form.note).toMatch(/読み/);
  });
});

describe("押韻で韻目が複数ある字", () => {
  it("押韻の位置では韻目ごとに解釈を分ける", () => {
    const a = run(replaceAt(HN, 3, 6, RHY2));
    const byRhyme = Object.fromEntries(a.interpretations.map((i) => [i.readings[27]!.rhyme, nonOk(i.findings)]));
    expect(byRhyme).toEqual({ [RHYME_A]: [], [RHYME_B]: ["violation:rhyme-group:3:6"] });
  });

  it("押韻の位置以外では、同じ平仄の読みは一つの解釈にまとめる", () => {
    const a = run(replaceAt(HN, 2, 2, RHY2)); // 転句3字目（平）
    expect(a.interpretations).toHaveLength(1);
    // ただし冒韻は、どれかの読みが押韻と同じ韻目なら出す
    expect(nonOk(a.findings)).toEqual(["check:bou-in:2:2"]);
  });
});

describe("異体字の対応", () => {
  it("候補が一つなら、その字の読みで判定する（status は known、via に候補）", () => {
    const a = run(replaceAt(HN, 3, 6, VAR_ONE));
    const info = a.chars[3]![6]!;
    expect(info.status).toBe("known");
    expect(info.readings).toEqual([{ tone: "平", rhyme: RHYME_A, via: R[7] }]);
    expect(nonOk(a.findings)).toEqual([]);
  });

  it("候補が複数なら一つに決めず、候補ごとに解釈を分ける（status は undetermined）", () => {
    const a = run(replaceAt(HN, 0, 3, VAR_TWO)); // 起句4字目（定型は●）
    const info = a.chars[0]![3]!;
    expect(info.status).toBe("undetermined");
    expect(info.readings.map((r) => r.via)).toEqual([P[31], Z[31]]);
    const byVia = Object.fromEntries(a.interpretations.map((i) => [i.readings[3]!.via, nonOk(i.findings).length > 0]));
    expect(byVia).toEqual({ [P[31]!]: true, [Z[31]!]: false });
  });
});

describe("組み合わせが多すぎるとき", () => {
  it("2の10乗を超えたら位置ごとに独立して評価する", () => {
    // 両韻字を別々の11か所に置く → 2^11 通り（判定の結果ではなく、組み合わせの数を確かめる）
    const slots: [number, number][] = [
      [0, 0], [0, 2], [1, 0], [1, 2], [1, 4], [2, 0], [2, 2], [3, 0], [3, 2], [0, 4], [3, 4],
    ];
    let lines = HN;
    slots.forEach(([l, p], i) => (lines = replaceAt(lines, l, p, RYO[i]!)));
    const a = run(lines);
    expect(a.independent).toBe(true);
    // 両韻字の位置ごとに、平と仄の2通り
    expect(a.interpretations).toHaveLength(22);
    for (const i of a.interpretations) expect(Object.keys(i.readings)).toHaveLength(1);
  });

  it("2の10乗以下なら全部の組み合わせを作る", () => {
    const slots: [number, number][] = [[0, 0], [0, 2], [1, 0], [1, 2], [1, 4], [2, 0], [2, 2], [3, 0], [3, 2], [0, 4]];
    let lines = HN;
    slots.forEach(([l, p], i) => (lines = replaceAt(lines, l, p, RYO[i]!)));
    const a = run(lines);
    expect(a.independent).toBe(false);
    expect(a.interpretations).toHaveLength(1024);
  });
});

describe("字の情報と記号列（misima 互換）", () => {
  it("○平 ●仄 ◎両方 □データにない ■国字 ＿未入力 ×漢字以外", () => {
    const text = build("○●" + RYO[0] + UNKNOWN + KOKUJI + "＿・", ...HN.slice(1));
    const a = analyze(text, fixtureData);
    expect(a.symbols[0]).toBe("○●◎□■＿×");
    expect(a.chars[0]!.map((c) => c.status)).toEqual([
      "known",
      "known",
      "known",
      "unknown",
      "kokuji",
      "blank",
      "invalid",
    ]);
  });
});
