// 判定に要るデータ（ビルド時に data/ から同梱した静的ファイル）を読み込む。ほかには通信しない（CLAUDE.md §6.3）。
import type { EngineData } from "@kanshi/engine";

const load = async <T>(name: string): Promise<T> => {
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
