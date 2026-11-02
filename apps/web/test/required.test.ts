// 必須要素（apps/web/src/required.ts）。平仄は架空のデータで与える（CLAUDE.md §0）。
import { describe, expect, it } from "vitest";
import { requiredView, validateRequired } from "../src/required";
import { P, RYO, Z, baseLines, build, fixtureData, replaceAt } from "../../../packages/engine/test/fixture";

const HN = baseLines("heiki-nyuin");
// HN = ○○●●●○◎ / ●●○○●●◎ / ●●○○○●● / ○○●●●○◎
const gridOf = (lines: string[]) => [...build(...lines).replaceAll("\n", "")];
const BLANK_LINE = "＿＿＿＿＿＿＿";
/** 転句だけが未入力の詩（転句の定型は ◐●◐○○●●） */
const withBlankThird = () => gridOf([HN[0]!, HN[1]!, BLANK_LINE, HN[3]!]);

describe("validateRequired", () => {
  it("2字・3字の漢字の語を受け付ける", () => {
    expect(validateRequired(P[28]! + P[27]!, [])).toBeNull();
    expect(validateRequired(P[28]! + P[27]! + Z[29]!, [])).toBeNull();
    expect(validateRequired(` ${P[28]}${P[27]} `, [])).toBeNull(); // 前後の空白は無視する
  });

  it("それ以外は理由を返す", () => {
    expect(validateRequired("", [])).toBe("語を入れてください。");
    expect(validateRequired(P[28]!, [])).toBe("2字か3字の語を入れてください（1字）。");
    expect(validateRequired(P.slice(0, 4).join(""), [])).toBe("2字か3字の語を入れてください（4字）。");
    expect(validateRequired(`${P[28]}あ`, [])).toBe("漢字だけの語を入れてください（「あ」は漢字ではありません）。");
  });

  it("同じ語は二度登録しない。3語目は登録しない", () => {
    const w = P[28]! + P[27]!;
    expect(validateRequired(w, [w])).toBe("すでに登録しています。");
    expect(validateRequired(w, [P[1]! + P[2]!, P[3]! + P[4]!])).toBe("必須要素は2語までです。");
  });
});

describe("requiredView", () => {
  it("未入力の句の位置は、置ける・置けないを分け、ほかの句は重なる字として数える", () => {
    const v = requiredView(P[28]! + P[27]!, withBlankThird(), fixtureData, {}); // 平平
    expect(v.ok.map((p) => p.label)).toContain("転句の3-4字目"); // ◐○
    expect(v.ok.map((p) => p.label)).not.toContain("転句の5-6字目"); // ○● に平平は合わない
    expect(v.ng).toBeGreaterThan(0);
    expect(v.conflict).toBe(12); // 起句・承句・結句の4位置ずつ
    expect(v.present).toEqual([]);
  });

  it("字の読みによって違反が出る位置は、理由つきで分ける", () => {
    const v = requiredView(RYO[2]! + Z[29]!, withBlankThird(), fixtureData, {}); // 両韻字＋仄
    const dep = v.depends.find((p) => p.label === "転句の5-6字目");
    expect(dep).toBeDefined();
    expect(dep!.notes.length).toBeGreaterThan(0);
    expect(dep!.start).toBe(4);
    expect(dep!.line).toBe(2);
  });

  it("すでに詩に入っている語は、その位置を示し、ほかの数には入れない", () => {
    const word = P[28]! + P[27]!;
    const grid = withBlankThird();
    grid[16] = P[28]!;
    grid[17] = P[27]!;
    const v = requiredView(word, grid, fixtureData, {});
    expect(v.present.map((p) => p.label)).toEqual(["転句の3-4字目"]);
    expect(v.ok.map((p) => p.label)).not.toContain("転句の3-4字目");
  });

  it("埋まった詩では、入っていない語はどこにも置けない（すべて重なる）", () => {
    const v = requiredView(P[28]! + P[27]!, gridOf(HN), fixtureData, {});
    expect([v.ok, v.depends, v.ng, v.conflict, v.present]).toEqual([[], [], 0, 16, []]);
  });

  it("3字語は各句の5-7字目だけ", () => {
    const v = requiredView(P[28]! + P[27]! + Z[29]!, gridOf([HN[0]!, HN[1]!, BLANK_LINE, HN[3]!]), fixtureData, {});
    expect(v.conflict + v.ng + v.ok.length + v.depends.length + v.present.length).toBe(4);
  });
});
