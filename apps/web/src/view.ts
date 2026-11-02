// エンジンの判定結果（Analysis）を、画面に出す形に組み立てる純関数（CLAUDE.md §4.2）。DOM には触れない。
import type { Analysis, CharStatus, EngineData, Finding, Options, PZ, Reading, Severity } from "@kanshi/engine";

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

/** 読みによって出る指摘（違反と要確認） */
export type ReadingFindingView = { severity: "violation" | "check"; ruleName: string; message: string };

export type ReadingOptionView = {
  /** 「平・上平二冬」「去・去声四寘【詞】」「平・上平一東（豔として）」 */
  label: string;
  /** この読みを選ぶと、ほかの字の読みにかかわらず出る指摘（どの読みでも出る指摘は除く） */
  always: ReadingFindingView[];
  /** この読みを選ぶと、ほかの字の読みによっては出る指摘（どの読みでも出る指摘は除く） */
  sometimes: ReadingFindingView[];
  /** この読みなら、どの読みでも出る違反も含めて、違反が一つもない */
  clean: boolean;
};

export type ReadingChoiceView = {
  /** マスの番号（句×7＋位置） */
  index: number;
  /** 「起句の1字目「娉」」 */
  cell: string;
  options: ReadingOptionView[];
};

/** 詩格が一つに決まらない（起句の末字が未入力など）ときの、詩格の候補ごとに出る指摘 */
export type FormChoiceView = {
  formName: string;
  /** この詩格なら、字の読みにかかわらず出る指摘（どの解釈にも出る指摘は除く） */
  always: ReadingFindingView[];
  /** この詩格で、字の読みによっては出る指摘（どの解釈にも出る指摘は除く） */
  sometimes: ReadingFindingView[];
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
  /** 詩格の候補ごとの結果（詩格が一つに決まる詩では空） */
  formChoices: FormChoiceView[];
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

const findingKey = (f: Finding) => `${f.rule}|${f.line}|${f.positions.join(",")}|${f.severity}`;

/** 解釈の指摘のうち、違反と要確認で、どの解釈にも出るわけではないもの（キーつき） */
function nonCommon(a: Analysis, data: EngineData, findings: Finding[]): [string, ReadingFindingView][] {
  const common = new Set(a.findings.map(findingKey));
  return [
    ...new Map(
      findings
        .filter((f) => (f.severity === "violation" || f.severity === "check") && !common.has(findingKey(f)))
        .map((f): [string, ReadingFindingView] => [
          findingKey(f),
          { severity: f.severity as "violation" | "check", ruleName: data.rules.rules[f.rule]?.name ?? f.rule, message: f.message },
        ]),
    ).entries(),
  ];
}

/** 解釈ごとの指摘の集まりを、すべてに出る指摘（always）と一部にだけ出る指摘（sometimes）に分ける */
function splitBy(sets: [string, ReadingFindingView][][]): { always: ReadingFindingView[]; sometimes: ReadingFindingView[] } {
  const alwaysKeys = sets.length === 0 ? [] : sets[0]!.map(([k]) => k).filter((k) => sets.every((s) => s.some(([x]) => x === k)));
  const all = new Map(sets.flat());
  return {
    always: alwaysKeys.map((k) => all.get(k)!),
    sometimes: [...all].filter(([k]) => !alwaysKeys.includes(k)).map(([, f]) => f),
  };
}

/**
 * 読みが複数ある字ごとに、読みを選んだ解釈に出る指摘（違反と要確認）を「必ず出る」「組み合わせによって出る」に分ける。
 * どの読みでも出る指摘（全体の一覧にあるもの）は除く。
 */
function readingChoices(a: Analysis, data: EngineData): ReadingChoiceView[] {
  if (a.interpretations.length < 2) return [];
  const hasCommonViolation = a.findings.some((f) => f.severity === "violation");
  const rows = a.interpretations.map((i) => ({ readings: i.readings, findings: nonCommon(a, data, i.findings) }));
  const positions = [...new Set(a.interpretations.flatMap((i) => Object.keys(i.readings).map(Number)))].sort((x, y) => x - y);
  return positions.map((n) => {
    const l = Math.floor(n / 7);
    const p = n % 7;
    const labels = [...new Set(rows.flatMap((r) => (r.readings[n] ? [readingLabel(r.readings[n]!)] : [])))];
    return {
      index: n,
      cell: `${lineName(l)}の${p + 1}字目「${a.chars[l]![p]!.char}」`,
      options: labels.map((label) => {
        const { always, sometimes } = splitBy(rows.filter((r) => r.readings[n] && readingLabel(r.readings[n]!) === label).map((r) => r.findings));
        const clean = !hasCommonViolation && always.every((f) => f.severity !== "violation") && sometimes.every((f) => f.severity !== "violation");
        return { label, always, sometimes, clean };
      }),
    };
  });
}

/**
 * 詩格の候補ごとに、その詩格の解釈に出て、どの解釈にも出るわけではない指摘を集める。
 * 同じ詩格でも字の読みで指摘が変わるので、「この詩格なら必ず出る」と「読みによっては出る」に分ける。
 */
function formChoices(a: Analysis, data: EngineData): FormChoiceView[] {
  const ids = [...new Set(a.interpretations.map((i) => i.form.id))];
  if (ids.length < 2) return [];
  return ids.map((id) => ({
    formName: data.forms.forms.find((f) => f.id === id)?.name ?? "未定",
    ...splitBy(a.interpretations.filter((x) => x.form.id === id).map((i) => nonCommon(a, data, i.findings))),
  }));
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
    readingChoices: readingChoices(a, data),
    formChoices: formChoices(a, data),
    independent: a.independent,
    errors: a.errors.map((e) => e.message),
  };
}

