// 規則ごとの適合例と違反例（CLAUDE.md §6.1）。
// 違反例は、律句どおりの基準の詩（forms.json の base）から意図的に1か所だけ崩したもの。
// 1か所崩すと連鎖して反応する規則もあるので、出る指摘を過不足なく突き合わせる。
import { describe, expect, it } from "vitest";
import { analyze } from "../src/index";
import type { Analysis, FormId, Options } from "../src/types";
import {
  KOKUJI,
  R2,
  SUPP,
  SUPP_MIX,
  UNKNOWN,
  baseLines,
  build,
  fixtureData,
  replaceAt,
} from "./fixture";

const run = (lines: string[], options: Options = {}) => analyze(build(...lines), fixtureData, options);

/** 「重み:規則:句:位置」の一覧（ok は除く） */
const issues = (a: Analysis) =>
  a.findings
    .filter((f) => f.severity !== "ok")
    .map((f) => `${f.severity}:${f.rule}:${f.line}:${f.positions.join(",")}`)
    .sort();

const FORMS: FormId[] = ["heiki-nyuin", "heiki-funyuin", "sokki-nyuin", "sokki-funyuin"];
const HN = baseLines("heiki-nyuin");
// HN = ○○●●●○◎ / ●●○○●●◎ / ●●○○○●● / ○○●●●○◎

describe("適合例：律句どおりの詩", () => {
  for (const id of FORMS) {
    it(`${id} は指摘なしで、詩格を自動判定する`, () => {
      const a = run(baseLines(id));
      expect(issues(a)).toEqual([]);
      expect(a.form).toEqual({ id, auto: true });
      expect(a.errors).toEqual([]);
      expect(a.interpretations).toHaveLength(1);
      expect(a.independent).toBe(false);
    });
  }
});

describe("pattern・ichisango-furon（定型）", () => {
  it("◐の位置の揺れは、許容される変格（一三五不論）だけ", () => {
    expect(issues(run(replaceAt(HN, 0, 0, "●")))).toEqual(["variant:ichisango-furon:0:0"]);
  });

  it("4字目を崩すと、定型との不一致・二四不同・孤平になる", () => {
    // 起句 ○○●●●○◎ → ○○●○●○◎
    expect(issues(run(replaceAt(HN, 0, 3, "○")))).toEqual([
      "violation:kohei:0:3",
      "violation:nishi-fudo:0:1,3",
      "violation:pattern:0:3",
    ]);
  });

  it("詩格を固定すると、自動判定より優先する", () => {
    const a = run(baseLines("heiki-funyuin"), { form: "sokki-funyuin" });
    expect(a.form).toEqual({ id: "sokki-funyuin", auto: false });
    expect(issues(a).filter((s) => s.includes(":pattern:")).length).toBeGreaterThan(0);
  });
});

describe("niroku-tsui（二六対）", () => {
  it("6字目を崩すと二六対の違反", () => {
    // 起句 ○○●●●○◎ → ○○●●●●◎
    expect(issues(run(replaceAt(HN, 0, 5, "●")))).toEqual(["violation:niroku-tsui:0:1,5", "violation:pattern:0:5"]);
  });
});

describe("hanpo-nenpo（反法・粘法）・youtai", () => {
  it("転句の2字目を崩すと、粘法と反法の違反、拗体の可能性（要確認）", () => {
    // 転句 ●●○○○●● → ●○○○○●●
    expect(issues(run(replaceAt(HN, 2, 1, "○")))).toEqual([
      "check:youtai:-1:",
      "violation:hanpo-nenpo:2:1",
      "violation:hanpo-nenpo:3:1",
      "violation:niroku-tsui:2:1,5",
      "violation:nishi-fudo:2:1,3",
      "violation:pattern:2:1",
    ]);
  });
});

