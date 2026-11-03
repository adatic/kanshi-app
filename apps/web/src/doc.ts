// 詩の記録（CLAUDE.md §4.6）。純関数で、DOM にも保存先にも触れない。
// - マス目は、追記専用の編集記録（EditEvent）を最初から順にたどって導き出す
// - 必須要素の一覧と設定は、変わるたびに足すスナップショットの最後のものから導き出す
// - 作者の手入力は「未確定」（working と、記録からたどったマス目の差）としてため、意味のある単位で確定して記録にする
import type { FormId } from "@kanshi/engine";
import { BLANK, CELLS, WIDTH, emptyGrid } from "./grid";
import { presentPlaces } from "./required";
import { lineName } from "./view";

export const SCHEMA = 1;

/** 誰が。ai は将来のための予約で、MVP では使わない（§4.6） */
export type Actor = "author" | "dictionary" | "ai";

export type EditEvent = {
  /** ISO 8601 */
  at: string;
  actor: Actor;
  line: number;
  /** 開始位置（0始まり） */
  slot: number;
  before: string;
  after: string;
  /** どこから：必須要素ID（required:r1）、詩語ID（phrase:語）、sample・clear・paste。手入力は null */
  origin: string | null;
  /** 任意。必須にしない */
  reason?: string;
};

export type Settings = {
  form: FormId | null;
  unknownAs: "平" | "仄" | null;
  allowKokuji: boolean;
  showPattern: boolean;
  /** 詩語候補の絞り込みに使う押韻の韻目。自動なら null */
  rhyme: string | null;
};

export const DEFAULT_SETTINGS: Settings = { form: null, unknownAs: null, allowKokuji: false, showPattern: true, rhyme: null };

export type RequiredItem = { id: string; word: string };

export type Snapshot = { at: string; required: RequiredItem[]; settings: Settings };

export type PoemDoc = {
  schema: typeof SCHEMA;
  events: EditEvent[];
  snapshots: Snapshot[];
  /** いまのマス目（確定済みの記録に、未確定の手入力を重ねたもの） */
  working: string[];
  /** 次に振る必須要素の番号（ID は使い回さない） */
  nextRequiredId: number;
  /**
   * 一度でも詩に入ったことのある必須要素の ID（未確定の手入力で入った場合も含む）。消失警告に使う。
   * 未確定の手入力は記録に残らないので、記録からは導けない。そのため doc に持つ
   */
  requiredSeen: string[];
};

export type LineEdit = { line: number; slot: number; before: string; after: string };

export function newDoc(at: string, settings: Settings = DEFAULT_SETTINGS): PoemDoc {
  return { schema: SCHEMA, events: [], snapshots: [{ at, required: [], settings }], working: emptyGrid(), nextRequiredId: 1, requiredSeen: [] };
}

const where = (line: number, slot: number, length: number) =>
  `${lineName(line)}の${length === 1 ? `${slot + 1}` : `${slot + 1}-${slot + length}`}字目`;

/** 2つのマス目の、句ごとの違い（最初に違う位置から最後に違う位置まで） */
export function diffLines(a: readonly string[], b: readonly string[]): LineEdit[] {
  const out: LineEdit[] = [];
  for (let line = 0; line * WIDTH < CELLS; line++) {
    const base = line * WIDTH;
    let first = -1;
    let last = -1;
    for (let p = 0; p < WIDTH; p++) {
      if (a[base + p] !== b[base + p]) {
        if (first < 0) first = p;
        last = p;
      }
    }
    if (first >= 0) {
      out.push({
        line,
        slot: first,
        before: a.slice(base + first, base + last + 1).join(""),
        after: b.slice(base + first, base + last + 1).join(""),
      });
    }
  }
  return out;
}

/** 記録を最初から順にたどったマス目。記録の「前」がその時点のマス目と合わなければ、誤りを返す */
export function replay(events: readonly EditEvent[]): { grid: string[] } | { error: string } {
  const grid = emptyGrid();
  for (const [k, e] of events.entries()) {
    const before = [...e.before];
    const after = [...e.after];
    if (
      !Number.isInteger(e.line) || e.line < 0 || e.line * WIDTH >= CELLS ||
      !Number.isInteger(e.slot) || e.slot < 0 || before.length === 0 ||
      before.length !== after.length || e.slot + before.length > WIDTH
    ) {
      return { error: `${k + 1}件目の記録の位置か字数が正しくありません。` };
    }
    const base = e.line * WIDTH + e.slot;
    if (before.some((c, i) => grid[base + i] !== c)) {
      return { error: `${k + 1}件目の記録（${where(e.line, e.slot, before.length)}）の「前」が、その時点のマス目と合いません。` };
    }
    after.forEach((c, i) => (grid[base + i] = c));
  }
  return { grid };
}

/** 確定済みの記録からたどったマス目（記録が正しいことは読み込むときに確かめてある） */
export function committedGrid(doc: PoemDoc): string[] {
  const r = replay(doc.events);
  if ("error" in r) throw new Error(r.error);
  return r.grid;
}

/** 未確定の手入力（句ごと） */
export const pendingEdits = (doc: PoemDoc): LineEdit[] => diffLines(committedGrid(doc), doc.working);

/** いまのマス目に入っている必須要素を、requiredSeen に加える */
function markSeen(doc: PoemDoc): PoemDoc {
  const found = currentRequired(doc)
    .filter((r) => !doc.requiredSeen.includes(r.id) && presentPlaces(r.word, doc.working).length > 0)
    .map((r) => r.id);
  return found.length === 0 ? doc : { ...doc, requiredSeen: [...doc.requiredSeen, ...found] };
}

