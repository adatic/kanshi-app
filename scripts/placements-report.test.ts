// 詩語の配置結果を目で確かめるレポート（CLAUDE.md §8 M4 の完了条件）。
// PLACEMENTS_UPDATE=1 のときだけ data/reports/placements.md を書き出す（`npm run placements:update`）。`npm test` では最新であることを確かめる。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { analyze, constraintsAt, placementsFor, searchPhrases } from "../packages/engine/src/index";
import type { EngineData, Options, PhraseEntry, Placement } from "../packages/engine/src/types";
import { loadEngineData } from "../golden/golden";

const root = new URL("../", import.meta.url);
const data: EngineData = loadEngineData();
const index: { chars: Record<string, { file: string }> } = JSON.parse(readFileSync(new URL("data/phrases/index.json", root), "utf-8"));

/** 頻度表から語を引く（先頭の字のファイルだけを読む） */
function lookup(word: string): PhraseEntry | undefined {
  const info = index.chars[[...word][0]!];
  if (info === undefined) return undefined;
  const groups: Record<string, PhraseEntry[]> = JSON.parse(readFileSync(new URL(`data/phrases/${info.file}`, root), "utf-8"));
  return groups[String([...word].length)]?.find((e) => e.w === word);
}

const WORDS = ["雲雀", "薰風", "熏風", "春風", "明月", "寒山寺"];
const LINE_NAMES = ["起句", "承句", "転句", "結句"];
const MARK: Record<Placement["status"], string> = { ok: "○ 置ける", depends: "△ 読みによる", ng: "× 置けない", conflict: "— 字がある", invalid: "！ 入力エラー" };

const EMPTY = Array(4).fill("＿＿＿＿＿＿＿").join("\n");
const PARTIAL = ["昨夜風開露井桃", "未央前殿月輪高", "＿＿＿＿＿＿＿", "簾外春寒＿＿＿"].join("\n");

function wordSection(word: string): string[] {
  const e = lookup(word);
  const a = analyze(word, data);
  const readings = a.chars[0]!.map((c) => `${c.char}：${c.readings.length > 0 ? c.readings.map((r) => `${r.tone}・${r.rhyme}${r.note ?? ""}${r.via ? `（${r.via}として）` : ""}`).join("／") : "平仄データにない"}`);
  const out = [`### ${word}`, "", `- 平仄データ：${readings.join("　")}`];
  if (e === undefined) {
    out.push("- 頻度表：唐詩の用例なし（CLAUDE.md §4.4：表示するだけで、拒否しない）");
  } else {
    out.push(
      `- 頻度表：出現${e.n}回（${Object.entries(e.at).map(([s, n]) => `${s}字目 ${n}回`).join("、")}）、平仄パターン ${e.p.join("・")}、末字の韻目 ${e.r.join("・") || "なし"}`,
      ...e.e.map(([author, title, line]) => `  - 用例：${line}（${author}「${title}」）`),
    );
  }
  return [...out, ""];
}

function placementTable(word: string, poem: string, options: Options = {}): string[] {
  const ps = placementsFor(word, poem, data, options);
  const slots = [...new Set(ps.map((p) => p.slot))];
  const rows = [0, 1, 2, 3].map((l) => `| ${LINE_NAMES[l]} | ${slots.map((s) => MARK[ps.find((p) => p.line === l && p.slot === s)!.status]).join(" | ")} |`);
  const reasons = ps
    .filter((p) => p.status === "ng" || p.status === "depends")
    .map((p) => `- ${LINE_NAMES[p.line]}の${p.slot}字目：${(p.status === "ng" ? p.violations : p.dependent).map((f) => f.message).join(" ")}${p.status === "depends" ? "（一部の読みでだけ）" : ""}`);
  return [`**${word}**`, "", `| 句 | ${slots.map((s) => `${s}字目`).join(" | ")} |`, `|---|${slots.map(() => "---").join("|")}|`, ...rows, "", ...reasons, ""];
}