describe("ka-sanren-hei・ka-sanren-soku（下三連）", () => {
  it("5〜7字目がすべて平なら三平の違反", () => {
    // 起句 ○○●●●○◎ → ○○●●○○◎
    expect(issues(run(replaceAt(HN, 0, 4, "○")))).toEqual(["violation:ka-sanren-hei:0:4,5,6", "violation:pattern:0:4"]);
  });

  it("5〜7字目がすべて仄なら三仄の要確認", () => {
    // 転句 ●●○○○●● → ●●○○●●●
    expect(issues(run(replaceAt(HN, 2, 4, "●")))).toEqual(["check:ka-sanren-soku:2:4,5,6", "violation:pattern:2:4"]);
  });

  it("重みは上書きできる", () => {
    const a = run(replaceAt(HN, 2, 4, "●"), { severities: { "ka-sanren-soku": "violation" } });
    expect(issues(a)).toContain("violation:ka-sanren-soku:2:4,5,6");
  });
});

describe("kohei（孤平）", () => {
  it("3字目を崩して4字目の平が仄に挟まれると孤平（3字目自体は一三五不論）", () => {
    // 承句 ●●○○●●◎ → ●●●○●●◎
    expect(issues(run(replaceAt(HN, 1, 2, "●")))).toEqual(["variant:ichisango-furon:1:2", "violation:kohei:1:3"]);
  });
});

describe("kohei（孤平）の境界", () => {
  it("4字目の平の左が仄でも、右（5字目）が平なら孤平ではない", () => {
    // 承句 ●●○○●●◎ → ●●●○○●◎（3字目と5字目はどちらも◐）
    const lines = replaceAt(replaceAt(HN, 1, 2, "●"), 1, 4, "○");
    expect(issues(run(lines))).toEqual(["variant:ichisango-furon:1:2", "variant:ichisango-furon:1:4"]);
  });
});

describe("hasami-hei（挟み平）", () => {
  it("押韻しない句の ○●● を ●○● に換えると、許容される変格だけ", () => {
    // 転句 ●●○○○●● → ●●○○●○●（挟み平という一つの置き換え）
    const lines = replaceAt(replaceAt(HN, 2, 4, "●"), 2, 5, "○");
    expect(issues(run(lines))).toEqual(["variant:hasami-hei:2:4,5,6"]);
  });

  it("句末が ○○● の句を ●○● にしても挟み平ではない（5字目の一三五不論）", () => {
    const HF = baseLines("heiki-funyuin"); // 起句 ○○●●○○●
    expect(issues(run(replaceAt(HF, 0, 4, "●")))).toEqual(["variant:ichisango-furon:0:4"]);
  });
});

describe("rhyme-tone・rhyme-group・kogan-nyugun（押韻）", () => {
  it("押韻字が仄なら押韻の声調の違反", () => {
    // 結句 ○○●●●○◎ → ○○●●●○●
    expect(issues(run(replaceAt(HN, 3, 6, "●")))).toEqual(["violation:rhyme-tone:3:6"]);
  });

  it("結句の押韻字だけ別の韻目なら韻目の違反", () => {
    expect(issues(run(replaceAt(HN, 3, 6, R2[0]!)))).toEqual(["violation:rhyme-group:3:6"]);
  });

  it("首句の押韻字だけ別の韻目なら孤雁入群格の可能性（要確認）", () => {
    expect(issues(run(replaceAt(HN, 0, 6, R2[0]!)))).toEqual(["check:kogan-nyugun:0:6"]);
  });

  it("結句の押韻字が未入力なら、承句・結句の一致を確かめられないので孤雁入群格にはせず、韻目の違反", () => {
    const lines = replaceAt(replaceAt(HN, 0, 6, R2[0]!), 3, 6, "＿");
    expect(issues(run(lines))).toEqual(["violation:rhyme-group:0:6"]);
  });

  it("承句の押韻字がデータにない字でも、孤雁入群格にはしない", () => {
    const lines = replaceAt(replaceAt(HN, 0, 6, R2[0]!), 1, 6, UNKNOWN);
    expect(issues(run(lines))).toEqual(["check:unknown-char:1:6", "violation:rhyme-group:0:6"]);
  });
});

describe("bou-in（冒韻）", () => {
  it("押韻位置以外に押韻と同じ韻目の字があると要確認", () => {
    // 転句の3字目（平）を、押韻と同じ韻目 A の字にする
    expect(issues(run(replaceAt(HN, 2, 2, "◎")))).toEqual(["check:bou-in:2:2"]);
  });
});

