// 詩全体の判定（CLAUDE.md §4.1）。読みが複数ある字は、読みの組み合わせ（解釈）ごとに判定する。
import { charInfo, pzOf, symbolOf } from "./chars";
import { detectForms } from "./form";
import { parseInput } from "./input";
import type { CellState, RuleContext } from "./rules";
import { evaluate, evaluateGlobal } from "./rules";
import type { Analysis, CharInfo, EngineData, Finding, FormResult, Interpretation, Options, Reading } from "./types";

/** 組み合わせがこれを超えたら、位置ごとに独立して評価する（CLAUDE.md §4.1：目安は2の10乗） */
export const MAX_COMBINATIONS = 2 ** 10;

/** 押韻しうる位置（起句・承句・結句の末字）。ここでは読みを韻目ごとに分ける */
const isRhymeSlot = (line: number, pos: number) => pos === 6 && (line === 0 || line === 1 || line === 3);

/**
 * マスの読みを、判定に効く違いごとにまとめる（一つのまとまりが、解釈の一つの選択肢になる）。
 * - 押韻しうる位置では韻目ごと、それ以外では平仄ごとにまとめる。ただし押韻しうる位置に来うる韻目
 *   （rhymeCandidates）の読みは、冒韻の有無が変わるので、その韻目ごとに分ける
 * - 異体字の対応で別の字として引いた読みは、候補の字ごとに分ける（どの候補で判定したかを残す）
 * - まとまりの代表には、本体の読み（【詞】【辭】欄でない読み）を優先する
 */
function choicesOf(info: CharInfo, line: number, pos: number, options: Options, rhymeCandidates: ReadonlySet<string>): CellState[] {
  if (info.status === "unknown" && options.unknownAs !== undefined) {
    return [{ pz: options.unknownAs, reading: null, supplementOnly: false }];
  }
  if (info.readings.length === 0) return [{ pz: null, reading: null, supplementOnly: false }];
  const groups = new Map<string, Reading[]>();
  for (const r of info.readings) {
    const what = isRhymeSlot(line, pos) ? r.rhyme : `${pzOf(r.tone)}|${rhymeCandidates.has(r.rhyme) ? r.rhyme : ""}`;
    const key = `${r.via ?? ""}|${what}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((rs) => {
    const reading = rs.find((r) => r.note === undefined) ?? rs[0]!;
    return { pz: pzOf(reading.tone), reading, supplementOnly: reading.note !== undefined };
  });
}

const findingKey = (f: Finding) => `${f.rule}|${f.severity}|${f.line}|${f.positions.join(",")}`;

/**
 * 七言絶句を判定する。純関数で、データ（data/ の JSON）は引数で受け取る。
 * @param input 1句1行のテキスト、または28マスの配列
 */
export function analyze(input: string | readonly string[], data: EngineData, options: Options = {}): Analysis {
  const ctx: RuleContext = { rules: data.rules.rules, options };
  const kokuji = new Set(data.kokuji.chars.map((k) => k.char));
  const { lines, errors } = parseInput(input);
  const chars = lines.map((row) => row.map((cell) => charInfo(cell, data, kokuji)));
  const symbols = chars.map((row) => row.map(symbolOf).join(""));

  // マスごとの選択肢と、選択肢が2つ以上あるマス。読みを組み合わせるのは、判定の対象になる4句×7字の中だけ
  // （それより外のマスは字数・句数の違反として扱い、最初の選択肢で埋める）
  const inRange = (l: number, p: number) => l < 4 && p < 7;
  const rhymeCandidates = new Set(
    chars.flatMap((row, l) => row.flatMap((info, p) => (inRange(l, p) && isRhymeSlot(l, p) ? info.readings.map((r) => r.rhyme) : []))),
  );
  const choices = chars.map((row, l) => row.map((info, p) => choicesOf(info, l, p, options, rhymeCandidates)));
  const open: [number, number][] = [];
  choices.forEach((row, l) => row.forEach((cs, p) => inRange(l, p) && cs.length > 1 && open.push([l, p])));
  const total = open.reduce((n, [l, p]) => n * choices[l]![p]!.length, 1);
  const independent = total > MAX_COMBINATIONS;

  // 解釈ごとの選び方（open の各マスで何番目の選択肢を採るか。-1 は決めない）
  const picks: number[][] = independent
    ? open.flatMap(([l, p], i) => choices[l]![p]!.map((_, c) => open.map((__, j) => (j === i ? c : -1))))
    : cartesian(open.map(([l, p]) => choices[l]![p]!.length));

  const interpretations: Interpretation[] = picks.flatMap((pick) => {
    // 句と位置の組で引く（8字目以降のマスと次の句のマスを取り違えないため）
    const chosen = new Map(open.map(([l, p], i) => [`${l}:${p}`, pick[i]!]));
    const grid: CellState[][] = choices.map((row, l) =>
      row.map((cs, p) => {
        const c = chosen.get(`${l}:${p}`);
        if (c === undefined) return cs[0]!;
        return c === -1 ? { pz: null, reading: null, supplementOnly: false } : cs[c]!;
      }),
    );
    // 解釈の読みは、選択肢のあるマス（4句×7字の中）だけ。キーは 句×7＋位置
    const readings: Record<number, Reading> = {};
    open.forEach(([l, p], i) => {
      const r = grid[l]![p]!.reading;
      if (pick[i] !== -1 && r !== null) readings[l * 7 + p] = r;
    });
    // 詩格が一つに決まらない（起句の末字が未入力など）ときは、候補の詩格ごとに解釈を分ける
    return detectForms((l, p) => grid[l]?.[p]?.pz ?? null, options.form).map((form) => {
      const def = form.id === null ? null : data.forms.forms.find((f) => f.id === form.id) ?? null;
      const findings = evaluate(grid, chars, def, ctx).map((f) => withInterpretation(f, readings));
      return { readings, form, findings };
    });
  });

  // すべての解釈に共通する指摘は全体の findings に入れる
  const [first, ...rest] = interpretations;
  const restKeys = rest.map((i) => new Set(i.findings.map(findingKey)));
  const common = (first?.findings ?? [])
    .filter((f) => restKeys.every((keys) => keys.has(findingKey(f))))
    .map(({ interpretation: _omit, ...f }) => f);

  return {
    form: overallForm(interpretations),
    chars,
    symbols,
    findings: [...evaluateGlobal(chars, ctx), ...common],
    interpretations,
    independent,
    errors,
  };
}

/** 指摘の位置に、解釈で読みを選んだマスがあれば、その読みを添える */
function withInterpretation(f: Finding, readings: Record<number, Reading>): Finding {
  if (f.line < 0) return f;
  const used = Object.fromEntries(
    f.positions.flatMap((p) => {
      const r = readings[f.line * 7 + p];
      return r === undefined ? [] : [[f.line * 7 + p, r]];
    }),
  );
  return Object.keys(used).length > 0 ? { ...f, interpretation: used } : f;
}

function overallForm(interpretations: Interpretation[]): FormResult {
  const first = interpretations[0]!.form;
  const ids = new Set(interpretations.map((i) => i.form.id));
  if (ids.size === 1) return first;
  const note = "読みや未入力のマスによって詩格が変わります（解釈ごとの結果を見てください）。";
  return { ...first, note: first.note !== undefined ? `${first.note}${note}` : note };
}

/** 各桁の大きさから、すべての組み合わせを作る */
function cartesian(sizes: number[]): number[][] {
  return sizes.reduce<number[][]>((acc, size) => acc.flatMap((prefix) => Array.from({ length: size }, (_, i) => [...prefix, i])), [[]]);
}
