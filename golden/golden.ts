// ゴールデンテスト（CLAUDE.md §6.2）：唐詩三百首の七言絶句をエンジンに通し、
// スナップショット・レポート・人間の確認を求める一覧を作る。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { analyze } from "../packages/engine/src/index";
import type { Analysis, EngineData, Finding, Reading } from "../packages/engine/src/types";

export const root = new URL("../", import.meta.url);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, root), "utf-8"));

export type GoldenPoem = {
  id: string;
  group: string;
  included: boolean;
  title: string;
  author: string;
  lines: string[] | null;
  source: { file: string; index: number; title: string; score: number } | null;
  diffs: { selection: [number, string, string][] | null; crosscheck: [number, string, string][] | null };
};

export type Exception = {
  poem: string;
  /** 規則外として正当とする違反（「規則:句:位置」） */
  findings: string[];
  category: string;
  reason: string;
  evidence: string[];
  needsReview: boolean;
  question?: string;
  /** 人間が規則外として承認した記録 */
  approved?: string;
};

export type Question = { title: string; detail: string; options: string[] };

export function loadEngineData(): EngineData {
  return {
    chars: readJson("data/chars.json"),
    variants: readJson("data/variants.json"),
    kokuji: readJson("data/kokuji.json"),
    forms: readJson("data/forms.json"),
    rules: readJson("data/rules.json"),
  };
}

export const loadInput = () => readJson<{ poems: GoldenPoem[] }>("golden/input.json").poems.filter((p) => p.included);
export const loadExceptions = () => readJson<{ exceptions: Exception[] }>("golden/exceptions.json").exceptions;
export const loadQuestions = () => readJson<{ questions: Question[] }>("golden/questions.json").questions;

/** 指摘の鍵「規則:句:位置」 */
export const keyOf = (f: Finding) => `${f.rule}:${f.line}:${f.positions.join(",")}`;
const fullKey = (f: Finding) => `${f.severity}:${keyOf(f)}`;

export type GoldenResult = { poem: GoldenPoem; analysis: Analysis };

export function runGolden(): GoldenResult[] {
  const data = loadEngineData();
  return loadInput().map((poem) => ({ poem, analysis: analyze(poem.lines!.join("\n"), data) }));
}

/** 全解釈に共通する「明確な違反」の鍵 */
export const violationsOf = (a: Analysis) => a.findings.filter((f) => f.severity === "violation").map(keyOf).sort();

/** 読みを1つの文字列にする（「字=声調・韻目【詞】→異体字」） */
const readingLabel = (c: string, r: Reading) => `${c}=${r.tone}${r.rhyme}${r.note ?? ""}${r.via ? `→${r.via}` : ""}`;

/** 読みの選択肢・選択ごとの指摘・全解釈のダイジェストをまとめる。 */
function snapshotInterpretations(a: Analysis) {
  const charAt = (i: number) => a.chars[Math.floor(i / 7)]![i % 7]!.char;
  const options = new Map<number, Set<string>>();
  for (const i of a.interpretations)
    for (const [index, r] of Object.entries(i.readings)) {
      const n = Number(index);
      options.set(n, (options.get(n) ?? new Set()).add(readingLabel(charAt(n), r)));
    }
  const positions = [...options.keys()].sort((x, y) => x - y);
  const choices = Object.fromEntries(positions.map((n) => [n, [...options.get(n)!].sort()]));

  const common = new Set(a.findings.map(fullKey));
  const rows = a.interpretations.map((i) => ({
    picks: Object.fromEntries(Object.entries(i.readings).map(([n, r]) => [n, readingLabel(charAt(Number(n)), r)])),
    form: i.form.id,
    findings: i.findings.filter((f) => f.severity !== "ok").map(fullKey).filter((k) => !common.has(k)).sort(),
  }));

  const byChoice: Record<string, Record<string, { always: string[]; sometimes: string[] }>> = {};
  for (const n of positions) {
    byChoice[n] = {};
    for (const label of choices[n]!) {
      const sets = rows.filter((r) => r.picks[n] === label).map((r) => r.findings.filter((k) => !k.startsWith("variant:")));
      const always = sets.length === 0 ? [] : sets[0]!.filter((k) => sets.every((s) => s.includes(k)));
      const sometimes = [...new Set(sets.flat())].filter((k) => !always.includes(k)).sort();
      byChoice[n]![label] = { always, sometimes };
    }
  }
  const canonical = rows
    .map((r) => JSON.stringify([positions.map((n) => r.picks[n] ?? "-"), r.form, r.findings]))
    .sort()
    .join("\n");

  return {
    choices,
    byChoice,
    interpretationsDigest: createHash("sha256").update(canonical).digest("hex"),
  };
}

