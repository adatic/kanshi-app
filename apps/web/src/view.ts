// エンジンの判定結果（Analysis）を、画面に出す形に組み立てる純関数（CLAUDE.md §4.2）。DOM には触れない。
import type { Analysis, CharStatus, EngineData, Finding, Reading, Severity } from "@kanshi/engine";

const LINE_NAMES = ["起句", "承句", "転句", "結句"];
export const lineName = (l: number) => LINE_NAMES[l] ?? `第${l + 1}句`;

const RANK: Record<Severity, number> = { ok: 0, variant: 1, check: 2, violation: 3 };

export type CellView = {
  char: string;
  /** misima 互換の記号（○●◎□■＿×） */
  symbol: string;
  status: CharStatus;
  /** このマスに出ている指摘のうち一番重いもの（全解釈に共通する指摘から） */
  severity: Severity | null;
};

export type LineView = {
  name: string;
  cells: CellView[];
  /** 平仄図式（○●◐◎）。詩格が決まらないときは null */
  pattern: string | null;
};

export type FindingView = {
  rule: string;
  ruleName: string;
  severity: Severity;
  /** 「起句の2字目・4字目」「詩全体」など */
  where: string;
  message: string;
};

export type ReadingOptionView = {
  /** 「平・上平二冬」「去・去声四寘【詞】」「平・上平一東（豔として）」 */
  label: string;
  /** この読みを選ぶと、ほかの字の読みにかかわらず出る違反 */
  always: string[];
  /** この読みを選ぶと、ほかの字の読みによっては出る違反 */
  sometimes: string[];
};

export type ReadingChoiceView = {
  /** 「起句の1字目「娉」」 */
  cell: string;
  options: ReadingOptionView[];
};

export type PoemView = {
  form: { name: string | null; auto: boolean; note?: string };
  lines: LineView[];
  violations: FindingView[];
  variants: FindingView[];
  /** 機械は判定しない、作者が判断すること（要確認の指摘） */
  judgements: FindingView[];
  /** 読みが複数ある字の、読みごとの結果（読みが一つに決まる詩では空） */
  readingChoices: ReadingChoiceView[];
  /** 組み合わせが多すぎて、位置ごとに独立して評価した */
  independent: boolean;
  /** 入力エラー（漢字以外の文字など） */
  errors: string[];
};

const where = (f: Finding) => (f.line < 0 ? "詩全体" : `${lineName(f.line)}の${f.positions.map((p) => `${p + 1}字目`).join("・")}`);

export const readingLabel = (r: Reading) =>
  `${r.tone}・${r.rhyme}${r.note ?? ""}${r.via !== undefined ? `（${r.via}として）` : ""}`;

const toFindingView = (data: EngineData) => (f: Finding): FindingView => ({
  rule: f.rule,
  ruleName: data.rules.rules[f.rule]?.name ?? f.rule,
  severity: f.severity,
  where: where(f),
  message: f.message,
});

/** 読みが複数ある字ごとに、読みを選んだ解釈に出る違反を「必ず出る」「組み合わせによって出る」に分ける */
function readingChoices(a: Analysis): ReadingChoiceView[] {
  if (a.interpretations.length < 2) return [];
  const common = new Set(a.findings.map((f) => `${f.rule}|${f.line}|${f.positions.join(",")}|${f.severity}`));
  const rows = a.interpretations.map((i) => ({
    readings: i.readings,
    violations: i.findings
      .filter((f) => f.severity === "violation" && !common.has(`${f.rule}|${f.line}|${f.positions.join(",")}|${f.severity}`))
      .map((f) => f.message),
  }));
  const positions = [...new Set(a.interpretations.flatMap((i) => Object.keys(i.readings).map(Number)))].sort((x, y) => x - y);
  return positions.map((n) => {
    const l = Math.floor(n / 7);
    const p = n % 7;
    const labels = [...new Set(rows.flatMap((r) => (r.readings[n] ? [readingLabel(r.readings[n]!)] : [])))];
    return {
      cell: `${lineName(l)}の${p + 1}字目「${a.chars[l]![p]!.char}」`,
      options: labels.map((label) => {
        const sets = rows.filter((r) => r.readings[n] && readingLabel(r.readings[n]!) === label).map((r) => [...new Set(r.violations)]);
        const always = sets.length === 0 ? [] : sets[0]!.filter((m) => sets.every((s) => s.includes(m)));
        const sometimes = [...new Set(sets.flat())].filter((m) => !always.includes(m));
        return { label, always, sometimes };
      }),
    };
  });
}

export function buildView(a: Analysis, data: EngineData): PoemView {
  const form = a.form.id === null ? null : (data.forms.forms.find((f) => f.id === a.form.id) ?? null);
  const severityAt = (l: number, p: number): Severity | null => {
    let best: Severity | null = null;
    for (const f of a.findings) {
      if (f.line !== l || !f.positions.includes(p) || f.severity === "ok") continue;
      if (best === null || RANK[f.severity] > RANK[best]) best = f.severity;
    }
    return best;
  };
  const lines: LineView[] = a.chars.map((row, l) => ({
    name: lineName(l),
    cells: row.map((c, p) => ({ char: c.input ?? c.char, symbol: a.symbols[l]![p] ?? "", status: c.status, severity: severityAt(l, p) })),
    pattern: form?.lines[l]?.pattern ?? null,
  }));
  const view = toFindingView(data);
  const by = (s: Severity) => a.findings.filter((f) => f.severity === s).map(view);
  return {
    form: { name: form?.name ?? null, auto: a.form.auto, ...(a.form.note !== undefined ? { note: a.form.note } : {}) },
    lines,
    violations: by("violation"),
    variants: by("variant"),
    judgements: by("check"),
    readingChoices: readingChoices(a),
    independent: a.independent,
    errors: a.errors.map((e) => e.message),
  };
}
