// 規則（CLAUDE.md §4.1「検査する規則」）。重みは data/rules.json から読み、オプションで上書きできる。
import { pzOf } from "./chars";
import { lineName, positionName } from "./messages";
import type { CharInfo, FormDef, Finding, Options, PZ, Reading, RuleDef, Severity } from "./types";

/** 解釈の中の1マス。pz が null のマス（未入力・データにない字など）は、そのマスを使う比較をしない */
export type CellState = {
  pz: PZ | null;
  /** 選んだ読み（データにない字を平／仄として扱うときなどは null） */
  reading: Reading | null;
  /** 選んだ読みが【詞】【辭】欄にだけある */
  supplementOnly: boolean;
};

export type RuleContext = {
  rules: Record<string, RuleDef>;
  options: Options;
};

export function severityOf(ctx: RuleContext, rule: string): Severity {
  const override = ctx.options.severities?.[rule];
  if (override !== undefined) return override;
  if (rule === "koku-ji" && ctx.options.allowKokuji) return "check";
  const def = ctx.rules[rule];
  if (def === undefined) throw new Error(`rules.json に規則 ${rule} がありません`);
  return def.severity;
}

const finding = (ctx: RuleContext, rule: string, line: number, positions: number[], message: string): Finding => ({
  rule,
  severity: severityOf(ctx, rule),
  line,
  positions,
  message,
});

const SYMBOL_PZ: Record<string, PZ> = { "○": "平", "●": "仄", "◎": "平" };
const HASAMI_BASE = "○●●";

/**
 * 一つの解釈（各マスの平仄と読みが決まった状態）について、読みに依存する規則を判定する。
 * form が null（詩格が決まらない）なら、定型に依存する規則（pattern・ichisango-furon・hasami-hei）は判定しない。
 */
export function evaluate(
  grid: CellState[][],
  chars: CharInfo[][],
  form: FormDef | null,
  ctx: RuleContext,
): Finding[] {
  // 指摘の並び順も維持する（句内 → 句間 → 押韻 → 補助読み）。
  return [
    ...evaluateLines(grid, form, ctx),
    ...evaluateLinks(grid, ctx),
    ...evaluateRhymes(grid, chars, form, ctx),
    ...evaluateSupplementReadings(grid, chars, ctx),
  ];
}

/** 句内の定型・平仄の規則 */
function evaluateLines(grid: CellState[][], form: FormDef | null, ctx: RuleContext): Finding[] {
  const out: Finding[] = [];
  const pz = (l: number, p: number) => grid[l]?.[p]?.pz ?? null;
  const lineCount = Math.min(grid.length, 4);
  const rhymeLines = form?.rhymeLines ?? [1, 3];

  for (let l = 0; l < lineCount; l++) {
    const def = form?.lines[l];
    const name = lineName(l);
    const at = (p: number) => pz(l, p);

    // 挟み平：押韻しない句で、律句の5〜7字目 ○●● が ●○● になっている
    const hasami =
      def !== undefined &&
      !rhymeLines.includes(l) &&
      def.base.slice(4) === HASAMI_BASE &&
      at(4) === "仄" &&
      at(5) === "平" &&
      at(6) === "仄";
    if (hasami) {
      out.push(finding(ctx, "hasami-hei", l, [4, 5, 6], `${name}の5〜7字目が「仄平仄」です。挟み平（句末の平仄仄を仄平仄に換える形）として許容されます。`));
    }
    const hasamiPositions = hasami ? [4, 5] : [];

    if (def !== undefined) {
      const mismatch: number[] = [];
      const loose: number[] = [];
      [...def.pattern].forEach((sym, p) => {
        const actual = at(p);
        if (actual === null || hasamiPositions.includes(p)) return;
        if (sym === "◐") {
          if (actual !== SYMBOL_PZ[def.base[p]!]) loose.push(p);
        } else if (sym !== "◎" && actual !== SYMBOL_PZ[sym]) {
          mismatch.push(p);
        }
      });
      // 1字ごとに1件にする（解釈に共通する指摘を、位置ごとに正しく取り出すため）
      for (const p of mismatch) {
        out.push(finding(ctx, "pattern", l, [p], `${name}の${positionName(p)}は、定型（${form!.name}）では${SYMBOL_PZ[def.pattern[p]!]}です。`));
      }
      for (const p of loose) {
        out.push(finding(ctx, "ichisango-furon", l, [p], `${name}の${positionName(p)}は律句と平仄が違いますが、一三五不論の範囲なので許容されます。`));
      }
    }

    const [p2, p4, p6] = [at(1), at(3), at(5)];
    if (p2 !== null && p4 !== null && p2 === p4) {
      out.push(finding(ctx, "nishi-fudo", l, [1, 3], `${name}の2字目と4字目がどちらも${p2}です。二四不同では平仄を違えます。`));
    }
    if (p2 !== null && p6 !== null && p2 !== p6 && !hasami) {
      out.push(finding(ctx, "niroku-tsui", l, [1, 5], `${name}の2字目（${p2}）と6字目（${p6}）の平仄が違います。二六対では平仄をそろえます。`));
    }

    const tail = [at(4), at(5), at(6)];
    if (tail.every((t) => t === "平")) {
      out.push(finding(ctx, "ka-sanren-hei", l, [4, 5, 6], `${name}の5〜7字目がすべて平です（下三連・三平）。`));
    } else if (tail.every((t) => t === "仄")) {
      out.push(finding(ctx, "ka-sanren-soku", l, [4, 5, 6], `${name}の5〜7字目がすべて仄です（下三連・三仄）。三平ほど厳しくは問われませんが、確認してください。`));
    }

    if (at(3) === "平" && at(2) === "仄" && at(4) === "仄") {
      out.push(finding(ctx, "kohei", l, [3], `${name}の4字目の平が、3字目と5字目の仄に挟まれています（孤平）。`));
    }
  }

  return out;
}