/**
 * スナップショット：判定の結果だけ（文言は入れない。文言の変更はレポートの差分で見る）。
 * 読みと判定の対応を、小さくしたうえで漏れなく捉える：
 * - choices：読みが分かれる位置（句×7＋位置）ごとの選択肢
 * - byChoice：位置と選択肢ごとに、その読みを選んだ解釈に「必ず出る」違反・要確認（always）と「組み合わせによって出る」もの（sometimes）。
 *   全解釈に共通する指摘（詩の findings）は除く。CLAUDE.md §4.1「この字を平で読めば適合、仄で読めば孤平」の形
 * - interpretationsDigest：全解釈の（読みの選択・詩格・指摘）の一覧の SHA-256。対応が1か所でも変われば値が変わる
 */
export function toSnapshot(results: GoldenResult[]) {
  return {
    description:
      "ゴールデンテストの判定結果のスナップショット（golden/golden.test.ts が GOLDEN_UPDATE=1 のときだけ書き出す）。差分が出たら理由を説明する。一括更新は人間の承認が要る（CLAUDE.md §0）。",
    poems: results.map(({ poem, analysis: a }) => ({
      id: poem.id,
      title: poem.title,
      author: poem.author,
      form: a.form,
      symbols: a.symbols,
      independent: a.independent,
      findings: a.findings.filter((f) => f.severity !== "ok").map(fullKey).sort(),
      interpretations: a.interpretations.length,
      ...snapshotInterpretations(a),
    })),
  };
}

const SEVERITY_JA: Record<string, string> = { violation: "違反", check: "要確認", variant: "変格" };
const count = (a: Analysis, severity: string) => a.findings.filter((f) => f.severity === severity).length;