/** 選択中のマス（右の列）。CLAUDE.md §4.5「選択中の字」 */
export type CellDetailView = {
  /** 「起句の4字目」 */
  where: string;
  /** 入力どおりの字。未入力なら null */
  char: string | null;
  status: CharStatus;
  /** 字の状態と、いまの設定での扱いの説明 */
  statusText: string;
  /** 字の読み（声調・韻目）と平仄 */
  readings: { label: string; pz: PZ }[];
  /** 詩格の候補ごとに、定型がこのマスに求めるもの。詩格が決まらなければ空 */
  required: { formName: string; symbol: string; text: string }[];
  /** このマスに出ている指摘（どの読みでも出るもの） */
  findings: FindingView[];
  /** 読みが複数ある字なら、読みごとの結果 */
  choice: ReadingOptionView[] | null;
};

const PATTERN_TEXT: Record<string, string> = { "○": "平", "●": "仄", "◐": "平仄を問わない", "◎": "平声で押韻" };

/** 字の状態の説明。データにない字と国字は、設定によって扱いが変わるので、いまの扱いを書く */
export function statusText(status: CharStatus, options: Options): string {
  switch (status) {
    case "known":
      return "平仄データにある字です。";
    case "undetermined":
      return "異体字の対応で候補の字が複数あり、どの字か一つに決まりません。候補の字の読みをすべて示します。";
    case "unknown":
      return options.unknownAs !== undefined
        ? `平仄データにない字です。設定により、${options.unknownAs}として扱って判定しています。`
        : "平仄データにない字です。平仄は判定していません（設定で平・仄のどちらかとして扱えます）。";
    case "kokuji":
      return options.allowKokuji
        ? "国字（日本で作られた字）です。設定により、違反ではなく要確認として続けています。"
        : "国字（日本で作られた字）です。漢詩には使えません（設定で続けることもできます）。";
    case "blank":
      return "未入力のマスです。";
    case "invalid":
      return "漢字ではありません。";
  }
}

export function cellDetail(a: Analysis, v: PoemView, data: EngineData, index: number, options: Options = {}): CellDetailView {
  const l = Math.floor(index / 7);
  const p = index % 7;
  const info = a.chars[l]?.[p];
  const formIds = [...new Set(a.interpretations.map((i) => i.form.id))].filter((id) => id !== null);
  const required = formIds.flatMap((id) => {
    const f = data.forms.forms.find((x) => x.id === id);
    const symbol = f?.lines[l]?.pattern[p];
    return f && symbol ? [{ formName: f.name, symbol, text: PATTERN_TEXT[symbol] ?? symbol }] : [];
  });
  const view = toFindingView(data);
  return {
    where: `${lineName(l)}の${p + 1}字目`,
    char: info === undefined || info.status === "blank" ? null : (info.input ?? info.char),
    status: info?.status ?? "blank",
    statusText: statusText(info?.status ?? "blank", options),
    readings: (info?.readings ?? []).map((r) => ({ label: readingLabel(r), pz: r.tone === "平" ? "平" : "仄" })),
    required,
    findings: a.findings.filter((f) => f.line === l && f.positions.includes(p) && f.severity !== "ok").map(view),
    choice: v.readingChoices.find((c) => c.index === index)?.options ?? null,
  };
}
