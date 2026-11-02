// 字の情報（平仄データ・異体字の対応・国字）と、misima 互換の記号（CLAUDE.md §4.1・§4.2・§4.3）。
import type { Cell } from "./input";
import { BLANK } from "./input";
import type { CharInfo, EngineData, PZ, Reading, Tone } from "./types";

export const pzOf = (tone: Tone): PZ => (tone === "平" ? "平" : "仄");

function copyReading(r: { tone: Tone; rhyme: string; note?: string }, via?: string): Reading {
  const out: Reading = { tone: r.tone, rhyme: r.rhyme };
  if (r.note !== undefined) out.note = r.note;
  if (via !== undefined) out.via = via;
  return out;
}

/**
 * マスの字の情報を作る。
 * - 平仄データにある字は、その読み。異体字の対応で別の字にもつながるなら、その字の読みも via 付きで加え、undetermined にする
 * - 平仄データにない字は、異体字の対応の候補の読み（via 付き）。候補が一つなら known、複数なら undetermined
 * - どちらにもなければ、国字なら kokuji、そうでなければ unknown
 * どの候補が正しいかは決めない（CLAUDE.md §4.3）。
 */
export function charInfo(cell: Cell, data: EngineData, kokuji: ReadonlySet<string>): CharInfo {
  if (cell.kind === "blank") return { char: BLANK, status: "blank", readings: [] };
  if (cell.kind === "invalid") return { char: cell.input, status: "invalid", readings: [] };

  const c = cell.char;
  const base: Pick<CharInfo, "char" | "input"> = cell.input === c ? { char: c } : { char: c, input: cell.input };
  const own = data.chars[c];
  const others = (data.variants[c] ?? []).filter((v) => v !== c && data.chars[v] !== undefined);

  const variantReadings = others.flatMap((v) => data.chars[v]!.map((r) => copyReading(r, v)));

  if (own !== undefined) {
    const readings = [
      ...own.map((r) => copyReading(r)),
      ...variantReadings,
    ];
    return { ...base, status: others.length > 0 ? "undetermined" : "known", readings };
  }
  if (others.length > 0) {
    return { ...base, status: others.length > 1 ? "undetermined" : "known", readings: variantReadings };
  }
  return { ...base, status: kokuji.has(c) ? "kokuji" : "unknown", readings: [] };
}

/** misima 互換の記号。○平 ●仄 ◎平仄両方の読み □平仄データにない ■国字 ＿未入力 ×漢字以外 */
export function symbolOf(info: CharInfo): string {
  switch (info.status) {
    case "blank":
      return BLANK;
    case "invalid":
      return "×";
    case "kokuji":
      return "■";
    case "unknown":
      return "□";
    default: {
      const pzs = new Set(info.readings.map((r) => pzOf(r.tone)));
      return pzs.size === 2 ? "◎" : pzs.has("平") ? "○" : "●";
    }
  }
}
