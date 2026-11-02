// 選んだマスの条件と詩語候補（CLAUDE.md §4.1「制約の問い合わせ」・§4.4）。純関数で、DOM にも通信にも触れない。
// 判定の基準はエンジンだけが持つ。ここは定型と入っている字で候補を絞り、置けるかどうかは placementsFor に聞く。
import { placementsFor, searchPhrases } from "@kanshi/engine";
import type { Analysis, CellConstraint, EngineData, Options, PhraseEntry, Placement, PZ } from "@kanshi/engine";
import { BLANK, WIDTH } from "./grid";

export type Slot = { name: Placement["slot"]; start: number; length: number };

/** 2字語は 1-2・3-4・5-6・6-7字目、3字語は 5-7字目（§4.1） */
export const SLOTS: readonly Slot[] = [
  { name: "1-2", start: 0, length: 2 },
  { name: "3-4", start: 2, length: 2 },
  { name: "5-6", start: 4, length: 2 },
  { name: "6-7", start: 5, length: 2 },
  { name: "5-7", start: 4, length: 3 },
];

/** 句の中の位置（0始まり）を含む語の位置 */
export const slotsAt = (pos: number): Slot[] => SLOTS.filter((s) => pos >= s.start && pos < s.start + s.length);

const TO_PZ: Record<string, string> = { "○": "平", "●": "仄", "◎": "平", "◐": "◐" };

/**
 * 語の位置に定型が求める平仄の並び（平・仄・◐）。押韻字（◎）は平。
 * 詩格の候補（未入力のため複数ありうる）で違う位置は◐。詩格が決まらなければすべて◐。
 */
export function slotPattern(a: Analysis, data: EngineData, line: number, slot: Slot): string {
  const forms = [...new Set(a.interpretations.map((i) => i.form.id))]
    .filter((id) => id !== null)
    .flatMap((id) => data.forms.forms.filter((f) => f.id === id));
  return Array.from({ length: slot.length }, (_, k) => {
    const symbols = new Set(forms.map((f) => TO_PZ[f.lines[line]?.pattern[slot.start + k] ?? "◐"] ?? "◐"));
    return symbols.size === 1 ? [...symbols][0]! : "◐";
  }).join("");
}

const CODE: Record<string, string[]> = { 平: ["h"], 仄: ["z"], "◐": ["h", "z", "q"] };

/** 探索用の索引（data/phrases/search/）のうち、パターンに合いうるファイルの名前（平→h 仄→z データにない字→q） */
export function searchFileNames(pattern: string): string[] {
  const codes = [...pattern].reduce<string[]>((acc, c) => acc.flatMap((a) => (CODE[c] ?? []).map((x) => a + x)), [""]);
  return codes.map((c) => `${pattern.length}-${c}`);
}

/** 索引の1行：[語, 出現回数, [末字の韻目の番号], [位置ごとの出現回数]] */
export type SearchRow = [string, number, number[], number[]];

const FROM_CODE: Record<string, string> = { h: "平", z: "仄", q: "？" };

/** 索引の行を語にする（用例は空）。同じ語が複数のファイル（パターン）にあれば、パターンをまとめる */
export function rowsToEntries(
  files: readonly { name: string; rows: readonly SearchRow[] }[],
  rhymes: readonly string[],
  slotNames: readonly string[],
): PhraseEntry[] {
  const byWord = new Map<string, PhraseEntry>();
  for (const { name, rows } of files) {
    const pattern = [...name.split("-")[1]!].map((c) => FROM_CODE[c] ?? c).join("");
    for (const [w, n, r, at] of rows) {
      const found = byWord.get(w);
      if (found) {
        if (!found.p.includes(pattern)) found.p.push(pattern);
        continue;
      }
      byWord.set(w, {
        w,
        n,
        at: Object.fromEntries(slotNames.flatMap((s, k) => (at[k] ? [[s, at[k]!]] : []))),
        p: [pattern],
        r: r.map((i) => rhymes[i]!),
        e: [],
      });
    }
  }
  return [...byWord.values()];
}

export type SlotQuery = {
  /** 平・仄・◐ の並び */
  pattern: string;
  /** すでに入っている字（未入力は null） */
  fixed: (string | null)[];
  /** 末字の韻目 */
  rhyme?: string;
};

