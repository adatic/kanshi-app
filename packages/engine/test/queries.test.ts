// 詩語の検索と、制約・配置の問い合わせ（CLAUDE.md §4.1「制約の問い合わせ」・§4.4）。
// 平仄は架空のデータ（fixture.ts）で与え、実在の字の平仄を記憶で使わない（CLAUDE.md §0）。
import { describe, expect, it } from "vitest";
import { constraintsAt, placementsFor, searchPhrases } from "../src/index";
import type { PhraseEntry } from "../src/types";
import { KOKUJI, P, R, RHYME_A, RYO, UNKNOWN, Z, baseLines, build, fixtureData, replaceAt } from "./fixture";

const HN = baseLines("heiki-nyuin");
// HN = ○○●●●○◎ / ●●○○●●◎ / ●●○○○●● / ○○●●●○◎
const BLANK = "＿＿＿＿＿＿＿";

const entry = (w: string, n: number, p: string[], r: string[] = []): PhraseEntry => ({ w, n, at: {}, p, r, e: [] });

describe("searchPhrases（詩語の検索）", () => {
  // 入力の並びは、出現回数・語の順と違えておく（並べ替えを確かめるため）
  const entries = [
    entry("甲乙", 5, ["平仄"], ["上平一東"]),
    entry("戊己", 9, ["平？"], []),
    entry("丙丁", 9, ["仄平", "平平"], ["下平一先"]),
    entry("庚辛壬", 3, ["平平仄"], ["去声一送"]),
  ];

  it("平仄パターンが合う語を、出現回数の多い順（同じなら語の順）に返す", () => {
    expect(searchPhrases(entries, { pattern: "平仄" }).map((e) => e.w)).toEqual(["甲乙"]);
  });

  it("読みが複数ある語は、ありうるパターンのどれかが合えば合う", () => {
    expect(searchPhrases(entries, { pattern: "平平" }).map((e) => e.w)).toEqual(["丙丁"]);
    expect(searchPhrases(entries, { pattern: "仄平" }).map((e) => e.w)).toEqual(["丙丁"]);
  });

  it("◐は平仄を問わない（データにない字の「？」にも合う）", () => {
    expect(searchPhrases(entries, { pattern: "平◐" }).map((e) => e.w)).toEqual(["丙丁", "戊己", "甲乙"]);
  });

  it("データにない字の「？」は、平や仄を指定した位置には合わない", () => {
    expect(searchPhrases(entries, { pattern: "平平" }).map((e) => e.w)).not.toContain("戊己");
  });

  it("字数がパターンと違う語は返さない", () => {
    expect(searchPhrases(entries, { pattern: "◐◐◐" }).map((e) => e.w)).toEqual(["庚辛壬"]);
  });

  it("含む字と末字の韻目で絞り込める", () => {
    expect(searchPhrases(entries, { pattern: "◐◐", contains: "丁" }).map((e) => e.w)).toEqual(["丙丁"]);
    expect(searchPhrases(entries, { pattern: "◐◐", rhyme: "上平一東" }).map((e) => e.w)).toEqual(["甲乙"]);
  });
});

