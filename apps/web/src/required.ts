// 必須要素（作者が必ず残すと決めた語。最大2語）の受け付けと、置ける位置（CLAUDE.md §4.5・§10）。純関数。
// 置けるかどうかの判定はエンジンの placementsFor だけが持つ。
import { placementsFor } from "@kanshi/engine";
import type { EngineData, Options } from "@kanshi/engine";
import { WIDTH } from "./grid";
import { lineName } from "./view";

export const MAX_REQUIRED = 2;

const isHan = (c: string) => /^\p{Script=Han}$/u.test(c);

/** 登録できない理由。登録できれば null。前後の空白は無視する */
export function validateRequired(input: string, current: readonly string[]): string | null {
  const word = input.trim();
  if (word === "") return "語を入れてください。";
  const chars = [...word];
  const bad = chars.find((c) => !isHan(c));
  if (bad !== undefined) return `漢字だけの語を入れてください（「${bad}」は漢字ではありません）。`;
  if (chars.length !== 2 && chars.length !== 3) return `2字か3字の語を入れてください（${chars.length}字）。`;
  if (current.includes(word)) return "すでに登録しています。";
  if (current.length >= MAX_REQUIRED) return `必須要素は${MAX_REQUIRED}語までです。`;
  return null;
}

export type PlaceView = { line: number; start: number; label: string };

export type RequiredView = {
  word: string;
  /** すでに詩に入っている位置 */
  present: PlaceView[];
  /** 置ける位置 */
  ok: PlaceView[];
  /** 字の読みによって違反が出る位置と、その違反 */
  depends: (PlaceView & { notes: string[] })[];
  /** 置くと違反が出る位置の数 */
  ng: number;
  /** すでにある別の字と重なる位置の数 */
  conflict: number;
};

export function requiredView(word: string, grid: readonly string[], data: EngineData, options: Options): RequiredView {
  const chars = [...word];
  const v: RequiredView = { word, present: [], ok: [], depends: [], ng: 0, conflict: 0 };
  for (const p of placementsFor(word, grid, data, options)) {
    const place = { line: p.line, start: p.start, label: `${lineName(p.line)}の${p.slot}字目` };
    if (chars.every((c, k) => grid[p.line * WIDTH + p.start + k] === c)) v.present.push(place);
    else if (p.status === "ok") v.ok.push(place);
    else if (p.status === "depends")
      v.depends.push({ ...place, notes: p.dependent.map((f) => `${data.rules.rules[f.rule]?.name ?? f.rule}：${f.message}`) });
    else if (p.status === "conflict") v.conflict++;
    else v.ng++;
  }
  return v;
}
