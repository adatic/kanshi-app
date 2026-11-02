// 入力の解析（CLAUDE.md §4.1「入力」）。
import type { InputError } from "./types";
import { lineName, positionName } from "./messages";

export const BLANK = "＿";
const REPEAT = "々";

export type Cell =
  | { kind: "han"; char: string; input: string }
  | { kind: "blank"; input: string }
  | { kind: "invalid"; input: string };

const isHan = (c: string) => /^\p{Script=Han}$/u.test(c);

/**
 * 1句1行のテキスト、または28マスの配列を、句ごとのマスに分ける。
 * - テキストの前後の空行（字のない行）は無視する。行の中の空白は、前後も含めて漢字以外の文字として扱う
 * - 「＿」は未入力のマス
 * - 「々」は同じ句の直前のマスの字として扱う。直前が未入力なら「々」も未入力。句頭や、直前が漢字以外ならエラー
 * - それ以外の漢字でない文字（空白・記号・かな）はエラーとして位置を返す。字数には数える（CLAUDE.md §4.1）
 */
export function parseInput(input: string | readonly string[]): { lines: Cell[][]; errors: InputError[] } {
  const rows: string[][] =
    typeof input === "string"
      ? trimEmptyEnds(input.split(/\r?\n/)).map((l) => [...l])
      : chunk([...input], 7);

  const errors: InputError[] = [];
  const lines = rows.map((row, line) => {
    const cells: Cell[] = [];
    row.forEach((input, position) => cells.push(toCell(input, line, position, cells[position - 1])));
    return cells;
  });
  return { lines, errors };

  function toCell(input: string, line: number, position: number, before: Cell | undefined): Cell {
    if (input === BLANK) return { kind: "blank", input };
    if (input === REPEAT) {
      if (before?.kind === "han") return { kind: "han", char: before.char, input };
      if (before?.kind === "blank") return { kind: "blank", input };
      errors.push({ line, position, char: input, message: `${lineName(line)}の${positionName(position)}の「々」は、直前に繰り返す漢字がありません。` });
      return { kind: "invalid", input };
    }
    if (isHan(input)) return { kind: "han", char: input, input };
    errors.push({
      line,
      position,
      char: input,
      message: `${lineName(line)}の${positionName(position)}「${input}」は漢字ではありません。詩の本文には漢字だけを入れてください。`,
    });
    return { kind: "invalid", input };
  }
}

function trimEmptyEnds(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start++;
  while (end > start && lines[end - 1] === "") end--;
  return lines.slice(start, end);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