describe("constraintsAt（その位置の制約）", () => {
  it("定型で仄の位置は、仄だけが置ける。平を置くと出る違反を返す", () => {
    const c = constraintsAt(build(...replaceAt(HN, 0, 3, "＿")), fixtureData, 0, 3);
    expect(c.required).toBe("仄");
    const byPz = Object.fromEntries(c.options.map((o) => [o.pz, o.violations.map((f) => f.rule).sort()]));
    expect(byPz).toEqual({ 平: ["kohei", "nishi-fudo", "pattern"], 仄: [] });
  });

  it("◐の位置は、平も仄も置ける", () => {
    const c = constraintsAt(build(...replaceAt(HN, 0, 0, "＿")), fixtureData, 0, 0);
    expect(c.required).toBeNull();
    expect(c.options.map((o) => [o.pz, o.ok])).toEqual([
      ["平", true],
      ["仄", true],
    ]);
  });

  it("押韻の位置は、ほかの押韻字の韻目を返し、仄は置けない", () => {
    const c = constraintsAt(build(...replaceAt(HN, 3, 6, "＿")), fixtureData, 3, 6);
    expect(c.required).toBe("平");
    expect(c.rhyme).toEqual({ position: true, groups: [RHYME_A] });
    const zi = c.options.find((o) => o.pz === "仄")!.violations;
    expect(zi.map((f) => f.rule)).toEqual(["rhyme-tone"]);
    // 判定に使った仮の字は文言に出さない
    expect(zi[0]!.message).toContain("「（置く字）」");
  });

  it("押韻の位置でない所は rhyme.position が false", () => {
    const c = constraintsAt(build(...replaceAt(HN, 2, 6, "＿")), fixtureData, 2, 6);
    expect(c.rhyme).toEqual({ position: false, groups: [] });
  });

  it("本文にデータにない字があっても、仮の字と取り違えない（離れたマスの判定が変わらない）", () => {
    // 起句4字目に、仮の字として選ばれうる最初の候補（拡張B領域の先頭）を置く
    const first = String.fromCodePoint(0x20000);
    expect(fixtureData.chars[first]).toBeUndefined();
    const withUnknown = build(...replaceAt(replaceAt(HN, 0, 3, first), 2, 0, "＿"));
    const c = constraintsAt(withUnknown, fixtureData, 2, 0); // 転句1字目は◐
    expect(c.required).toBeNull();
    expect(c.options.map((o) => [o.pz, o.ok])).toEqual([
      ["平", true],
      ["仄", true],
    ]);
  });

  it("今その位置に入っている字には左右されない", () => {
    const blank = constraintsAt(build(...replaceAt(HN, 0, 3, "＿")), fixtureData, 0, 3);
    const filled = constraintsAt(build(...replaceAt(HN, 0, 3, "○")), fixtureData, 0, 3);
    expect(filled).toEqual(blank);
  });
});

