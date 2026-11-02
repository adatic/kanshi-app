// 実データ（data/）を読み込んで動くことを確かめる。期待値は記憶ではなく data/ から引く（CLAUDE.md §0）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze } from "../src/index";
import type { EngineData } from "../src/types";

const readJson = (path: string) => JSON.parse(readFileSync(new URL(`../../../data/${path}`, import.meta.url), "utf-8"));
const data: EngineData = {
  chars: readJson("chars.json"),
  variants: readJson("variants.json"),
  kokuji: readJson("kokuji.json"),
  forms: readJson("forms.json"),
  rules: readJson("rules.json"),
};

const entries = Object.entries(data.chars);
const isP = (t: string) => t === "平";
/** 本体の読みが一つだけで、平仄が pz の字を、まだ使っていないものから取る。rhyme を渡すとその韻目に、avoid を渡すとそれ以外の韻目に限る */
function picker() {
  const used = new Set<string>();
  return (pz: "平" | "仄", opts: { rhyme?: string; avoid?: string } = {}) => {
    const hit = entries.find(
      ([c, rs]) =>
        !used.has(c) &&
        rs.length === 1 &&
        rs[0]!.note === undefined &&
        isP(rs[0]!.tone) === (pz === "平") &&
        (opts.rhyme === undefined || rs[0]!.rhyme === opts.rhyme) &&
        (opts.avoid === undefined || rs[0]!.rhyme !== opts.avoid),
    )!;
    used.add(hit[0]);
    return hit[0];
  };
}

describe("実データでの動作", () => {
  it("律句どおりに data/ から字を選んで作った詩は、どの定型でも指摘なし", () => {
    for (const form of data.forms.forms) {
      const pick = picker();
      const rhyme = entries.find(([, rs]) => rs.length === 1 && isP(rs[0]!.tone) && !rs[0]!.note)![1][0]!.rhyme;
      const lines = form.lines.map((l, i) =>
        [...l.base]
          .map((s, pos) =>
            pos === 6 && form.rhymeLines.includes(i)
              ? pick("平", { rhyme })
              : pick(s === "○" ? "平" : "仄", { avoid: rhyme }), // 冒韻にならないよう押韻と別の韻目から
          )
          .join(""),
      );
      const a = analyze(lines.join("\n"), data);
      expect(a.findings.filter((f) => f.severity !== "ok"), `${form.id}: ${lines.join("/")}`).toEqual([]);
      expect(a.form).toEqual({ id: form.id, auto: true });
    }
  });

  it("平と仄の両方の読みを持つ字は◎、国字は■、異体字は候補の字の読みで引く", () => {
    const ryo = entries.find(([, rs]) => rs.some((r) => isP(r.tone)) && rs.some((r) => !isP(r.tone)))![0];
    const kokuji = data.kokuji.chars[0]!.char;
    const [variantKey, [target]] = Object.entries(data.variants).find(
      ([k, v]) => v.length === 1 && !(k in data.chars),
    )! as [string, string[]];
    const a = analyze([ryo, kokuji, variantKey].join(""), data);
    expect(a.symbols[0]!.slice(0, 2)).toBe("◎■");
    expect(a.chars[0]![2]!.readings).toEqual(data.chars[target!]!.map((r) => ({ ...r, via: target })));
  });
});