/** 句間の反法・粘法と、それに伴う拗体の注意 */
function evaluateLinks(grid: CellState[][], ctx: RuleContext): Finding[] {
  const out: Finding[] = [];
  const pz = (l: number, p: number) => grid[l]?.[p]?.pz ?? null;
  const lineCount = Math.min(grid.length, 4);

  // 反法・粘法：起承は2字目が逆、承転は同じ、転結は逆
  const pairs: [number, number, "diff" | "same"][] = [
    [0, 1, "diff"],
    [1, 2, "same"],
    [2, 3, "diff"],
  ];
  let brokenLink = false;
  for (const [a, b, rel] of pairs) {
    if (b >= lineCount) continue;
    const pa = pz(a, 1);
    const pb = pz(b, 1);
    if (pa === null || pb === null) continue;
    if (rel === "diff" && pa === pb) {
      out.push(finding(ctx, "hanpo-nenpo", b, [1], `${lineName(a)}と${lineName(b)}の2字目がどちらも${pa}です。反法では平仄を逆にします。`));
      brokenLink = true;
    } else if (rel === "same" && pa !== pb) {
      out.push(finding(ctx, "hanpo-nenpo", b, [1], `${lineName(a)}（${pa}）と${lineName(b)}（${pb}）の2字目の平仄が違います。粘法ではそろえます。`));
      brokenLink = true;
    }
  }
  if (brokenLink) {
    out.push(finding(ctx, "youtai", -1, [], "反法・粘法が守られていない句があります。拗体（不粘）として意図した作りかどうかは、作者が判断してください。"));
  }

  return out;
}

/** 押韻字の声調・韻目、孤雁入群格、冒韻 */
function evaluateRhymes(grid: CellState[][], chars: CharInfo[][], form: FormDef | null, ctx: RuleContext): Finding[] {
  const out: Finding[] = [];
  const pz = (l: number, p: number) => grid[l]?.[p]?.pz ?? null;
  const lineCount = Math.min(grid.length, 4);
  const rhymeLines = form?.rhymeLines ?? [1, 3];

  // 押韻
  const rhymeCell = (l: number) => (l < lineCount ? grid[l]?.[6] : undefined);
  const charAt = (l: number, p: number) => chars[l]?.[p]?.char ?? "";
  for (const l of rhymeLines) {
    if (l < lineCount && pz(l, 6) === "仄") {
      out.push(finding(ctx, "rhyme-tone", l, [6], `${lineName(l)}の押韻字「${charAt(l, 6)}」が仄声です。押韻字は平声にします。`));
    }
  }
  const rhymeOf = (l: number) => {
    const c = rhymeCell(l);
    return c?.pz === "平" && c.reading !== null ? c.reading.rhyme : null;
  };
  const r1 = rhymeOf(1);
  const r3 = rhymeOf(3);
  if (r1 !== null && r3 !== null && r1 !== r3) {
    out.push(finding(ctx, "rhyme-group", 3, [6], `結句の押韻字「${charAt(3, 6)}」（${r3}）が、承句の押韻字（${r1}）と同じ韻目ではありません。`));
  }
  const ref = r1 ?? r3;
  const refLine = r1 !== null ? 1 : 3;
  const r0 = rhymeLines.includes(0) ? rhymeOf(0) : null;
  if (r0 !== null && ref !== null && r0 !== ref) {
    // 孤雁入群格は、承句・結句の韻目が両方決まって一致しているときだけ（DECISIONS.md）
    if (r1 !== null && r3 !== null && r1 === r3) {
      out.push(finding(ctx, "kogan-nyugun", 0, [6], `起句の押韻字「${charAt(0, 6)}」（${r0}）だけが、承句・結句の韻目（${ref}）と違います。孤雁入群格として意図したものかどうか、作者が判断してください。`));
    } else {
      out.push(finding(ctx, "rhyme-group", 0, [6], `起句の押韻字「${charAt(0, 6)}」（${r0}）が、${lineName(refLine)}の押韻字（${ref}）と同じ韻目ではありません。`));
    }
  }

  // 冒韻：押韻位置以外の字を、この解釈で選んだ読みが押韻と同じ韻目になっている
  const group = ref ?? r0;
  if (group !== null) {
    for (let l = 0; l < lineCount; l++) {
      (grid[l] ?? []).forEach((cell, p) => {
        if (p >= 7 || (p === 6 && rhymeLines.includes(l))) return;
        if (cell.reading?.rhyme === group) {
          out.push(finding(ctx, "bou-in", l, [p], `${lineName(l)}の${positionName(p)}「${charAt(l, p)}」を押韻と同じ韻目（${group}）で読んでいます（冒韻）。意図したものか確認してください。`));
        }
      });
    }
  }

  return out;
}

