// 詩格の判定（CLAUDE.md §4.1「詩格（定型）」）。
import { lineName } from "./messages";
import type { FormId, FormResult, PZ } from "./types";

const flip = (pz: PZ): PZ => (pz === "平" ? "仄" : "平");

/**
 * 第1句の2字目（平なら平起式、仄なら仄起式）と、第1句の末字（平なら首句入韻、仄なら不入韻）から詩格を決める。
 * - 2字目が未入力などで決まらなければ、反法・粘法（起承は逆、承転は同じ、転結は逆）で他の句の2字目から推定する
 * - どの句の2字目も決まらなければ、詩格は決めない（id: null）
 * - 末字が決まらなければ、入韻かどうかは決めず、入韻・不入韻の両方を候補として返す
 *   （どちらの定型が緩いかは起式によって違うので、両方で判定して共通する指摘だけを確定にする）
 * fixed があれば、それだけを返す。
 */
export function detectForms(pzAt: (line: number, pos: number) => PZ | null, fixed?: FormId): FormResult[] {
  if (fixed !== undefined) return [{ id: fixed, auto: false }];

  const notes: string[] = [];
  let second = pzAt(0, 1);
  if (second === null) {
    // 起句の2字目は、承句と逆、転句と逆、結句と同じ
    const fromOthers: [number, (pz: PZ) => PZ][] = [
      [1, flip],
      [2, flip],
      [3, (pz) => pz],
    ];
    for (const [line, toFirst] of fromOthers) {
      const pz = pzAt(line, 1);
      if (pz !== null) {
        second = toFirst(pz);
        notes.push(`起句の2字目が決まらないため、${lineName(line)}の2字目から反法・粘法で起式を推定しました。`);
        break;
      }
    }
  }
  if (second === null) {
    return [{ id: null, auto: true, note: "どの句の2字目も決まらないため、詩格を決めていません。定型に依存する検査はしていません。" }];
  }

  const kishiki = second === "平" ? "heiki" : "sokki";
  const last = pzAt(0, 6);
  const withNotes = (id: FormId, extra?: string): FormResult => {
    const all = extra === undefined ? notes : [...notes, extra];
    return all.length > 0 ? { id, auto: true, note: all.join("") } : { id, auto: true };
  };
  if (last === null) {
    const note = "起句の末字が決まらないため、入韻・不入韻の両方で判定しました。";
    return [withNotes(`${kishiki}-nyuin`, note), withNotes(`${kishiki}-funyuin`, note)];
  }
  return [withNotes(`${kishiki}-${last === "平" ? "nyuin" : "funyuin"}`)];
}
