// マス目（7字×4句＝28マス）の編集。純関数で、DOM には触れない（CLAUDE.md §4.5）。
// マスには漢字1字、「々」、または未入力の「＿」が入る。

export const BLANK = "＿";
export const LINES = 4;
export const WIDTH = 7;
export const CELLS = LINES * WIDTH;

const LINE_NAMES = ["起句", "承句", "転句", "結句"];

const isHan = (c: string) => /^\p{Script=Han}$/u.test(c); // 「々」も含む
const isSpace = (c: string) => /^\s$/u.test(c);

export function emptyGrid(): string[] {
  return Array.from({ length: CELLS }, () => BLANK);
}

export type WriteResult = {
  grid: string[];
  /** 入れたあとに選ぶマス */
  next: number;
  /** 漢字でないため入れなかった文字（重複なし） */
  rejected: string[];
  /** 句の末（または4句）を越えたため入れなかった字 */
  overflow: string[];
};

/**
 * index のマスから text の字を入れる。
 * - 2字以上は同じ句の続くマスに順に入れ、句の末を越える字は入れない。改行があれば次の句の頭へ移る
 * - 漢字・「々」・「＿」だけを入れる。空白は飛ばし、ほかの文字は入れずに返す
 * - 空の文字列なら、そのマスを空にする
 */
export function writeAt(grid: readonly string[], index: number, text: string): WriteResult {
  const out = [...grid];
  if (text === "") {
    out[index] = BLANK;
    return { grid: out, next: index, rejected: [], overflow: [] };
  }
  const rejected = new Set<string>();
  const overflow: string[] = [];
  let pos = index;
  let lineEnd = (Math.floor(index / WIDTH) + 1) * WIDTH;
  let wrote = false;
  for (const c of text.replace(/\r\n?/g, "\n")) {
    if (c === "\n") {
      pos = lineEnd;
      lineEnd += WIDTH;
      continue;
    }
    if (isSpace(c)) continue;
    if (!isHan(c) && c !== BLANK) {
      rejected.add(c);
      continue;
    }
    if (pos >= lineEnd || pos >= CELLS) {
      overflow.push(c);
      continue;
    }
    out[pos++] = c;
    wrote = true;
  }
  return { grid: out, next: wrote ? Math.min(pos, CELLS - 1) : index, rejected: [...rejected], overflow };
}

/** 1句1行のテキスト。全部が未入力なら空の文字列 */
export function gridToText(grid: readonly string[]): string {
  if (grid.every((c) => c === BLANK)) return "";
  return Array.from({ length: LINES }, (_, l) => grid.slice(l * WIDTH, (l + 1) * WIDTH).join("")).join("\n");
}

/** 1句1行のテキストをマス目にする。7字×4句の漢字（と「々」「＿」）でなければ、理由を返す */
export function textToGrid(text: string): { grid: string[] } | { reasons: string[] } {
  const rows = text.split(/\r?\n/).map((l) => l.replace(/\s+$/u, ""));
  while (rows.length > 0 && rows[0] === "") rows.shift();
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  if (rows.length === 0) return { grid: emptyGrid() };
  if (rows.length !== LINES) return { reasons: [`${LINES}句ではありません（${rows.length}句）。`] };

  const reasons: string[] = [];
  const grid: string[] = [];
  rows.forEach((row, l) => {
    const chars = [...row];
    if (chars.length !== WIDTH) reasons.push(`${LINE_NAMES[l]}が${WIDTH}字ではありません（${chars.length}字）。`);
    chars.forEach((c, p) => {
      if (!isHan(c) && c !== BLANK) reasons.push(`${LINE_NAMES[l]}の${p + 1}字目「${c}」は漢字ではありません。`);
    });
    grid.push(...chars);
  });
  return reasons.length > 0 ? { reasons } : { grid };
}

export type MoveKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/** 矢印キーで移る先のマス。端では留まる */
export function moveFrom(index: number, key: MoveKey): number {
  const to = { ArrowLeft: index - 1, ArrowRight: index + 1, ArrowUp: index - WIDTH, ArrowDown: index + WIDTH }[key];
  return to >= 0 && to < CELLS ? to : index;
}