/** 定型の平仄、すでに入っている字、末字の韻目で絞った候補（出現回数の多い順）。語の位置がすべて埋まっていれば空 */
export function slotCandidates(entries: readonly PhraseEntry[], q: SlotQuery): PhraseEntry[] {
  if (q.fixed.every((c) => c !== null)) return [];
  return searchPhrases(entries, { pattern: q.pattern, ...(q.rhyme !== undefined ? { rhyme: q.rhyme } : {}) }).filter((e) => {
    const chars = [...e.w];
    return q.fixed.every((c, k) => c === null || chars[k] === c);
  });
}

/**
 * 押韻の位置で候補を絞る韻目。押韻の位置でなければ絞らない。
 * 設定で韻目を選んでいればそれ。なければ、ほかの押韻字の韻目が一つに決まるときだけそれで絞る。
 */
export function rhymeFor(constraint: CellConstraint | null, setting: string | null): string | undefined {
  if (constraint === null || !constraint.rhyme.position) return undefined;
  if (setting !== null) return setting;
  return constraint.rhyme.groups.length === 1 ? constraint.rhyme.groups[0] : undefined;
}

export type CandidateView = {
  word: string;
  /** 唐詩での出現回数（全体） */
  count: number;
  /** この位置（1-2字目など）での出現回数 */
  slotCount: number;
  patterns: string[];
  rhymes: string[];
  /** ok 置ける／depends 字の読みによって違反が出る */
  status: "ok" | "depends";
  /** 読みによって出る違反の説明 */
  dependent: string[];
};

export type CheckedCandidates = {
  shown: CandidateView[];
  /** 置くと違反が出るため除いた語の数（調べた範囲で） */
  excluded: number;
  /** 調べなかった候補の数 */
  remaining: number;
};

/** 候補を、その句・位置に置いて判定する（placementsFor）。置くと違反が出る語は除く。limit 件そろったら止める */
export function checkCandidates(
  candidates: readonly PhraseEntry[],
  grid: readonly string[],
  data: EngineData,
  options: Options,
  line: number,
  slot: Slot,
  limit = 20,
): CheckedCandidates {
  const shown: CandidateView[] = [];
  let excluded = 0;
  let checked = 0;
  for (const e of candidates) {
    if (shown.length >= limit) break;
    checked++;
    const p = placementsFor(e.w, grid, data, options, { line, slot: slot.name })[0];
    if (p === undefined || (p.status !== "ok" && p.status !== "depends")) {
      excluded++;
      continue;
    }
    shown.push({
      word: e.w,
      count: e.n,
      slotCount: e.at[slot.name] ?? 0,
      patterns: e.p,
      rhymes: e.r,
      status: p.status,
      dependent: p.dependent.map((f) => `${data.rules.rules[f.rule]?.name ?? f.rule}：${f.message}`),
    });
  }
  return { shown, excluded, remaining: candidates.length - checked };
}

/** 語の位置がすべて埋まっていれば、その語（「々」は直前の字にする）。未入力があれば null */
export function filledWord(grid: readonly string[], line: number, slot: Slot): string | null {
  const chars: string[] = [];
  for (let k = 0; k < slot.length; k++) {
    const i = line * WIDTH + slot.start + k;
    const c = grid[i]!;
    if (c === BLANK) return null;
    chars.push(c === "々" ? (chars[k - 1] ?? grid[i - 1] ?? c) : c);
  }
  return chars.join("");
}

/** 先頭の字ごとのファイル（{"2": [...], "3": [...]}）から語を引く */
export function findPhrase(groups: Record<"2" | "3", PhraseEntry[]> | undefined, word: string): PhraseEntry | null {
  const size = String([...word].length);
  if (groups === undefined || (size !== "2" && size !== "3")) return null;
  return groups[size].find((e) => e.w === word) ?? null;
}

export type ConstraintView = {
  /** 置ける平仄が一つだけならそれ */
  required: PZ | null;
  options: { pz: PZ; ok: boolean; problems: string[]; checks: string[] }[];
  rhyme: { position: boolean; groups: string[] };
};

/** constraintsAt の結果を、規則名つきの文にする */
export function constraintView(c: CellConstraint, data: EngineData): ConstraintView {
  const text = (f: { rule: string; message: string }) => `${data.rules.rules[f.rule]?.name ?? f.rule}：${f.message}`;
  return {
    required: c.required,
    options: c.options.map((o) => ({ pz: o.pz, ok: o.ok, problems: o.violations.map(text), checks: o.checks.map(text) })),
    rhyme: c.rhyme,
  };
}
