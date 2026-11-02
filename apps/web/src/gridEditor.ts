// マス目エディタ（DOM）。編集の規則は grid.ts の純関数にあり、ここは入力の受け取りと表示の更新だけを持つ。
// 漢字の入力は OS の変換に任せる。変換中（未確定）は何もせず、確定した文字だけをマスに入れる（CLAUDE.md §4.5）。
import { BLANK, CELLS, WIDTH, moveFrom, writeAt, type MoveKey } from "./grid";
import { SEVERITY_MARK, SEVERITY_NAME, h } from "./render";
import type { PoemView } from "./view";

export type GridEditor = {
  el: HTMLElement;
  /** マス目の字を差し替える（表示だけ。onChange は呼ばない） */
  setGrid(grid: readonly string[]): void;
  /** 判定結果を表示に反映する */
  refresh(view: PoemView, showPattern: boolean): void;
  focus(index: number): void;
};

const LINE_NAMES = ["起句", "承句", "転句", "結句"];
const MOVE_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

export function gridEditor(opts: {
  initial: readonly string[];
  onChange(grid: string[]): void;
  onSelect(index: number): void;
}): GridEditor {
  let grid = [...opts.initial];
  const note = h("p", { class: "grid-note", role: "status" });
  const inputs: HTMLInputElement[] = [];
  const cells: HTMLElement[] = [];
  const marks: HTMLElement[] = [];
  const patternRows: HTMLElement[] = [];
  const actualRows: HTMLElement[] = [];

  const valueOf = (i: number) => (grid[i] === BLANK ? "" : grid[i]!);

  const focus = (i: number) => {
    const el = inputs[i]!;
    el.focus();
    el.select();
  };

  const commit = (i: number) => {
    const value = inputs[i]!.value;
    if (value === valueOf(i)) return; // 同じ確定を二度受けたとき（ブラウザによってイベントの順が違う）
    write(i, value);
  };

  const write = (i: number, value: string) => {
    const r = writeAt(grid, i, value);
    const messages: string[] = [];
    if (r.rejected.length > 0) messages.push(`「${r.rejected.join("」「")}」は漢字ではないので、マスに入れていません。`);
    if (r.overflow.length > 0) messages.push(`句の末を越えた「${r.overflow.join("")}」は入れていません。`);
    note.textContent = messages.join("");
    grid = r.grid;
    for (let k = 0; k < CELLS; k++) inputs[k]!.value = valueOf(k);
    opts.onChange([...grid]);
    focus(r.next);
  };

  const lines = Array.from({ length: CELLS / WIDTH }, (_, l) => {
    const rowCells = Array.from({ length: WIDTH }, (_, p) => {
      const i = l * WIDTH + p;
      const input = h("input", {
        class: "gin",
        type: "text",
        lang: "zh-Hant",
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: "false",
        enterkeyhint: "next",
        "aria-label": `${LINE_NAMES[l]}の${p + 1}字目`,
        "data-index": String(i),
      }) as HTMLInputElement;
      input.value = valueOf(i);
      let composing = false;
      input.addEventListener("compositionstart", () => {
        composing = true;
        note.textContent = "";
      });
      input.addEventListener("compositionend", () => {
        composing = false;
        // 確定のあとに来る input イベントとの順はブラウザによって違うので、一拍おいて受ける
        setTimeout(() => commit(i), 0);
      });
      input.addEventListener("input", (e) => {
        if (composing || (e as InputEvent).isComposing) return;
        commit(i);
      });
      // 1行の入力欄は貼り付けた改行を消すので、貼り付けは自分で受けて、改行で次の句へ移れるようにする
      input.addEventListener("paste", (e) => {
        const text = e.clipboardData?.getData("text/plain");
        if (text === undefined) return;
        e.preventDefault();
        write(i, text);
      });
      input.addEventListener("focus", () => {
        input.select();
        opts.onSelect(i);
      });
      // クリックでカーソルが字の前後に入ると、打った字が前後に挟まるので、常に字全体を選んだ状態にする
      input.addEventListener("mouseup", (e) => e.preventDefault());
      input.addEventListener("mousedown", (e) => {
        if (document.activeElement === input) e.preventDefault();
      });
      input.addEventListener("keydown", (e) => {
        // Safari は変換を確定する Enter を isComposing なしで送るので、keyCode 229 も変換中とみなす
        if (composing || e.isComposing || e.keyCode === 229) return;
        if (MOVE_KEYS.has(e.key)) {
          e.preventDefault();
          focus(moveFrom(i, e.key as MoveKey));
        } else if (e.key === "Backspace" && input.value === "" && i > 0) {
          e.preventDefault();
          focus(i - 1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          focus(Math.min((l + 1) * WIDTH, CELLS - 1));
        }
      });
      const mark = h("span", { class: "mark", "aria-hidden": "true" });
      const cell = h("div", { class: "gcell" }, input, mark);
      inputs.push(input);
      cells.push(cell);
      marks.push(mark);
      return cell;
    });
    const symRow = (cls: string, label: string) => {
      const row = h("div", { class: `grow ${cls}` }, h("span", { class: "row-label" }, label));
      for (let p = 0; p < WIDTH; p++) row.append(h("span", { class: "gsym" }));
      return row;
    };
    const pattern = symRow("gpat", "定型");
    const actual = symRow("gact", "実際");
    patternRows.push(pattern);
    actualRows.push(actual);
    return h(
      "div",
      { class: "gline" },
      h("span", { class: "line-name" }, LINE_NAMES[l]!),
      h("div", { class: "gcells" }, ...rowCells),
      pattern,
      actual,
    );
  });

  const el = h("div", { class: "grid-editor" }, h("div", { class: "grid-poem", role: "group", "aria-label": "詩のマス目（7字×4句）" }, ...lines), note);

  return {
    el,
    setGrid(next) {
      grid = [...next];
      for (let k = 0; k < CELLS; k++) inputs[k]!.value = valueOf(k);
      note.textContent = "";
    },
    refresh(view, showPattern) {
      view.lines.forEach((line, l) => {
        const syms = actualRows[l]!.querySelectorAll(".gsym");
        line.cells.forEach((c, p) => {
          const i = l * WIDTH + p;
          const sev = c.severity !== null && c.severity !== "ok" ? c.severity : null;
          cells[i]!.className = `gcell ${sev ? `sev-${sev}` : ""}`;
          marks[i]!.textContent = sev ? SEVERITY_MARK[sev] : "";
          inputs[i]!.setAttribute("aria-label", `${LINE_NAMES[l]}の${p + 1}字目${sev ? `（${SEVERITY_NAME[sev]}）` : ""}`);
          syms[p]!.textContent = c.symbol === BLANK ? "" : c.symbol;
        });
        const pat = patternRows[l]!;
        pat.hidden = !showPattern || line.pattern === null;
        pat.querySelectorAll(".gsym").forEach((s, p) => (s.textContent = line.pattern?.[p] ?? ""));
      });
    },
    focus,
  };
}
