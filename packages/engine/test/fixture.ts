// テスト用の架空データと、詩を組み立てる道具。
//
// CLAUDE.md §0 により、テストの期待値に実在の字の平仄を記憶で使わない。
// ここでは Unicode の決まった範囲の字に、テスト専用の平仄・韻目を機械的に割り当てる。
// 実在の字の平仄とは関係がない。定型（forms.json）と規則（rules.json）は本物を使う。
import { readFileSync } from "node:fs";
import type { EngineData, FormDef, FormId, Reading } from "../src/types";

const readJson = (path: string) => JSON.parse(readFileSync(new URL(`../../../data/${path}`, import.meta.url), "utf-8"));

export const realForms: EngineData["forms"] = readJson("forms.json");
export const realRules: EngineData["rules"] = readJson("rules.json");

const range = (start: number, count: number) => Array.from({ length: count }, (_, i) => String.fromCodePoint(start + i));

/** 平の字（韻目は押韻に使う韻目と別にして、冒韻にならないようにする） */
export const P = range(0x6000, 32);
/** 仄の字 */
export const Z = range(0x6100, 32);
/** 押韻用の平の字（韻目 A） */
export const R = range(0x6200, 8);
/** 押韻用の平の字（韻目 B） */
export const R2 = range(0x6210, 4);
/** 平と仄の両方の読みを持つ字（両韻字） */
export const RYO = range(0x6300, 16);

export const RHYME_A = "上平一東";
export const RHYME_B = "下平一先";
const PLAIN_P = "上平二冬";
const PLAIN_Z = "去声二宋";

/** 押韻で韻目 A と B の両方の読みを持つ平の字 */
export const RHY2 = String.fromCodePoint(0x6400);
/** 【詞】欄にだけ韻目 A の読みがある平の字 */
export const SUPP = String.fromCodePoint(0x6401);
/** 平の読みが本体と【詞】欄の両方にある字（韻目はどちらも押韻と別） */
export const SUPP_MIX = String.fromCodePoint(0x6402);
/** 異体字の対応で、押韻用の字 R[7] の一つだけにつながる字（自身はデータにない） */
export const VAR_ONE = String.fromCodePoint(0x6500);
/** 異体字の対応で、平の字 P[31] と仄の字 Z[31] の両方につながる字（自身はデータにない） */
export const VAR_TWO = String.fromCodePoint(0x6501);
/** 異体字の対応で、平の字 P[29] と P[30] の両方につながる字（同じ平仄の候補が2つ。自身はデータにない） */
export const VAR_SAME = String.fromCodePoint(0x6502);
/** 異体字の対応で、押韻用の字 R[6]（韻目 A）と平の字 P[28] の両方につながる字（どちらも平。自身はデータにない） */
export const VAR_BOU = String.fromCodePoint(0x6503);
/** データにない字 */
export const UNKNOWN = String.fromCodePoint(0x6600);
/** 国字（テストデータで国字として登録する字） */
export const KOKUJI = "峠";

const chars: EngineData["chars"] = {};
for (const c of P) chars[c] = [{ tone: "平", rhyme: PLAIN_P }];
for (const c of Z) chars[c] = [{ tone: "去", rhyme: PLAIN_Z }];
for (const c of R) chars[c] = [{ tone: "平", rhyme: RHYME_A }];
for (const c of R2) chars[c] = [{ tone: "平", rhyme: RHYME_B }];
for (const c of RYO) chars[c] = [{ tone: "平", rhyme: PLAIN_P }, { tone: "去", rhyme: PLAIN_Z }];
chars[RHY2] = [{ tone: "平", rhyme: RHYME_A }, { tone: "平", rhyme: RHYME_B }];
chars[SUPP] = [{ tone: "平", rhyme: RHYME_A, note: "【詞】" }];
chars[SUPP_MIX] = [
  { tone: "平", rhyme: "上平三江", note: "【詞】" },
  { tone: "平", rhyme: PLAIN_P },
];

export const fixtureData: EngineData = {
  chars,
  variants: { [VAR_ONE]: [R[7]!], [VAR_TWO]: [P[31]!, Z[31]!], [VAR_SAME]: [P[29]!, P[30]!], [VAR_BOU]: [R[6]!, P[28]!] },
  kokuji: { chars: [{ char: KOKUJI }] },
  forms: realForms,
  rules: realRules,
};

export const form = (id: FormId): FormDef => realForms.forms.find((f) => f.id === id)!;

/**
 * 記号で書いた4句から詩を組み立てる。字はすべて別の字になる（同字重出にならない）。
 *   ○ 平の字  ● 仄の字  ◎ 押韻用の字（韻目 A）  ＿ 未入力
 * それ以外の文字（RYO などの特別な字、句読点）はそのまま使う。
 */
export function build(...lines: string[]): string {
  let p = 0;
  let z = 0;
  let r = 0;
  return lines
    .map((line) =>
      [...line]
        .map((s) => (s === "○" ? P[p++]! : s === "●" ? Z[z++]! : s === "◎" ? R[r++]! : s))
        .join(""),
    )
    .join("\n");
}

/** 定型の base（律句どおり）を記号の4句にする。押韻する句の末字は◎。 */
export function baseLines(id: FormId): string[] {
  const f = form(id);
  return f.lines.map((l, i) => (f.rhymeLines.includes(i) ? l.base.slice(0, 6) + "◎" : l.base));
}

/** 記号の句の1字だけを差し替える */
export function replaceAt(lines: string[], line: number, pos: number, ch: string): string[] {
  return lines.map((l, i) => (i === line ? [...l].map((c, j) => (j === pos ? ch : c)).join("") : l));
}

export const reading = (tone: Reading["tone"], rhyme: string, extra: Partial<Reading> = {}): Reading => ({
  tone,
  rhyme,
  ...extra,
});
