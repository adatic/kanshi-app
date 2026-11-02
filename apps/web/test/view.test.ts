// 画面の表示の組み立て（apps/web/src/view.ts）。平仄は架空のデータで与える（CLAUDE.md §0）。
import { describe, expect, it } from "vitest";
import { analyze } from "@kanshi/engine";
import { buildView } from "../src/view";
import { KOKUJI, RHY2, RYO, UNKNOWN, baseLines, build, fixtureData, form, replaceAt } from "../../../packages/engine/test/fixture";

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

  it("データにない字は記号□で、作者が判断することに入る", () => {
    const v = view(replaceAt(HN, 2, 0, UNKNOWN));
    expect(v.lines[2]!.cells[0]).toEqual({ char: UNKNOWN, symbol: "□", status: "unknown", severity: "check" });
    expect(v.judgements.map((f) => [f.ruleName, f.where])).toEqual([["平仄データにない字", "転句の1字目"]]);
  });

  it("起句の末字が未入力で詩格が分かれるときは、詩格ごとに出る指摘を示す", () => {
    // 起句5字目を平に、末字を未入力に。入韻型では5字目が●（定型と不一致）、不入韻型では◐
    const v = view(replaceAt(replaceAt(HN, 0, 4, "○"), 0, 6, "＿"));
    expect(v.readingChoices).toEqual([]);
    const byForm = Object.fromEntries(v.formChoices.map((c) => [c.formName, c.always.map((f) => f.ruleName)]));
    expect(byForm["平起式・首句入韻"]).toContain("定型との不一致");
    expect(byForm["平起式・首句不入韻"]).not.toContain("定型との不一致");
    expect(v.formChoices.every((c) => c.sometimes.length === 0)).toBe(true); // 読みの分かれる字はない
  });

  it("詩格が分かれ、両韻字もあるときは、詩格の欄でも読みによって出る指摘を分けて示す", () => {
    // 起句4字目を両韻字（平・去）に、末字を未入力に。平の読みでだけ二四不同などの違反が出る
    const v = view(replaceAt(replaceAt(HN, 0, 3, RYO[0]!), 0, 6, "＿"));
    expect(v.formChoices).toHaveLength(2);
    // 平の読みで出る違反（どちらの詩格でも同じ）は、読み別の欄に「必ず出る」として出る
    const hei = v.readingChoices[0]!.options.find((o) => o.label === "平・上平二冬")!;
    // （定型の文言は詩格の名前を含むので、規則名で比べる）
    const heiOnly = hei.always.map((f) => f.ruleName);
    expect(heiOnly).toEqual(["定型との不一致", "二四不同", "孤平"]);
    for (const c of v.formChoices) {
      // 詩格の欄では、平の読みでだけ出る指摘を「必ず出る」に入れず、「読みによっては出る」に入れる
      expect(c.always.map((f) => f.ruleName).filter((m) => heiOnly.includes(m)), c.formName).toEqual([]);
      expect(c.sometimes.map((f) => f.ruleName), c.formName).toEqual(expect.arrayContaining(heiOnly));
    }
  });

  it("詩格が一つに決まる詩では、詩格ごとの欄は空", () => {
    expect(view(HN).formChoices).toEqual([]);
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
    const byLabel = Object.fromEntries(choice!.options.map((o) => [o.label, o.always.map((f) => f.severity)]));
    expect(byLabel).toEqual({ "平・上平二冬": ["violation", "violation", "violation"], "去・去声二宋": [] });
    expect(choice!.options.map((o) => o.clean)).toEqual([false, true]);
    expect(v.violations).toEqual([]); // 読みによる違反は、確定の違反には入れない
  });

  it("どの読みでも出る違反があれば、読みで加わる違反がなくても clean にしない", () => {
    // 両韻字に加えて、別の位置に国字（どの読みでも違反）
    const v = view(replaceAt(replaceAt(HN, 0, 3, RYO[0]!), 2, 0, KOKUJI));
    expect(v.violations.map((f) => f.rule)).toEqual(["koku-ji"]);
    const zi = v.readingChoices[0]!.options.find((o) => o.label === "去・去声二宋")!;
    expect([zi.always, zi.sometimes, zi.clean]).toEqual([[], [], false]);
  });

  it("一部の読みでだけ出る要確認も、読みごとの結果に出す", () => {
    // 起句末を、押韻で韻目 A と B の読みを持つ字にする（B なら孤雁入群格の可能性）
    const v = view(replaceAt(HN, 0, 6, RHY2));
    const options = v.readingChoices[0]!.options;
    const kogan = options.flatMap((o) => o.always).filter((f) => f.ruleName === "孤雁入群格の可能性");
    expect(kogan).toHaveLength(1);
    expect(kogan[0]!.severity).toBe("check");
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
