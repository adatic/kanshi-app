// 詩語の検索と、制約・配置の問い合わせ（CLAUDE.md §4.1「制約の問い合わせ」・§4.4）。
// 判定の基準を二重に持たないよう、制約と配置は analyze に仮の字を置いて判定した結果から求める。
import { analyze } from "./analyze";
import { BLANK, parseInput } from "./input";
import type {
  Analysis,
  CellConstraint,
  EngineData,
  Finding,
  InputError,
  Options,
  PhraseEntry,
  PhraseQuery,
  Placement,
  PZ,
} from "./types";

// ---------------------------------------------------------------------------
// 詩語の検索（§4.4）

function matchesPattern(pattern: string, candidate: string): boolean {
  const required = [...pattern];
  const actual = [...candidate];
  return required.length === actual.length && required.every((symbol, i) => symbol === "◐" || symbol === actual[i]);
}

/**
 * 頻度表の語を絞り込む。読み込みはエンジンの外で行い、語の一覧を渡す。
 * - pattern（必須）：平・仄・◐（平仄を問わない）の並び。読みが複数ある語は、ありうるパターンのどれかが合えば合う。
 *   データにない字（「？」）は◐の位置にだけ合う
 * - contains：含む字（すべて含む語だけ）
 * - rhyme：末字の韻目（その韻目の読みを持つ語だけ）
 * 出現回数の多い順、同じなら語の順に返す。
 */
export function searchPhrases(entries: readonly PhraseEntry[], query: PhraseQuery): PhraseEntry[] {
  const needed = [...(query.contains ?? "")];
  return entries
    .filter((e) => e.p.some((p) => matchesPattern(query.pattern, p)))
    .filter((e) => needed.every((c) => e.w.includes(c)))
    .filter((e) => query.rhyme === undefined || e.r.includes(query.rhyme))
    .sort((a, b) => b.n - a.n || (a.w < b.w ? -1 : a.w > b.w ? 1 : 0));
}

// ---------------------------------------------------------------------------
// 仮の字（制約・配置の判定に使う）

/** どの字とも重ならない仮の韻目（冒韻の判定に紛れ込まないようにする） */
const PROBE_RHYME = "（仮）";
/** 文言の中で仮の字の代わりに見せる言葉 */
const PROBE_LABEL = "（置く字）";

/** 平仄データ・異体字の対応・国字のどれにもなく、詩の本文にもない漢字を、拡張B領域から決まった順に選ぶ */
function probeChar(data: EngineData, used: ReadonlySet<string>): string {
  const kokuji = new Set(data.kokuji.chars.map((k) => k.char));
  for (let cp = 0x20000; ; cp++) {
    const c = String.fromCodePoint(cp);
    if (data.chars[c] === undefined && data.variants[c] === undefined && !kokuji.has(c) && !used.has(c)) return c;
  }
}

/** 仮の字を足したデータ。平の字は rhyme の韻目、仄の字は仮の韻目で読む。本文にある字（used）とは重ならない */
function withProbe(data: EngineData, pz: PZ, rhyme: string, used: ReadonlySet<string>): { data: EngineData; char: string } {
  const char = probeChar(data, used);
  const reading = pz === "平" ? { tone: "平" as const, rhyme } : { tone: "去" as const, rhyme: PROBE_RHYME };
  return { data: { ...data, chars: { ...data.chars, [char]: [reading] } }, char };
}

// ---------------------------------------------------------------------------
// 詩の格子（4句×7字）

/** 入力を4句×7字の格子にする。足りないマスは未入力で埋める（それより外のマスは問い合わせでは使わない） */
function toGrid(input: string | readonly string[]): string[][] {
  const { lines } = parseInput(input);
  return Array.from({ length: 4 }, (_, l) => Array.from({ length: 7 }, (_, p) => lines[l]?.[p]?.input ?? BLANK));
}

/** analyze に渡す28マスの配列。文字列に戻さないので、マスの中の改行が句の区切りとして読まれない */
const toCells = (grid: string[][]) => grid.flat();

/** 元の格子を保ち、指定した位置から字を置いたコピーを返す */
function withCells(grid: string[][], line: number, start: number, chars: readonly string[]): string[][] {
  const copy = grid.map((row) => [...row]);
  chars.forEach((char, i) => (copy[line]![start + i] = char));
  return copy;
}

const keyOf = (f: Finding) => `${f.rule}|${f.severity}|${f.line}|${f.positions.join(",")}`;
const violations = (a: Analysis) => a.findings.filter((f) => f.severity === "violation");
const checks = (a: Analysis) => a.findings.filter((f) => f.severity === "check");
/** どれかの解釈に出る違反（全体に共通するものも含む） */
const anyViolations = (a: Analysis) => {
  const seen = new Map<string, Finding>();
  for (const i of a.interpretations) for (const f of i.findings) if (f.severity === "violation") seen.set(keyOf(f), f);
  return [...seen.values()];
};
const newOnes = (after: Finding[], before: Finding[]) => {
  const old = new Set(before.map(keyOf));
  return after.filter((f) => !old.has(keyOf(f)));
};

/** 押韻しうる位置の字の韻目（解釈のどれかで選ばれたもの） */
function rhymeGroups(a: Analysis, exceptLine: number): string[] {
  const groups = new Set<string>();
  for (const i of a.interpretations) {
    const lines = i.form.id === null ? [1, 3] : i.form.id.endsWith("-nyuin") ? [0, 1, 3] : [1, 3];
    for (const l of lines) {
      if (l === exceptLine) continue;
      const r = i.readings[l * 7 + 6] ?? a.chars[l]?.[6]?.readings[0];
      if (r !== undefined && r.tone === "平") groups.add(r.rhyme);
    }
  }
  return [...groups].sort();
}

