// 画面の表示の組み立て（apps/web/src/view.ts）。平仄は架空のデータで与える（CLAUDE.md §0）。
import { describe, expect, it } from "vitest";
import { analyze } from "@kanshi/engine";
import { buildView } from "../src/view";
import { KOKUJI, RYO, baseLines, build, fixtureData, form, replaceAt } from "../../../packages/engine/test/fixture";

const HN = baseLines("heiki-nyuin");
// HN = ○○●●●○◎ / ●●○○●●◎ / ●●○○○●● / ○○●●●○◎
const view = (lines: string[]) => buildView(analyze(build(...lines), fixtureData), fixtureData);

describe("buildView", () => {
  it("律句どおりの詩：詩格の名前、句ごとの記号と平仄図式、指摘なし", () => {
    const v = view(HN);
    expect(v.form).toEqual({ name: "平起式・首句入韻", auto: true });
    expect(v.lines.map((l) => l.name)).toEqual(["起句", "承句", "転句", "結句"]);
    expect(v.lines.map((l) => l.cells.map((c) => c.symbol).join(""))).toEqual(HN.map((l) => l.replaceAll("◎", "○")));
    expect(v.lines.map((l) => l.pattern)).toEqual(form("heiki-nyuin").lines.map((l) => l.pattern));
    expect([v.violations, v.variants, v.judgements, v.readingChoices, v.errors]).toEqual([[], [], [], [], []]);
  });

  it("指摘を重みごとに分け、規則名と場所を日本語で付ける", () => {
    const v = view(replaceAt(HN, 0, 3, "○")); // 起句4字目を平に
    expect(v.violations.map((f) => [f.ruleName, f.where])).toEqual([
      ["定型との不一致", "起句の4字目"],
      ["二四不同", "起句の2字目・4字目"],
      ["孤平", "起句の4字目"],
    ]);
  });

  it("マスの重みは、そのマスに出ている指摘のうち一番重いもの", () => {
    const v = view(replaceAt(replaceAt(HN, 0, 3, "○"), 0, 0, "●"));
    const sev = v.lines[0]!.cells.map((c) => c.severity);
    expect(sev[0]).toBe("variant"); // 一三五不論の揺れ
    expect(sev[1]).toBe("violation"); // 二四不同
    expect(sev[3]).toBe("violation");
    expect(sev[2]).toBeNull();
  });

  it("要確認は「作者が判断すること」に入る（詩全体の指摘は「詩全体」）", () => {
    const v = view(replaceAt(HN, 2, 1, "○")); // 転句2字目：粘法の違反と拗体の可能性
    expect(v.judgements.map((f) => [f.ruleName, f.where])).toEqual([["拗体・不粘の可能性", "詩全体"]]);
  });

  it("国字の字はそのまま表示し、記号は■", () => {
    const v = view(replaceAt(HN, 2, 0, KOKUJI));
    expect(v.lines[2]!.cells[0]).toEqual({ char: KOKUJI, symbol: "■", status: "kokuji", severity: "violation" });
  });

  it("「々」は入力どおりに表示する", () => {
    const text = build(...HN).split("\n");
    text[0] = [...text[0]!].map((c, i) => (i === 1 ? "々" : c)).join("");
    const v = buildView(analyze(text.join("\n"), fixtureData), fixtureData);
    expect(v.lines[0]!.cells[1]!.char).toBe("々");
  });

  it("両韻字は、読みごとに出る違反を示す", () => {
    const v = view(replaceAt(HN, 0, 3, RYO[0]!)); // 起句4字目（定型は●）
    expect(v.readingChoices).toHaveLength(1);
    const [choice] = v.readingChoices;
    expect(choice!.cell).toBe(`起句の4字目「${RYO[0]}」`);
    const byLabel = Object.fromEntries(choice!.options.map((o) => [o.label, o.always.length]));
    expect(byLabel).toEqual({ "平・上平二冬": 3, "去・去声二宋": 0 });
    expect(v.violations).toEqual([]); // 読みによる違反は、確定の違反には入れない
  });

  it("入力エラーを文で返す", () => {
    const lines = [...HN];
    lines[0] = lines[0]!.slice(0, 6) + "・";
    expect(view(lines).errors).toEqual([expect.stringContaining("漢字ではありません")]);
  });

  it("詩格が決まらないときは、名前と平仄図式は null", () => {
    let lines = HN;
    for (let i = 0; i < 4; i++) lines = replaceAt(lines, i, 1, "＿");
    const v = view(lines);
    expect(v.form.name).toBeNull();
    expect(v.lines.every((l) => l.pattern === null)).toBe(true);
  });
});
