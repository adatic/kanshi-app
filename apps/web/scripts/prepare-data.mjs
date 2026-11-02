// 判定に要るデータを data/ から apps/web/public/data/ にコピーする（ビルドのたびに作り直す。リポジトリには入れない）。
// 画面は初回にこれらの静的ファイルを取得するだけで、ほかに通信しない（CLAUDE.md §6.3）。
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const out = fileURLToPath(new URL("../public/data/", import.meta.url));
const FILES = ["chars.json", "variants.json", "kokuji.json", "forms.json", "rules.json", "rhymes.json"];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of FILES) cpSync(`${root}data/${f}`, `${out}${f}`);
console.log(`データを用意した（${FILES.length}ファイル）`);
