// マス目の編集（apps/web/src/grid.ts）。字はどれも架空の扱いで、平仄には関わらない。
import { describe, expect, it } from "vitest";
import { BLANK, emptyGrid, gridToText, moveFrom, textToGrid, writeAt } from "../src/grid";
import { P } from "../../../packages/engine/test/fixture";

const row = (n: number) => P.slice(n * 7, n * 7 + 7).join("");
const full = () => [row(0), row(1), row(2), row(3)].join("\n");

describe("writeAt", () => {
  it("1字なら、そのマスに入れて次のマスへ進む", () => {
    const r = writeAt(emptyGrid(), 3, P[0]!);
    expect(r.grid[3]).toBe(P[0]);
    expect(r.grid.filter((c) => c !== BLANK)).toHaveLength(1);
    expect(r.next).toBe(4);
    expect([r.rejected, r.overflow]).toEqual([[], []]);
  });

  it("2字以上は、同じ句の続くマスに順に入れる", () => {
    const r = writeAt(emptyGrid(), 7, P[0]! + P[1]! + P[2]!);
    expect(r.grid.slice(7, 10)).toEqual([P[0], P[1], P[2]]);
    expect(r.next).toBe(10);
  });

  it("句の末を越える字は入れずに overflow で返す", () => {
    const r = writeAt(emptyGrid(), 5, P[0]! + P[1]! + P[2]!);
    expect(r.grid.slice(5, 7)).toEqual([P[0], P[1]]);
    expect(r.grid[7]).toBe(BLANK); // 次の句には入れない
    expect(r.overflow).toEqual([P[2]]);
  });

  it("句の末のマスを埋めたら、次の句の頭へ進む（最後の句の末ならそこに留まる）", () => {
    expect(writeAt(emptyGrid(), 6, P[0]!).next).toBe(7);
    expect(writeAt(emptyGrid(), 27, P[0]!).next).toBe(27);
  });

  it("改行があれば次の句の頭へ移る（詩全体の貼り付け）", () => {
    const r = writeAt(emptyGrid(), 0, full());
    expect(gridToText(r.grid)).toBe(full());
    expect([r.rejected, r.overflow]).toEqual([[], []]);
  });

  it("4句を越える行は overflow で返す", () => {
    const r = writeAt(emptyGrid(), 21, `${row(3)}\n${P[0]}`);
    expect(r.overflow).toEqual([P[0]]);
  });

  it("漢字以外（かな・記号）はマスに入れず rejected で返す。空白は黙って飛ばす", () => {
    const r = writeAt(emptyGrid(), 0, `あ${P[0]} ，${P[1]}　`);
    expect(r.grid.slice(0, 3)).toEqual([P[0], P[1], BLANK]);
    expect(r.rejected).toEqual(["あ", "，"]);
  });

  it("「々」と「＿」（未入力）は入れられる", () => {
    const r = writeAt(writeAt(emptyGrid(), 0, P[0]! + "々").grid, 0, BLANK);
    expect(r.grid.slice(0, 2)).toEqual([BLANK, "々"]);
  });

  it("空の文字列はマスを空にし、その場に留まる", () => {
    const g = writeAt(emptyGrid(), 4, P[0]!).grid;
    const r = writeAt(g, 4, "");
    expect(r.grid[4]).toBe(BLANK);
    expect(r.next).toBe(4);
  });

  it("漢字が一つもなければ、マスを変えない", () => {
    const g = writeAt(emptyGrid(), 4, P[0]!).grid;
    const r = writeAt(g, 4, "あ");
    expect(r.grid).toEqual(g);
    expect(r.next).toBe(4);
  });

  it("元のマス目は変えない（純関数）", () => {
    const g = emptyGrid();
    writeAt(g, 0, P[0]!);
    expect(g.every((c) => c === BLANK)).toBe(true);
  });
});

describe("gridToText と textToGrid", () => {
  it("往復して同じになる（未入力は＿）", () => {
    const g = writeAt(emptyGrid(), 0, full()).grid;
    g[9] = BLANK;
    expect(textToGrid(gridToText(g))).toEqual({ grid: g });
  });

  it("全部が未入力なら空の文字列。空の文字列は全部が未入力のマス目", () => {
    expect(gridToText(emptyGrid())).toBe("");
    expect(textToGrid("")).toEqual({ grid: emptyGrid() });
    expect(textToGrid("\n\n")).toEqual({ grid: emptyGrid() });
  });

  it("前後の空行と、行末の空白は無視する", () => {
    expect(textToGrid(`\n${full().replaceAll("\n", " \n")}\n`)).toEqual(textToGrid(full()));
  });

  it("4句でない本文はマス目にせず、理由を返す", () => {
    expect(textToGrid([row(0), row(1), row(2)].join("\n"))).toEqual({ reasons: ["4句ではありません（3句）。"] });
  });

  it("7字でない句、漢字以外の字は、句と位置を示して理由を返す", () => {
    const text = [row(0).slice(0, 6), row(1), `${row(2).slice(0, 2)}，${row(2).slice(3)}`, row(3)].join("\n");
    expect(textToGrid(text)).toEqual({
      reasons: ["起句が7字ではありません（6字）。", "転句の3字目「，」は漢字ではありません。"],
    });
  });
});

describe("moveFrom", () => {
  it("左右は前後のマス、上下は前後の句の同じ位置。端では留まる", () => {
    expect(moveFrom(8, "ArrowRight")).toBe(9);
    expect(moveFrom(8, "ArrowLeft")).toBe(7);
    expect(moveFrom(8, "ArrowDown")).toBe(15);
    expect(moveFrom(8, "ArrowUp")).toBe(1);
    expect(moveFrom(0, "ArrowLeft")).toBe(0);
    expect(moveFrom(27, "ArrowRight")).toBe(27);
    expect(moveFrom(3, "ArrowUp")).toBe(3);
    expect(moveFrom(24, "ArrowDown")).toBe(24);
  });
});
