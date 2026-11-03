// 起動時の復元と、書き出しファイル名。保存形式は storage.ts が管理する。
import { newDoc, type PoemDoc } from "./doc";
import { browserStorage, loadFromStorage, loadPaste, type KeyValueStore, type PasteState } from "./storage";

const now = () => new Date().toISOString();

/**
 * 起動時に読み込んだ詩と、保存先。
 * saveTo は自動保存の先。壊れたデータを別のキーに残せなかったときは、元のデータを上書きしないよう null にし、blocked に理由を入れる
 */
export type Startup = { doc: PoemDoc; paste: PasteState; store: KeyValueStore | null; saveTo: KeyValueStore | null; blocked: string | null; note: string };

/** 保存先から詩を読み込む。読めなければ新しく始め、理由を note に入れる */
export function startup(): Startup {
  const store = browserStorage();
  return { ...startupDoc(store), paste: loadPaste(store) };
}

function startupDoc(store: KeyValueStore | null): Omit<Startup, "paste"> {
  const r = loadFromStorage(store);
  if ("doc" in r) return { doc: r.doc, store, saveTo: store, blocked: null, note: "前回の続きから開きました。" };
  if ("error" in r) {
    const note = `保存されていた詩を読み込めませんでした（${r.error}）。新しく始めます。`;
    return r.keptAs !== null
      ? { doc: newDoc(now()), store, saveTo: store, blocked: null, note: `${note}読めなかったデータは、このブラウザの「${r.keptAs}」に残してあります。` }
      : {
          doc: newDoc(now()),
          store,
          saveTo: null,
          blocked: "読めなかった前回のデータを別の場所に残せなかったので、上書きしないよう自動保存を止めています。「書き出す」でファイルに保存してください。",
          note,
        };
  }
  return { doc: newDoc(now()), store, saveTo: store, blocked: null, note: "" };
}

/** 書き出すファイルの名前（kanshi-20261103-0915.json） */
export const exportName = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `kanshi-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
};