describe("douji（同字重出）", () => {
  it("同じ字が2回あれば、それぞれの句で要確認", () => {
    const text = build(...HN).split("\n");
    const first = [...text[0]!][0]!;
    text[3] = first + [...text[3]!].slice(1).join("");
    const a = analyze(text.join("\n"), fixtureData);
    expect(issues(a)).toEqual(["check:douji:0:0", "check:douji:3:0"]);
  });

  it("「々」の直前が未入力なら、「々」も未入力として扱う（離れた字は繰り返さない）", () => {
    const text = build(...HN).split("\n");
    text[0] = [...text[0]!].map((c, i) => (i === 1 ? "＿" : i === 2 ? "々" : c)).join("");
    const a = analyze(text.join("\n"), fixtureData);
    expect(a.chars[0]![2]!.status).toBe("blank");
    expect(a.errors).toEqual([]);
    expect(issues(a)).toEqual([]);
  });

  it("句頭の「々」と、漢字以外の直後の「々」はエラー", () => {
    const text = build(...HN).split("\n");
    text[1] = "々" + [...text[1]!].slice(1).join("");
    text[2] = [...text[2]!].map((c, i) => (i === 1 ? "・" : i === 2 ? "々" : c)).join("");
    const a = analyze(text.join("\n"), fixtureData);
    expect(a.errors.map((e) => [e.line, e.position, e.char])).toEqual([
      [1, 0, "々"],
      [2, 1, "・"],
      [2, 2, "々"],
    ]);
  });

  it("「々」は直前の字として扱い、同字重出として出す", () => {
    const text = build(...HN).split("\n");
    text[0] = [...text[0]!].map((c, i) => (i === 1 ? "々" : c)).join("");
    const a = analyze(text.join("\n"), fixtureData);
    expect(a.chars[0]![1]!.input).toBe("々");
    expect(a.chars[0]![1]!.char).toBe(a.chars[0]![0]!.char);
    expect(issues(a)).toEqual(["check:douji:0:0,1"]);
  });
});

describe("koku-ji・unknown-char（国字・データにない字）", () => {
  it("国字は違反。その位置の平仄は問わない", () => {
    expect(issues(run(replaceAt(HN, 2, 0, KOKUJI)))).toEqual(["violation:koku-ji:2:0"]);
  });

  it("国字はオプションで要確認に下げて続行できる", () => {
    expect(issues(run(replaceAt(HN, 2, 0, KOKUJI), { allowKokuji: true }))).toEqual(["check:koku-ji:2:0"]);
  });

  it("データにない字は要確認。その位置の平仄は問わない", () => {
    expect(issues(run(replaceAt(HN, 2, 0, UNKNOWN)))).toEqual(["check:unknown-char:2:0"]);
  });

  it("データにない字をオプションで平として扱うと、その平仄で判定する", () => {
    // 転句1字目は◐で律句は●。平として扱うと一三五不論の揺れになる
    expect(issues(run(replaceAt(HN, 2, 0, UNKNOWN), { unknownAs: "平" }))).toEqual([
      "check:unknown-char:2:0",
      "variant:ichisango-furon:2:0",
    ]);
  });
});

describe("supplement-reading（【詞】【辭】欄の読み）", () => {
  it("【詞】欄にだけある読みで判定した位置は要確認", () => {
    expect(issues(run(replaceAt(HN, 3, 6, SUPP)))).toEqual(["check:supplement-reading:3:6"]);
  });
});

describe("supplement-reading の境界", () => {
  it("同じ平仄の本体の読みもあれば、本体の読みで判定し、要確認にしない", () => {
    expect(issues(run(replaceAt(HN, 2, 2, SUPP_MIX)))).toEqual([]);
  });
});

