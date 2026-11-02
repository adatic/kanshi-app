// 利用者に見せる文言（CLAUDE.md §9：こなれた自然な日本語）。

const LINE_NAMES = ["起句", "承句", "転句", "結句"];

/** 0始まりの句番号 → 「起句」など。5句目以降は「第5句」 */
export const lineName = (line: number) => LINE_NAMES[line] ?? `第${line + 1}句`;

/** 0始まりの位置 → 「2字目」 */
export const positionName = (position: number) => `${position + 1}字目`;