export function renderReport(results: GoldenResult[], exceptions: Exception[]): string {
  const byPoem = new Map(exceptions.map((e) => [e.poem, e]));
  const withViolation = results.filter((r) => count(r.analysis, "violation") > 0);
  const ruleCounts = new Map<string, number>();
  for (const { analysis } of results)
    for (const f of analysis.findings)
      if (f.severity !== "ok") ruleCounts.set(`${SEVERITY_JA[f.severity]}・${f.rule}`, (ruleCounts.get(`${SEVERITY_JA[f.severity]}・${f.rule}`) ?? 0) + 1);

  const unknown = new Map<string, string[]>();
  const supplement: string[] = [];
  for (const { poem, analysis } of results) {
    for (const f of analysis.findings) {
      if (f.rule === "unknown-char") {
        const c = analysis.chars[f.line]![f.positions[0]!]!.char;
        unknown.set(c, [...(unknown.get(c) ?? []), poem.id]);
      }
      if (f.rule === "supplement-reading") supplement.push(`${poem.id}：${f.message}`);
    }
  }

  const out = [
    "# ゴールデンテストの結果",
    "",
    "`golden/golden.test.ts` が生成する（`npm run golden:update`）。手で編集しない。",
    "",
    "- 対象：唐詩三百首の七言絶句51首（本文は `golden/input.json`。出典は DATA_SOURCES.md の 6）",
    "- 判定の重みは `data/rules.json` の既定値。読みが複数ある字は、全解釈に共通する指摘だけを「判定」に数える",
    "",
    "## 概要",
    "",
    "| 項目 | 件数 |",
    "|---|---|",
    `| 対象の詩 | ${results.length}首 |`,
    `| 明確な違反なし（参考。目標ではない） | ${results.length - withViolation.length}首 |`,
    `| 明確な違反あり | ${withViolation.length}首（すべて分類済み：${[...new Set(withViolation.map((r) => byPoem.get(r.poem.id)?.category ?? "未分類"))].join("／")}） |`,
    `| 人間の確認を求める詩（golden/needs-review.md） | ${exceptions.filter((e) => e.needsReview).length}首 |`,
    "",
    "### 指摘の内訳（全解釈に共通するもの）",
    "",
    "| 重み・規則 | 件数 |",
    "|---|---|",
    ...[...ruleCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `| ${k} | ${n} |`),
    "",
    "## 詩ごとの判定",
    "",
    "| ID | 題 | 作者 | 詩格 | 記号列 | 違反 | 要確認 | 変格 | 違反の分類 |",
    "|---|---|---|---|---|---|---|---|---|",
    ...results.map(({ poem, analysis: a }) => {
      const v = count(a, "violation");
      return `| ${poem.id} | ${poem.title} | ${poem.author} | ${a.form.id ?? "未定"} | ${a.symbols.join("／")} | ${v} | ${count(a, "check")} | ${count(a, "variant")} | ${v > 0 ? (byPoem.get(poem.id)?.category ?? "**未分類**") : "—"} |`;
    }),
    "",
    "## 明確な違反が出た詩",
    "",
  ];
  for (const { poem, analysis: a } of withViolation) {
    const e = byPoem.get(poem.id);
    out.push(`### ${poem.id} ${poem.title}（${poem.author}）`, "", "```", ...poem.lines!.map((l, i) => `${l}  ${a.symbols[i]}`), "```", "");
    out.push(`- 詩格：${a.form.id ?? "未定"}${a.form.note ? `（${a.form.note}）` : ""}`);
    for (const f of a.findings.filter((f) => f.severity === "violation")) out.push(`- 違反：${f.message}`);
    out.push(`- 分類：${e?.category ?? "**未分類**"}${e?.needsReview ? "（人間の確認を求める）" : ""}`);
    if (e) out.push(`- 理由：${e.reason}`, ...e.evidence.map((x) => `  - ${x}`));
    if (e?.approved) out.push(`- 承認：${e.approved}`);
    out.push("");
  }
  out.push(
    "## 平仄データにない字（要確認）",
    "",
    "判定では要確認として扱い、その位置の平仄は問わない。データの抜けか異体字の対応の不足かは、M3 の範囲では直さず一覧にする。",
    "",
    "| 字 | 出てくる詩 |",
    "|---|---|",
    ...[...unknown].map(([c, ids]) => `| ${c} | ${ids.join("、")} |`),
    "",
    "## 【詞】【辭】欄にだけある読みで判定した箇所（要確認）",
    "",
    ...supplement.map((s) => `- ${s}`),
    "",
  );
  return out.join("\n");
}

export function renderNeedsReview(exceptions: Exception[], questions: Question[], results: GoldenResult[]): string {
  const byId = new Map(results.map((r) => [r.poem.id, r]));
  const out = [
    "# 人間の確認を求める事項（M3）",
    "",
    "`golden/golden.test.ts` が `golden/exceptions.json` と `golden/questions.json` から生成する（`npm run golden:update`）。手で編集しない。",
    "",
    "Claude Code は平仄・韻の正誤を記憶で判断しない（CLAUDE.md §0）。以下は、平水韻データと本文の版の違いからは分類を確定できない、または判断が仕様・データの出どころに関わる事項。",
    "",
    "## 詩の分類",
    "",
  ];
  const pending = exceptions.filter((x) => x.needsReview);
  if (pending.length === 0) out.push("（なし）", "");
  for (const e of pending) {
    const r = byId.get(e.poem);
    out.push(`### ${e.poem} ${r?.poem.title ?? ""}（${r?.poem.author ?? ""}）`, "");
    if (r) out.push("```", ...r.poem.lines!.map((l, i) => `${l}  ${r.analysis.symbols[i]}`), "```", "");
    out.push(`- 仮の分類：${e.category}`, `- 理由：${e.reason}`, ...e.evidence.map((x) => `  - ${x}`));
    if (e.question) out.push(`- 確認したいこと：${e.question}`);
    out.push("");
  }
  out.push("## そのほかの判断事項", "");
  if (questions.length === 0) out.push("（なし）", "");
  for (const q of questions) {
    out.push(`### ${q.title}`, "", q.detail, "", ...q.options.map((o) => `- ${o}`), "");
  }
  return out.join("\n");
}
