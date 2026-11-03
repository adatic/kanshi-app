// 保存・書き出し・読み込み（CLAUDE.md §4.7）。保存先（localStorage など）は引数で受け取り、例外は外に出さない。
// 読み込むデータは形を検査し、記録をたどってマス目が合うことまで確かめてから使う。
import { SCHEMA, replay, type EditEvent, type PoemDoc, type RequiredItem, type Settings, type Snapshot } from "./doc";
import { BLANK, CELLS, WIDTH } from "./grid";
import { MAX_REQUIRED } from "./required";

const APP = "kanshi-app";

/** localStorage のキー。スキーマの版を含める */
export const storageKey = (version: number) => `${APP}/poem/v${version}`;
export const STORAGE_KEY = storageKey(SCHEMA);

/** 保存先として使う最小限の形（localStorage と同じ） */
export type KeyValueStore = { getItem(key: string): string | null; setItem(key: string, value: string): void };

type Raw = Record<string, unknown>;
export type Migration = (raw: Raw) => Raw;

/** 版ごとの変換。キーの版のデータを、次の版にする。版1が最初の版なので、いまは空 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

/** 書き出す JSON。アプリの印と版を付ける */
export function serializeDoc(doc: PoemDoc): string {
  return JSON.stringify({ app: APP, ...doc }, null, 1);
}

/** 古い版のデータを、版ごとの変換を順にかけて target の版にする */
export function migrate(raw: Raw, target: number, steps: Readonly<Record<number, Migration>>): { raw: Raw } | { error: string } {
  let cur = raw;
  if (typeof cur.schema !== "number" || !Number.isInteger(cur.schema)) return { error: "版（schema）が書かれていません。" };
  while ((cur.schema as number) < target) {
    const v = cur.schema as number;
    const step = steps[v];
    if (step === undefined) return { error: `版${v}のファイルは、今の版に変換できません。` };
    cur = step(cur);
  }
  return { raw: cur };
}

const FORMS = ["heiki-nyuin", "heiki-funyuin", "sokki-nyuin", "sokki-funyuin"];
const ACTORS = ["author", "dictionary", "ai"];
const isHan = (c: string) => /^\p{Script=Han}$/u.test(c);
const isCell = (c: unknown) => typeof c === "string" && (c === BLANK || isHan(c));
const isCells = (s: unknown) => typeof s === "string" && [...s].length > 0 && [...s].every(isCell);
const isObj = (x: unknown): x is Raw => typeof x === "object" && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);

function isEvent(e: unknown): e is EditEvent {
  return (
    isObj(e) &&
    typeof e.at === "string" &&
    ACTORS.includes(e.actor as string) &&
    isInt(e.line) &&
    e.line >= 0 &&
    e.line * WIDTH < CELLS &&
    isInt(e.slot) &&
    isCells(e.before) &&
    isCells(e.after) &&
    (e.origin === null || typeof e.origin === "string") &&
    (e.reason === undefined || typeof e.reason === "string")
  );
}

function isSettings(s: unknown): s is Settings {
  return (
    isObj(s) &&
    (s.form === null || FORMS.includes(s.form as string)) &&
    (s.unknownAs === null || s.unknownAs === "平" || s.unknownAs === "仄") &&
    typeof s.allowKokuji === "boolean" &&
    typeof s.showPattern === "boolean" &&
    (s.rhyme === null || typeof s.rhyme === "string")
  );
}

const isRequired = (r: unknown): r is RequiredItem =>
  isObj(r) && typeof r.id === "string" && /^r\d+$/.test(r.id) && typeof r.word === "string" && [2, 3].includes([...r.word].length) && [...r.word].every(isHan);

function isSnapshot(s: unknown): s is Snapshot {
  return isObj(s) && typeof s.at === "string" && isSettings(s.settings) && Array.isArray(s.required) && s.required.length <= MAX_REQUIRED && s.required.every(isRequired);
}

/**
 * 書き出したファイル（または保存したデータ）を読み込む。古い版は変換する。
 * 形が合わない、今より新しい版、記録をたどってマス目が合わない、のいずれかなら理由を返す。
 */