function render(): string {
  const partial = analyze(PARTIAL, data);
  const blanks: [number, number][] = [];
  partial.chars.forEach((row, l) => row.forEach((c, p) => c.status === "blank" && blanks.push([l, p])));
  const constraints = blanks.map(([l, p]) => {
    const c = constraintsAt(PARTIAL, data, l, p);
    const rhyme = c.rhyme.position ? `押韻の位置（韻目：${c.rhyme.groups.join("・") || "未定"}）` : "";
    const why = c.options.filter((o) => !o.ok).map((o) => `${o.pz}だと「${o.violations.map((f) => f.message).join(" ")}」`).join("。");
    return `| ${LINE_NAMES[l]}の${p + 1}字目 | ${c.required ?? "どちらでも"} | ${rhyme} | ${why} |`;
  });

  return [
    "# 詩語の配置結果",
    "",
    "`scripts/placements-report.test.ts` が生成する（`npm run placements:update`）。手で編集しない。",
    "",
    "CLAUDE.md §8 M4 の完了条件「『雲雀』『薰風』など数語で配置結果を目視確認できる」のためのレポート。判定はすべて規則エンジン（analyze）による。",
    "",
    "## 語の情報",
    "",
    ...WORDS.flatMap(wordSection),
    "## (A) 何も入っていない詩（平起式・首句入韻に固定）",
    "",
    "定型 `◐○◐●●○◎／◐●◐○◐●◎／◐●◐○○●●／◐○◐●●○◎`（data/forms.json）に、語だけを置いたときの結果。",
    "",
    ...WORDS.flatMap((w) => placementTable(w, EMPTY, { form: "heiki-nyuin" })),
    "## (B) 途中まで入っている詩",
    "",
    "王昌齡「春宮曲」（golden/input.json の q03）の転句と、結句の5〜7字目を空けたもの。詩格は自動判定。",
    "",
    "```",
    ...PARTIAL.split("\n").map((l, i) => `${l}  ${partial.symbols[i]}`),
    "```",
    "",
    `- 詩格：${partial.form.id ?? "未定"}${partial.form.note ? `（${partial.form.note}）` : ""}`,
    "",
    "### 空いているマスの制約（constraintsAt）",
    "",
    "| マス | 置ける平仄 | 押韻 | 置けない平仄の理由 |",
    "|---|---|---|---|",
    ...constraints,
    "",
    "### 語を置ける位置（placementsFor）",
    "",
    ...WORDS.flatMap((w) => placementTable(w, PARTIAL)),
    "### 空いているマスに合う詩語の例（searchPhrases）",
    "",
    ...searchExamples(),
  ].join("\n");
}

/** (B) の結句5〜7字目に合う3字語（制約の平仄パターンと押韻の韻目で検索）の上位5件 */
function searchExamples(): string[] {
  const cs = [4, 5, 6].map((p) => constraintsAt(PARTIAL, data, 3, p));
  const pattern = cs.map((c) => c.required ?? "◐").join("");
  const rhyme = cs[2]!.rhyme.groups[0];
  const all = Object.values(index.chars).flatMap(({ file }) => (JSON.parse(readFileSync(new URL(`data/phrases/${file}`, root), "utf-8")) as Record<string, PhraseEntry[]>)["3"] ?? []);
  const hits = searchPhrases(all, rhyme === undefined ? { pattern } : { pattern, rhyme }).slice(0, 5);
  return [
    `結句の5〜7字目：平仄パターン「${pattern}」${rhyme ? `、末字の韻目「${rhyme}」` : ""}で検索した上位5件（出現回数の多い順）。`,
    "",
    ...hits.map((e) => `- ${e.w}（${e.n}回。用例：${e.e[0]![2]}／${e.e[0]![0]}「${e.e[0]![1]}」）`),
    "",
  ];
}

it("data/reports/placements.md が最新の結果と一致する", () => {
  const url = new URL("data/reports/placements.md", root);
  const content = render();
  if (process.env.PLACEMENTS_UPDATE === "1") writeFileSync(url, content);
  expect(existsSync(url), "data/reports/placements.md がない。npm run placements:update で作る").toBe(true);
  expect(readFileSync(url, "utf-8")).toBe(content);
}, 60_000);
