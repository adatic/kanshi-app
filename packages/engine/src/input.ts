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
 * - 行の前後の空白と、テキストの前後の空行は無視する（貼り付けのゆれ）
 * - 「＿」は未入力のマス
 * - 「々」は直前の漢字として扱う
 * - それ以外の漢字でない文字（句の途中の空白・記号・かな）はエラーとして位置を返す。字数には数える
 */
export function parseInput(input: string | readonly string[]): { lines: Cell[][]; errors: InputError[] } {
  const rows: string[][] =
    typeof input === "string"
      ? trimEmptyEnds(input.split(/\r?\n/).map((l) => l.replace(/^\s+|\s+$/gu, ""))).map((l) => [...l])
      : chunk([...input], 7);

  const errors: InputError[] = [];
  let previous: string | null = null;
  const lines = rows.map((row, line) =>
    row.map((input, position): Cell => {
      if (input === BLANK) return { kind: "blank", input };
      if (input === REPEAT) {
        if (previous !== null) return { kind: "han", char: previous, input };
        errors.push({ line, position, char: input, message: `${lineName(line)}の${positionName(position)}の「々」は、前に繰り返す字がありません。` });
        return { kind: "invalid", input };
      }
      if (isHan(input)) {
        previous = input;
        return { kind: "han", char: input, input };
      }
      errors.push({
        line,
        position,
        char: input,
        message: `${lineName(line)}の${positionName(position)}「${input}」は漢字ではありません。詩の本文には漢字だけを入れてください。`,
      });
      return { kind: "invalid", input };
    }),
  );
  return { lines, errors };
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