export function parseDoc(text: string, steps: Readonly<Record<number, Migration>> = MIGRATIONS): { doc: PoemDoc } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "JSON として読めません。" };
  }
  if (!isObj(parsed) || parsed.app !== APP) return { error: "この作業台で書き出したファイルではありません。" };
  if (isInt(parsed.schema) && parsed.schema > SCHEMA) {
    return { error: `新しい版（${parsed.schema}）の作業台で書き出したファイルです。この作業台は版${SCHEMA}までしか読めません。` };
  }
  const m = migrate(parsed, SCHEMA, steps);
  if ("error" in m) return m;
  const raw = m.raw;

  if (!Array.isArray(raw.events)) return { error: "記録（events）がありません。" };
  for (const [k, e] of raw.events.entries()) if (!isEvent(e)) return { error: `${k + 1}件目の記録の形が正しくありません。` };
  if (!Array.isArray(raw.snapshots) || raw.snapshots.length === 0) return { error: "スナップショットがありません。" };
  for (const [k, s] of raw.snapshots.entries()) if (!isSnapshot(s)) return { error: `${k + 1}件目のスナップショットの形が正しくありません。` };
  if (!Array.isArray(raw.working) || raw.working.length !== CELLS || !raw.working.every(isCell)) {
    return { error: "マス目（working）は28マスの漢字か「＿」でなければなりません。" };
  }
  const snapshots = raw.snapshots as Snapshot[];
  const maxId = Math.max(0, ...snapshots.flatMap((s) => s.required.map((r) => Number(r.id.slice(1)))));
  if (!isInt(raw.nextRequiredId) || raw.nextRequiredId <= maxId) return { error: "必須要素の番号（nextRequiredId）が正しくありません。" };
  if (!Array.isArray(raw.requiredSeen) || !raw.requiredSeen.every((x) => typeof x === "string")) return { error: "requiredSeen の形が正しくありません。" };

  const events = raw.events as EditEvent[];
  const r = replay(events);
  if ("error" in r) return r;

  return {
    doc: {
      schema: SCHEMA,
      events,
      snapshots,
      working: raw.working as string[],
      nextRequiredId: raw.nextRequiredId,
      requiredSeen: raw.requiredSeen as string[],
    },
  };
}

/** error のとき keptAs は、壊れたデータを残したキー。残せなかったら null（そのときは元のキーに上書きしてはいけない） */
export type LoadResult = { doc: PoemDoc } | { none: true } | { unavailable: true } | { error: string; keptAs: string | null };

/**
 * 保存先から読み込む。今の版のキーになければ、前の版のキーを新しい順に探して変換する。
 * 壊れていたら、そのデータを「キー:broken」に残して理由を返す。
 */
export function loadFromStorage(store: KeyValueStore | null, steps: Readonly<Record<number, Migration>> = MIGRATIONS): LoadResult {
  if (store === null) return { unavailable: true };
  try {
    for (let v = SCHEMA; v >= 0; v--) {
      const key = storageKey(v);
      const text = store.getItem(key);
      if (text === null) continue;
      const r = parseDoc(text, steps);
      if ("doc" in r) return r;
      const keptAs = `${key}:broken`;
      try {
        store.setItem(keptAs, text);
        return { error: r.error, keptAs };
      } catch {
        return { error: r.error, keptAs: null };
      }
    }
    return { none: true };
  } catch {
    return { unavailable: true };
  }
}

/** 保存する。保存できなければ false（例外は外に出さない） */
export function saveToStorage(store: KeyValueStore | null, doc: PoemDoc): boolean {
  if (store === null) return false;
  try {
    store.setItem(STORAGE_KEY, serializeDoc(doc));
    return true;
  } catch {
    return false;
  }
}

/**
 * ブラウザの localStorage。取り出せなければ（設定で禁止など）null。
 * 書き込めるかどうかはここでは試さない（容量が埋まっていても、前回の詩は読める）。書き込めないことは saveToStorage が false で知らせる
 */
export function browserStorage(): KeyValueStore | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 貼り付けモードの本文の保存先。詩の記録とは別に持つ（7字×4句になっていない書きかけの本文もあるため） */
export const PASTE_KEY = `${APP}/paste/v${SCHEMA}`;

/** 貼り付けモードの本文と、マス目に移していない編集があるか */
export type PasteState = { text: string; dirty: boolean };

export function loadPaste(store: KeyValueStore | null): PasteState {
  const empty = { text: "", dirty: false };
  if (store === null) return empty;
  try {
    const raw: unknown = JSON.parse(store.getItem(PASTE_KEY) ?? "null");
    return isObj(raw) && typeof raw.text === "string" && typeof raw.dirty === "boolean" ? { text: raw.text, dirty: raw.dirty } : empty;
  } catch {
    return empty;
  }
}

export function savePaste(store: KeyValueStore | null, paste: PasteState): boolean {
  if (store === null) return false;
  try {
    store.setItem(PASTE_KEY, JSON.stringify(paste));
    return true;
  } catch {
    return false;
  }
}