/** 【詞】【辭】欄にだけある読みの注意 */
function evaluateSupplementReadings(grid: CellState[][], chars: CharInfo[][], ctx: RuleContext): Finding[] {
  const out: Finding[] = [];
  const lineCount = Math.min(grid.length, 4);
  const charAt = (l: number, p: number) => chars[l]?.[p]?.char ?? "";

  // 【詞】【辭】欄にだけある読み
  for (let l = 0; l < lineCount; l++) {
    (grid[l] ?? []).forEach((cell, p) => {
      if (p < 7 && cell.supplementOnly && cell.reading !== null) {
        const r = cell.reading;
        out.push(finding(ctx, "supplement-reading", l, [p], `${lineName(l)}の${positionName(p)}「${charAt(l, p)}」は、平仄データで【詞】【辭】欄にだけある読み（${r.tone}・${r.rhyme}）で判定しています。この読みでよいか確認してください。`));
      }
    });
  }

  return out;
}

/** 読みに依存しない規則：句数・字数、同字重出、国字、データにない字 */
export function evaluateGlobal(chars: CharInfo[][], ctx: RuleContext): Finding[] {
  const out: Finding[] = [];
  if (chars.length !== 4) {
    out.push(finding(ctx, "length", -1, [], `句の数が${chars.length}です。七言絶句は4句です。`));
  }
  chars.slice(0, 4).forEach((line, l) => {
    if (line.length !== 7) out.push(finding(ctx, "length", l, [], `${lineName(l)}の字数が${line.length}字です。7字にしてください。`));
  });

  // 同字重出：同じ字が出てくる句ごとに一つ
  const places = new Map<string, [number, number][]>();
  chars.forEach((line, l) =>
    line.forEach((info, p) => {
      if (info.status === "blank" || info.status === "invalid") return;
      places.set(info.char, [...(places.get(info.char) ?? []), [l, p]]);
    }),
  );
  for (const [c, at] of places) {
    if (at.length < 2) continue;
    const where = at.map(([l, p]) => `${lineName(l)}の${positionName(p)}`).join("・");
    for (const l of [...new Set(at.map(([line]) => line))]) {
      const positions = at.filter(([line]) => line === l).map(([, p]) => p);
      out.push(finding(ctx, "douji", l, positions, `「${c}」が${at.length}回使われています（${where}）。畳語や意図した繰り返しかどうか、作者が判断してください。`));
    }
  }

  chars.forEach((line, l) =>
    line.forEach((info, p) => {
      const where = `${lineName(l)}の${positionName(p)}「${info.char}」`;
      if (info.status === "kokuji") {
        out.push(finding(ctx, "koku-ji", l, [p], `${where}は国字で、平仄がありません。`));
      } else if (info.status === "unknown") {
        const as = ctx.options.unknownAs;
        out.push(finding(ctx, "unknown-char", l, [p], as !== undefined ? `${where}は平仄データにありません。${as}として扱って判定しました。` : `${where}は平仄データにありません。この位置の平仄は判定していません。`));
      }
    }),
  );
  return out;
}