/** 手入力でマス目を変える（記録にはしない） */
export const setWorking = (doc: PoemDoc, grid: readonly string[]): PoemDoc => markSeen({ ...doc, working: [...grid] });

const toEvents = (edits: LineEdit[], at: string, actor: Actor, origin: string | null, reason?: string): EditEvent[] => {
  const r = reason?.trim();
  return edits.map((e) => ({ at, actor, ...e, origin, ...(r ? { reason: r } : {}) }));
};

/**
 * 未確定の手入力を、句ごとに作者の記録にする。except の句（いま書いている句）は残す。
 * 未確定がなければ、同じ doc を返す。
 */
export function commitPending(doc: PoemDoc, at: string, opts: { except?: number; reason?: string } = {}): PoemDoc {
  const edits = pendingEdits(doc).filter((e) => e.line !== opts.except);
  if (edits.length === 0) return doc;
  return { ...doc, events: [...doc.events, ...toEvents(edits, at, "author", null, opts.reason)] };
}

/**
 * 操作（詩語候補・必須要素の配置・例の詩・すべて消す・貼り付けモードからの移し）でマス目を next にする。
 * 先に未確定の手入力を確定してから、操作の変化を句ごとに記録する。理由は、この呼び出しで足す記録すべてに添える。
 */
export function record(
  doc: PoemDoc,
  at: string,
  next: readonly string[],
  op: { actor: Actor; origin: string | null; reason?: string },
): PoemDoc {
  const flushed = commitPending(doc, at, op.reason !== undefined ? { reason: op.reason } : {});
  const edits = diffLines(flushed.working, next);
  if (edits.length === 0) return flushed;
  return markSeen({
    ...flushed,
    events: [...flushed.events, ...toEvents(edits, at, op.actor, op.origin, op.reason)],
    working: [...next],
  });
}

const lastSnapshot = (doc: PoemDoc) => doc.snapshots[doc.snapshots.length - 1]!;
export const currentRequired = (doc: PoemDoc): RequiredItem[] => lastSnapshot(doc).required;
export const currentSettings = (doc: PoemDoc): Settings => lastSnapshot(doc).settings;

const snapshot = (doc: PoemDoc, at: string, required: RequiredItem[], settings: Settings): PoemDoc => ({
  ...doc,
  snapshots: [...doc.snapshots, { at, required, settings }],
});

/** 必須要素を登録する（語の検査は required.ts の validateRequired で先に行う） */
export function addRequired(doc: PoemDoc, at: string, word: string): PoemDoc {
  const item = { id: `r${doc.nextRequiredId}`, word };
  return markSeen({ ...snapshot(doc, at, [...currentRequired(doc), item], currentSettings(doc)), nextRequiredId: doc.nextRequiredId + 1 });
}

export function removeRequired(doc: PoemDoc, at: string, id: string): PoemDoc {
  return snapshot(doc, at, currentRequired(doc).filter((r) => r.id !== id), currentSettings(doc));
}

/** 設定を変える。同じ設定なら同じ doc を返す */
export function setSettings(doc: PoemDoc, at: string, settings: Settings): PoemDoc {
  const cur = currentSettings(doc);
  const same = (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).every((k) => cur[k] === settings[k]);
  return same ? doc : snapshot(doc, at, currentRequired(doc), { ...settings });
}

export type RequiredWarning = { id: string; word: string; kind: "lost" | "missing" };

/**
 * 必須要素の消失警告（§4.5）。いまのマス目（未確定を含む）にない必須要素について：
 * - lost：一度は詩に入っていた（未確定の手入力で入っていた場合も含む）
 * - missing：一度も入っていないが、28字がすべて埋まった
 */
export function requiredWarnings(doc: PoemDoc): RequiredWarning[] {
  const full = doc.working.every((c) => c !== BLANK);
  return currentRequired(doc)
    .filter((r) => presentPlaces(r.word, doc.working).length === 0)
    .flatMap((r): RequiredWarning[] => {
      if (doc.requiredSeen.includes(r.id)) return [{ ...r, kind: "lost" }];
      return full ? [{ ...r, kind: "missing" }] : [];
    });
}

export type HistoryRow = {
  at: string;
  who: string;
  where: string;
  before: string;
  after: string;
  origin: string;
  reason: string | null;
};

const ACTOR_NAME: Record<Actor, string> = { author: "作者", dictionary: "辞書候補", ai: "AI" };
const ORIGIN_NAME: Record<string, string> = { sample: "例の詩", clear: "すべて消す", paste: "貼り付けモードから" };

function originLabel(doc: PoemDoc, origin: string | null): string {
  if (origin === null) return "手入力";
  if (origin.startsWith("required:")) {
    const id = origin.slice("required:".length);
    const item = doc.snapshots.flatMap((s) => s.required).find((r) => r.id === id);
    return item ? `必須要素「${item.word}」` : "必須要素";
  }
  if (origin.startsWith("phrase:")) return "詩語候補";
  return ORIGIN_NAME[origin] ?? origin;
}

/** 編集の記録の一覧（新しい順） */
export function historyView(doc: PoemDoc): HistoryRow[] {
  return doc.events
    .map((e) => ({
      at: e.at,
      who: ACTOR_NAME[e.actor],
      where: where(e.line, e.slot, [...e.before].length),
      before: e.before,
      after: e.after,
      origin: originLabel(doc, e.origin),
      reason: e.reason ?? null,
    }))
    .reverse();
}