describe("length（句数・字数）と入力エラー", () => {
  it("3句しかなければ句数の違反", () => {
    expect(issues(run(HN.slice(0, 3)))).toContain("violation:length:-1:");
  });

  it("6字の句は字数の違反", () => {
    const lines = [...HN];
    lines[1] = lines[1]!.slice(0, 6);
    expect(issues(run(lines))).toContain("violation:length:1:");
  });

  it("漢字以外の文字は位置つきのエラー（字数にも数える）", () => {
    const lines = [...HN];
    lines[0] = lines[0] + "，";
    const a = run(lines);
    expect(a.errors).toEqual([{ line: 0, position: 7, char: "，", message: expect.any(String) }]);
    expect(issues(a)).toContain("violation:length:0:");
    expect(a.symbols[0]!.at(-1)).toBe("×");
  });

  it("行の前後の空白も、漢字以外の文字として位置つきのエラーにする", () => {
    const text = build(...HN).split("\n");
    text[1] = " " + text[1]!;
    const a = analyze(text.join("\n"), fixtureData);
    expect(a.errors.map((e) => [e.line, e.position, e.char])).toEqual([[1, 0, " "]]);
  });

  it("テキストの前後の空行（字のない行）は無視する", () => {
    const text = "\n" + build(...HN) + "\n\n";
    const a = analyze(text, fixtureData);
    expect(issues(a)).toEqual([]);
    expect(a.errors).toEqual([]);
  });

  it("28マスの配列でも入力できる", () => {
    const cells = [...build(...HN).replaceAll("\n", "")];
    expect(cells).toHaveLength(28);
    expect(issues(analyze(cells, fixtureData))).toEqual([]);
  });
});

describe("未入力のマス（＿）", () => {
  it("未入力の句があっても、入っている字だけで判定する", () => {
    const lines = [...HN];
    lines[1] = "＿＿＿＿＿＿＿";
    const a = run(lines);
    expect(issues(a)).toEqual([]);
    expect(a.symbols[1]).toBe("＿＿＿＿＿＿＿");
    expect(a.chars[1]![0]!.status).toBe("blank");
  });

  it("首句の2字目が未入力なら、反法・粘法で他の句から起式を推定する", () => {
    const a = run(replaceAt(HN, 0, 1, "＿"));
    expect(a.form.id).toBe("heiki-nyuin");
    expect(a.form.note).toMatch(/推定/);
    expect(issues(a)).toEqual([]);
  });

  it("首句の末字が未入力なら、入韻・不入韻の両方の詩格で判定する", () => {
    const a = run(replaceAt(HN, 0, 6, "＿"));
    expect(a.interpretations.map((i) => i.form.id).sort()).toEqual(["heiki-funyuin", "heiki-nyuin"]);
    expect(a.form.note).toMatch(/入韻/);
  });

  it("入韻・不入韻のどちらでも違反になる位置は、全体の結果に残る（位置ごとに共通部分を取る）", () => {
    // 起句 ●●○●●●＿：仄起式の入韻では4字目だけ、不入韻では4字目と5字目が定型と不一致
    const blank = "＿＿＿＿＿＿＿";
    const a = run(["●●○●●●＿", blank, blank, blank]);
    expect(a.interpretations.map((i) => i.form.id).sort()).toEqual(["sokki-funyuin", "sokki-nyuin"]);
    expect(issues(a)).toContain("violation:pattern:0:3");
    expect(issues(a)).not.toContain("violation:pattern:0:4");
  });

  for (const id of ["heiki-nyuin", "heiki-funyuin", "sokki-nyuin", "sokki-funyuin"] as FormId[]) {
    it(`${id} の律句どおりの詩で首句の末字だけ未入力にしても、違反を断定しない`, () => {
      const a = run(replaceAt(baseLines(id), 0, 6, "＿"));
      expect(issues(a).filter((s) => s.startsWith("violation:"))).toEqual([]);
    });
  }

  it("どの句の2字目も未入力なら詩格は決めず、定型に依存する規則は判定しない", () => {
    let lines = HN;
    for (let i = 0; i < 4; i++) lines = replaceAt(lines, i, 1, "＿");
    const a = run(lines);
    expect(a.form.id).toBeNull();
    expect(issues(a).filter((s) => /:(pattern|ichisango-furon|hasami-hei):/.test(s))).toEqual([]);
  });
});