describe("placementsFor（語を置ける位置）", () => {
  const twoP = P[28]! + P[27]!; // 平平（架空）
  const poem = build(HN[0]!, HN[1]!, BLANK, HN[3]!); // 転句が未入力。転句の定型は ◐●◐○○●●

  it("2字語は各句の1-2・3-4・5-6・6-7字目、3字語は5-7字目だけを候補にする", () => {
    expect(placementsFor(twoP, poem, fixtureData).map((p) => `${p.line}:${p.slot}`)).toEqual(
      [0, 1, 2, 3].flatMap((l) => ["1-2", "3-4", "5-6", "6-7"].map((s) => `${l}:${s}`)),
    );
    const three = P[28]! + P[27]! + Z[30]!;
    expect(placementsFor(three, poem, fixtureData).map((p) => `${p.line}:${p.slot}`)).toEqual(["0:5-7", "1:5-7", "2:5-7", "3:5-7"]);
  });

  it("at で句と位置を一つに絞ると、その位置の結果だけを、全部を調べたときと同じ内容で返す", () => {
    const all = placementsFor(twoP, poem, fixtureData);
    for (const p of all) {
      expect(placementsFor(twoP, poem, fixtureData, {}, { line: p.line, slot: p.slot })).toEqual([p]);
    }
    // 語の字数に合わない位置（2字語の 5-7）や、範囲外の句は空
    expect(placementsFor(twoP, poem, fixtureData, {}, { line: 2, slot: "5-7" })).toEqual([]);
    expect(placementsFor(twoP, poem, fixtureData, {}, { line: 4, slot: "1-2" })).toEqual([]);
  });

  it("未入力の句で、定型に合う位置は置ける、合わない位置は理由つきで置けない", () => {
    const at = Object.fromEntries(placementsFor(twoP, poem, fixtureData).filter((p) => p.line === 2).map((p) => [p.slot, p]));
    expect(at["3-4"]!.status).toBe("ok"); // ◐○ に 平平
    expect(at["1-2"]!.status).toBe("ng"); // ◐● に 平平：2字目が定型と違う
    expect(at["1-2"]!.violations.map((f) => f.rule)).toContain("pattern");
    expect(at["6-7"]!.status).toBe("ng"); // ●● に 平平
  });

  it("すでにある別の字と重なる位置は conflict（置いて判定はしない）", () => {
    const p = placementsFor(twoP, poem, fixtureData).find((x) => x.line === 0 && x.slot === "1-2")!;
    expect(p.status).toBe("conflict");
    expect(p.conflicts).toEqual([0, 1]);
  });

  it("すでに同じ字が入っている位置は、食い違いにしない", () => {
    const text = build(...HN).split("\n");
    const word = [...text[0]!].slice(0, 2).join(""); // 起句の1-2字目そのもの
    const p = placementsFor(word, text.join("\n"), fixtureData).find((x) => x.line === 0 && x.slot === "1-2")!;
    expect(p.status).toBe("ok");
    expect(p.conflicts).toEqual([]);
  });

  it("読みによって違反が出る語は depends", () => {
    // 転句4字目（定型○）に両韻字が来る置き方：3-4字目に「平の字＋両韻字」
    const word = P[28]! + RYO[5]!;
    const p = placementsFor(word, poem, fixtureData).find((x) => x.line === 2 && x.slot === "3-4")!;
    expect(p.status).toBe("depends");
    expect(p.violations).toEqual([]);
    expect(p.dependent.length).toBeGreaterThan(0);
  });

  it("データにない字を含む語は、その字の平仄を問わずに判定する", () => {
    const p = placementsFor(P[28]! + UNKNOWN, poem, fixtureData).find((x) => x.line === 2 && x.slot === "3-4")!;
    expect(p.status).toBe("ok");
  });

  it("漢字以外を含む語は invalid で、置いたマスの位置と理由を返す", () => {
    for (const word of ["ab", P[28]! + " ", P[28]! + "、"]) {
      const p = placementsFor(word, poem, fixtureData).find((x) => x.line === 2 && x.slot === "3-4")!;
      expect(p.status, word).toBe("invalid");
      expect(p.errors.length, word).toBeGreaterThan(0);
      expect(p.errors.every((e) => e.line === 2 && (e.position === 2 || e.position === 3)), word).toBe(true);
    }
  });

  it("改行を含む語も invalid で、句の区切りとしては扱わない", () => {
    const empty = Array(4).fill(BLANK).join("\n");
    const p = placementsFor(P[28]! + "\n", empty, fixtureData, { form: "heiki-nyuin" }).find((x) => x.line === 2 && x.slot === "3-4")!;
    expect(p.status).toBe("invalid");
    expect(p.errors.map((e) => [e.line, e.position])).toEqual([[2, 3]]);
  });

  it("「＿」を含む語も invalid", () => {
    const p = placementsFor(P[28]! + "＿", poem, fixtureData).find((x) => x.line === 2 && x.slot === "3-4")!;
    expect(p.status).toBe("invalid");
    expect(p.errors.map((e) => e.position)).toEqual([3]);
  });

  it("国字を含む語は既定では置けず、国字で続行するオプションでは置ける", () => {
    const word = P[28]! + KOKUJI;
    const ng = placementsFor(word, poem, fixtureData).find((x) => x.line === 2 && x.slot === "3-4")!;
    expect(ng.status).toBe("ng");
    expect(ng.violations.map((f) => f.rule)).toEqual(["koku-ji"]);
    const ok = placementsFor(word, poem, fixtureData, { allowKokuji: true }).find((x) => x.line === 2 && x.slot === "3-4")!;
    expect(ok.status).toBe("ok");
  });

  it("押韻の位置に置く3字語は、韻目も確かめる", () => {
    const poem2 = build(HN[0]!, HN[1]!, HN[2]!, HN[3]!.slice(0, 4) + "＿＿＿");
    const ok = placementsFor(Z[30]! + P[28]! + R[7]!, poem2, fixtureData).find((x) => x.line === 3)!;
    expect(ok.status).toBe("ok");
    const ng = placementsFor(Z[30]! + P[28]! + P[27]!, poem2, fixtureData).find((x) => x.line === 3)!;
    expect(ng.status).toBe("ng");
    expect(ng.violations.map((f) => f.rule)).toContain("rhyme-group");
  });
});
