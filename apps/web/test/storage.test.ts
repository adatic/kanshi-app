// 保存・書き出し・読み込み（apps/web/src/storage.ts）。字は平仄に関わらない架空の扱い（CLAUDE.md §0）。
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SCHEMA, addRequired, commitPending, newDoc, record, setSettings, setWorking, type PoemDoc } from "../src/doc";
import { emptyGrid, writeAt } from "../src/grid";
import { STORAGE_KEY, loadFromStorage, migrate, parseDoc, saveToStorage, serializeDoc, storageKey } from "../src/storage";
import { P } from "../../../packages/engine/test/fixture";

const T = (n: number) => `2026-11-03T10:00:${String(n).padStart(2, "0")}.000Z`;
const write = (grid: readonly string[], index: number, text: string) => writeAt(grid, index, text).grid;

/** 記録・必須要素・設定・未確定の手入力をひととおり含む doc */
function sampleDoc(): PoemDoc {
  let d = newDoc(T(0));
  d = commitPending(setWorking(d, write(d.working, 0, P[0]! + P[1]! + P[2]!)), T(1), { reason: "書き出し" });
  d = addRequired(d, T(2), P[3]! + P[4]!);
  d = record(d, T(3), write(d.working, 7, P[3]! + P[4]!), { actor: "author", origin: "required:r1" });
  d = record(d, T(4), write(d.working, 18, P[5]! + P[6]!), { actor: "dictionary", origin: `phrase:${P[5]}${P[6]}` });
  d = setSettings(d, T(5), { ...DEFAULT_SETTINGS, unknownAs: "仄", rhyme: "上平一東" });
  return setWorking(d, write(d.working, 27, P[7]!)); // 未確定の手入力
}

/** 書き換えたうえで JSON にする */
const tweak = (f: (raw: Record<string, unknown>) => void) => {
  const raw = JSON.parse(serializeDoc(sampleDoc()));
  f(raw);
  return JSON.stringify(raw);
};

/** 例外を投げられる、メモリ上の保存先 */
function memoryStorage(opts: { throwOnGet?: boolean; throwOnSet?: boolean | ((key: string) => boolean) } = {}) {
  const items = new Map<string, string>();
  return {
    items,
    getItem(k: string) {
      if (opts.throwOnGet) throw new Error("denied");
      return items.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      if (typeof opts.throwOnSet === "function" ? opts.throwOnSet(k) : opts.throwOnSet) throw new Error("quota");
      items.set(k, v);
    },
  };
}

describe("serializeDoc と parseDoc", () => {
  it("書き出して読み込むと同じ doc に戻る", () => {
    const d = sampleDoc();
    expect(parseDoc(serializeDoc(d))).toEqual({ doc: d });
  });

  it("書き出したものには、アプリの印と版が付く", () => {
    const raw = JSON.parse(serializeDoc(sampleDoc()));
    expect([raw.app, raw.schema]).toEqual(["kanshi-app", SCHEMA]);
  });

  it("JSON でない・このアプリのものでないファイルは読み込まない", () => {
    expect(parseDoc("{")).toEqual({ error: "JSON として読めません。" });
    expect(parseDoc(JSON.stringify({ hello: 1 }))).toEqual({ error: "この作業台で書き出したファイルではありません。" });
  });

  it("今より新しい版は、理由を示して読み込まない", () => {
    expect(parseDoc(tweak((r) => (r.schema = SCHEMA + 1)))).toEqual({
      error: `新しい版（${SCHEMA + 1}）の作業台で書き出したファイルです。この作業台は版${SCHEMA}までしか読めません。`,
    });
  });

  it("記録をたどってマス目が合わなければ読み込まない", () => {
    const text = tweak((r) => {
      (r.events as { before: string }[])[1]!.before = P[9]!.repeat(2);
    });
    expect(parseDoc(text)).toEqual({ error: "2件目の記録（承句の1-2字目）の「前」が、その時点のマス目と合いません。" });
  });

  it("形が合わないところを、場所を示して返す", () => {
    expect(parseDoc(tweak((r) => (r.working = ["＿"])))).toEqual({ error: "マス目（working）は28マスの漢字か「＿」でなければなりません。" });
    expect(parseDoc(tweak((r) => ((r.events as { actor: string }[])[0]!.actor = "robot")))).toEqual({ error: "1件目の記録の形が正しくありません。" });
    expect(parseDoc(tweak((r) => ((r.events as { after: string }[])[0]!.after = "abc")))).toEqual({ error: "1件目の記録の形が正しくありません。" });
    expect(parseDoc(tweak((r) => ((r.snapshots as { settings: { form: string } }[])[0]!.settings.form = "gogon")))).toEqual({
      error: "1件目のスナップショットの形が正しくありません。",
    });
    expect(parseDoc(tweak((r) => (r.snapshots = [])))).toEqual({ error: "スナップショットがありません。" });
    expect(
      parseDoc(
        tweak((r) => {
          const snaps = r.snapshots as { required: { id: string; word: string }[] }[];
          snaps[snaps.length - 1]!.required = ["r1", "r2", "r3"].map((id) => ({ id, word: P[0]! + P[1]! }));
        }),
      ),
    ).toEqual({ error: "3件目のスナップショットの形が正しくありません。" });
    expect(parseDoc(tweak((r) => (r.nextRequiredId = 1)))).toEqual({ error: "必須要素の番号（nextRequiredId）が正しくありません。" });
    expect(parseDoc(tweak((r) => delete r.requiredSeen))).toEqual({ error: "requiredSeen の形が正しくありません。" });
  });
});