/** その位置が押韻の位置になる詩格の解釈があるか */
const isRhymePosition = (a: Analysis, line: number, pos: number) =>
  pos === 6 && (line === 1 || line === 3 || (line === 0 && a.interpretations.some((i) => i.form.id?.endsWith("-nyuin"))));

// ---------------------------------------------------------------------------
// 制約の問い合わせ（§4.1）

/**
 * その位置に必要な平仄と、押韻の位置なら韻目。
 * その位置を空けた詩を基準に、平の字・仄の字を仮に置いて判定し、新しく出る違反（全解釈に共通するもの）を比べる。
 * 今その位置に入っている字には左右されない。押韻の位置では、平の字をほかの押韻字の韻目で読む。
 */
export function constraintsAt(
  input: string | readonly string[],
  data: EngineData,
  line: number,
  pos: number,
  options: Options = {},
): CellConstraint {
  const grid = toGrid(input);
  grid[line]![pos] = BLANK;
  const base = analyze(toCells(grid), data, options);
  const rhymePosition = isRhymePosition(base, line, pos);
  const groups = rhymePosition ? rhymeGroups(base, line) : [];
  const used = new Set(toCells(grid));
  const baseViolations = violations(base);
  const baseChecks = checks(base);

  const tryPz = (pz: PZ) => {
    // 押韻の位置では、ほかの押韻字のどれかの韻目で違反がなければ置ける（韻目がまだなければ仮の韻目）
    const rhymes = pz === "平" && groups.length > 0 ? groups : [PROBE_RHYME];
    const results = rhymes.map((rhyme) => {
      const probe = withProbe(data, pz, rhyme, used);
      const g = withCells(grid, line, pos, [probe.char]);
      const a = analyze(toCells(g), probe.data, options);
      // 文言の中の仮の字は、利用者には意味がないので「（置く字）」に置き換える
      const plain = (fs: Finding[]) => fs.map((f) => ({ ...f, message: f.message.replaceAll(probe.char, PROBE_LABEL) }));
      return { violations: plain(newOnes(violations(a), baseViolations)), checks: plain(newOnes(checks(a), baseChecks)) };
    });
    const best = results.find((r) => r.violations.length === 0) ?? results[0]!;
    return { pz, ok: best.violations.length === 0, violations: best.violations, checks: best.checks };
  };

  const opts = [tryPz("平"), tryPz("仄")];
  const okOnes = opts.filter((o) => o.ok);
  return {
    line,
    pos,
    options: opts,
    required: okOnes.length === 1 ? okOnes[0]!.pz : null,
    rhyme: { position: rhymePosition, groups },
  };
}

// ---------------------------------------------------------------------------
// 配置の問い合わせ（§4.1）

const SLOTS: Record<number, { start: number; slot: Placement["slot"] }[]> = {
  2: [
    { start: 0, slot: "1-2" },
    { start: 2, slot: "3-4" },
    { start: 4, slot: "5-6" },
    { start: 5, slot: "6-7" },
  ],
  3: [{ start: 4, slot: "5-7" }],
};

/**
 * 2字・3字の語を置ける句と位置の一覧（2字語は各句の1-2・3-4・5-6・6-7字目、3字語は5-7字目）。
 * - すでにある別の字と重なる位置は conflict（置いて判定はしない。同じ字が入っている位置は重ならない扱い）
 * - 置いたマスに入力エラー（漢字以外など）が出る語や、「＿」を含む語は invalid（位置と理由を errors に返す）
 * - 置いて判定し、新しい違反が全解釈に共通して出れば ng、一部の解釈（読み）でだけ出れば depends、出なければ ok
 */
export function placementsFor(
  phrase: string,
  input: string | readonly string[],
  data: EngineData,
  options: Options = {},
): Placement[] {
  const chars = [...phrase];
  const slots = SLOTS[chars.length];
  if (slots === undefined) return [];
  const grid = toGrid(input);
  const base = analyze(toCells(grid), data, options);
  const baseAny = anyViolations(base);
  const baseViolations = violations(base);

  return [0, 1, 2, 3].flatMap((line) =>
    slots.map(({ start, slot }): Placement => {
      const conflicts = chars.flatMap((c, i) => {
        const existing = grid[line]![start + i]!;
        return existing !== BLANK && existing !== c ? [start + i] : [];
      });
      if (conflicts.length > 0) return { line, start, slot, status: "conflict", violations: [], dependent: [], conflicts, errors: [] };
      const g = withCells(grid, line, start, chars);
      const a = analyze(toCells(g), data, options);
      // 置いたマスの入力エラー（漢字以外・繰り返す字のない「々」）と、語の中の「＿」は invalid（CLAUDE.md §4.1）
      const placed = (e: InputError) => e.line === line && e.position >= start && e.position < start + chars.length;
      const errors: InputError[] = [
        ...a.errors.filter(placed),
        ...chars.flatMap((c, i) =>
          c === BLANK ? [{ line, position: start + i, char: c, message: "語に「＿」（未入力のマス）は使えません。" }] : [],
        ),
      ].sort((x, y) => x.position - y.position);
      if (errors.length > 0) return { line, start, slot, status: "invalid", violations: [], dependent: [], conflicts, errors };
      const common = newOnes(violations(a), baseViolations);
      const dependent = newOnes(anyViolations(a), baseAny).filter((f) => !common.some((c) => keyOf(c) === keyOf(f)));
      const status = common.length > 0 ? "ng" : dependent.length > 0 ? "depends" : "ok";
      return { line, start, slot, status, violations: common, dependent, conflicts, errors };
    }),
  );
}
