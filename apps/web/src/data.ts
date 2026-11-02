// 判定に要るデータ（ビルド時に data/ から同梱した静的ファイル）を読み込む。ほかには通信しない（CLAUDE.md §6.3）。
import type { EngineData, PhraseEntry } from "@kanshi/engine";
import type { SearchRow } from "./assist";

export const load = async <T>(name: string): Promise<T> => {
  // ページの場所を基準にした相対パス（GitHub Pages のサブパスでも動く）
  const res = await fetch(new URL(`data/${name}`, document.baseURI));
  if (!res.ok) throw new Error(`${name} を読み込めませんでした（${res.status}）`);
  return (await res.json()) as T;
};

export async function loadEngineData(): Promise<EngineData> {
  const [chars, variants, kokuji, forms, rules] = await Promise.all([
    load<EngineData["chars"]>("chars.json"),
    load<EngineData["variants"]>("variants.json"),
    load<EngineData["kokuji"]>("kokuji.json"),
    load<EngineData["forms"]>("forms.json"),
    load<EngineData["rules"]>("rules.json"),
  ]);
  return { chars, variants, kokuji, forms, rules };
}

export type Rhyme = { id: string; tone: string };

/** 平水韻の韻目の一覧（data/rhymes.json の並び。探索用の索引は韻目をこの並びの番号で持つ） */
export const loadRhymes = () => load<Rhyme[]>("rhymes.json");

/**
 * 詩語頻度表の読み込み。ファイルは必要になったときに一度だけ読む。
 * - 平仄パターンの探索用の索引（phrases/search/）：パターンに合うファイルだけ
 * - 先頭の字ごとのファイル（用例つき）：用例を見るときと、入っている語を引くときだけ
 */
export function phraseStore() {
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(name: string): Promise<T> => {
    if (!cache.has(name)) cache.set(name, load<T>(name));
    return cache.get(name) as Promise<T>;
  };
  type SearchIndex = { slots: string[]; files: Record<string, number> };
  type CharIndex = { chars: Record<string, { file: string }> };
  return {
    searchIndex: () => once<SearchIndex>("phrases/search/index.json"),
    /** 索引にないファイル（そのパターンの語がない）は空 */
    async search(name: string): Promise<SearchRow[]> {
      const index = await once<SearchIndex>("phrases/search/index.json");
      return index.files[name] === undefined ? [] : once<SearchRow[]>(`phrases/search/${name}.json`);
    },
    /** 先頭の字のファイル。頻度表にない字なら undefined */
    async groups(first: string): Promise<Record<"2" | "3", PhraseEntry[]> | undefined> {
      const index = await once<CharIndex>("phrases/index.json");
      const file = index.chars[first]?.file;
      return file === undefined ? undefined : once<Record<"2" | "3", PhraseEntry[]>>(`phrases/${file}`);
    },
  };
}

export type PhraseStore = ReturnType<typeof phraseStore>;