describe("migrate（版ごとの変換）", () => {
  it("古い版は、版ごとの変換を順にかけて今の版にする", () => {
    const steps = {
      1: (raw: Record<string, unknown>) => ({ ...raw, schema: 2, b: 1 }),
      2: (raw: Record<string, unknown>) => ({ ...raw, schema: 3, c: 1 }),
    };
    expect(migrate({ schema: 1, a: 1 }, 3, steps)).toEqual({ raw: { schema: 3, a: 1, b: 1, c: 1 } });
  });

  it("変換のない古い版は読み込まない", () => {
    expect(migrate({ schema: 0 }, 2, { 1: (r) => ({ ...r, schema: 2 }) })).toEqual({ error: "版0のファイルは、今の版に変換できません。" });
  });

  it("版の数がなければ読み込まない", () => {
    expect(migrate({}, 1, {})).toEqual({ error: "版（schema）が書かれていません。" });
  });
});

describe("localStorage への保存", () => {
  it("キーにスキーマの版を含める", () => {
    expect(STORAGE_KEY).toBe(storageKey(SCHEMA));
    expect(STORAGE_KEY).toContain(`v${SCHEMA}`);
  });

  it("保存して読み込むと同じ doc に戻る。保存がなければ none", () => {
    const s = memoryStorage();
    expect(loadFromStorage(s)).toEqual({ none: true });
    const d = sampleDoc();
    expect(saveToStorage(s, d)).toBe(true);
    expect(loadFromStorage(s)).toEqual({ doc: d });
  });

  it("保存先がない・例外を投げるときは unavailable。保存は false を返し、例外は外に出さない", () => {
    expect(loadFromStorage(null)).toEqual({ unavailable: true });
    expect(loadFromStorage(memoryStorage({ throwOnGet: true }))).toEqual({ unavailable: true });
    expect(saveToStorage(null, sampleDoc())).toBe(false);
    expect(saveToStorage(memoryStorage({ throwOnSet: true }), sampleDoc())).toBe(false);
  });

  it("壊れたデータは理由を返し、別のキーに残す", () => {
    const s = memoryStorage();
    s.items.set(STORAGE_KEY, "{broken");
    const r = loadFromStorage(s);
    expect(r).toEqual({ error: "JSON として読めません。", keptAs: `${STORAGE_KEY}:broken` });
    expect(s.items.get(`${STORAGE_KEY}:broken`)).toBe("{broken");
  });

  it("壊れたデータを別のキーに残せなければ keptAs は null（呼び出し側は元のキーに上書きしない）", () => {
    const s = memoryStorage({ throwOnSet: (k) => k.endsWith(":broken") });
    s.items.set(STORAGE_KEY, "{broken");
    expect(loadFromStorage(s)).toEqual({ error: "JSON として読めません。", keptAs: null });
    expect(s.items.get(STORAGE_KEY)).toBe("{broken");
  });

  it("書き込めない（容量が埋まっているなど）保存先でも、保存済みの詩は読める", () => {
    const s = memoryStorage({ throwOnSet: true });
    s.items.set(STORAGE_KEY, serializeDoc(sampleDoc()));
    expect(loadFromStorage(s)).toEqual({ doc: sampleDoc() });
    expect(saveToStorage(s, sampleDoc())).toBe(false);
  });

  it("前の版のキーに保存があれば、変換して読み込む", () => {
    const s = memoryStorage();
    const old = { ...JSON.parse(serializeDoc(sampleDoc())), schema: 0 };
    s.items.set(storageKey(0), JSON.stringify(old));
    const r = loadFromStorage(s, { 0: (raw) => ({ ...raw, schema: 1 }) });
    expect(r).toEqual({ doc: sampleDoc() });
  });

  it("空の詩の doc も保存して戻せる", () => {
    const s = memoryStorage();
    const d = newDoc(T(0));
    saveToStorage(s, d);
    expect(loadFromStorage(s)).toEqual({ doc: d });
    expect((loadFromStorage(s) as { doc: PoemDoc }).doc.working).toEqual(emptyGrid());
  });
});
