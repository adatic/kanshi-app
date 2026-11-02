// 画面の起動。マス目で作るモードと、misima 互換の貼り付けモード（CLAUDE.md §4.2・§4.5）。
import { analyze } from "@kanshi/engine";
import type { EngineData, FormId, Options } from "@kanshi/engine";
import { assistPanel } from "./assistView";
import { loadEngineData, loadRhymes, phraseStore, type Rhyme } from "./data";
import { BLANK, WIDTH, emptyGrid, gridToText, textToGrid } from "./grid";
import { gridEditor } from "./gridEditor";
import { MAX_REQUIRED, requiredView, validateRequired, type RequiredView } from "./required";
import { cellPanel, h, resultParts, resultView } from "./render";
import { buildView, cellDetail } from "./view";

/** 例の詩（王昌齡「春宮曲」。ゴールデンテストの q03 と同じ本文） */
const SAMPLE = ["昨夜風開露井桃", "未央前殿月輪高", "平陽歌舞新承寵", "簾外春寒賜錦袍"].join("\n");

type Mode = "grid" | "paste";

/** 設定（マス目と貼り付けモードで共通） */
function settingsPanel(data: EngineData, rhymes: readonly Rhyme[], onChange: () => void) {
  const formSelect = h(
    "select",
    { id: "form-select" },
    h("option", { value: "" }, "自動で判定する"),
    ...data.forms.forms.map((f) => h("option", { value: f.id }, `${f.name}に固定`)),
  ) as HTMLSelectElement;
  const unknownSelect = h(
    "select",
    { id: "unknown-select" },
    h("option", { value: "" }, "平仄を問わない"),
    h("option", { value: "平" }, "平として扱う"),
    h("option", { value: "仄" }, "仄として扱う"),
  ) as HTMLSelectElement;
  const rhymeSelect = h(
    "select",
    { id: "rhyme-select" },
    h("option", { value: "" }, "自動（ほかの押韻字にそろえる）"),
    ...rhymes.filter((r) => r.tone === "平").map((r) => h("option", { value: r.id }, r.id)),
  ) as HTMLSelectElement;
  const kokuji = h("input", { id: "allow-kokuji", type: "checkbox" }) as HTMLInputElement;
  const pattern = h("input", { id: "show-pattern", type: "checkbox", checked: "" }) as HTMLInputElement;
  for (const el of [formSelect, unknownSelect, rhymeSelect, kokuji, pattern]) el.addEventListener("change", onChange);

  const el = h(
    "details",
    { class: "settings" },
    h("summary", {}, "設定"),
    h(
      "div",
      { class: "options" },
      h("label", { for: "form-select" }, "詩格"),
      formSelect,
      h("label", { for: "unknown-select" }, "平仄データにない字"),
      unknownSelect,
      h("label", { for: "rhyme-select" }, "押韻の韻目（詩語候補の絞り込み）"),
      rhymeSelect,
      h("label", { class: "check" }, kokuji, "国字があっても続ける（違反ではなく要確認にする）"),
      h("label", { class: "check" }, pattern, "平仄図式（定型）を表示する"),
    ),
  ) as HTMLDetailsElement;
  // 広い画面では開いておく。スマホ幅では畳んで、詩を先に見せる
  el.open = !window.matchMedia("(max-width: 760px)").matches;

  return {
    el,
    options(): Options {
      const o: Options = {};
      if (formSelect.value) o.form = formSelect.value as FormId;
      if (unknownSelect.value) o.unknownAs = unknownSelect.value as "平" | "仄";
      if (kokuji.checked) o.allowKokuji = true;
      return o;
    },
    showPattern: () => pattern.checked,
    rhyme: () => rhymeSelect.value || null,
  };
}

/** 必須要素1語の表示。編集と登録解除は呼び出し側に委ねる。 */
function requiredItem(
  r: RequiredView,
  onPlace: (at: number, word: string) => void,
  onRemove: (word: string) => void,
): HTMLElement {
  const placeButton = (pl: { line: number; start: number; label: string }, extra = "") => {
    const b = h("button", { type: "button", class: "small place-req", "aria-label": `「${r.word}」を${pl.label}に入れる` }, `${pl.label}${extra}`);
    const at = pl.line * WIDTH + pl.start;
    b.addEventListener("click", () => onPlace(at, r.word));
    return b;
  };
  const remove = h("button", { type: "button", class: "small remove", "aria-label": `「${r.word}」の登録を外す` }, "外す");
  remove.addEventListener("click", () => onRemove(r.word));
  return h(
    "div",
    { class: "required-item" },
    h("p", { class: "required-head" }, h("span", { class: "cand-word", lang: "zh-Hant" }, r.word), remove),
    r.present.length > 0 ? h("p", { class: "present" }, `詩に入っています：${r.present.map((p) => p.label).join("、")}`) : null,
    r.ok.length > 0 ? h("div", { class: "places" }, h("p", { class: "explain" }, "置ける位置"), ...r.ok.map((pl) => placeButton(pl))) : null,
    r.depends.length > 0
      ? h(
          "div",
          { class: "places depends" },
          h("p", { class: "explain" }, "字の読みによっては違反が出る位置"),
          ...r.depends.map((pl) => h("div", {}, placeButton(pl), h("details", {}, h("summary", {}, "理由"), h("ul", {}, ...pl.notes.map((n) => h("li", {}, n)))))),
        )
      : null,
    r.present.length === 0 && r.ok.length === 0 && r.depends.length === 0 ? h("p", { class: "none" }, "いまの詩には、違反を出さずに置ける位置がありません。") : null,
    h("p", { class: "explain counts" }, `置くと違反が出る位置 ${r.ng}　別の字と重なる位置 ${r.conflict}`),
  );
}

function app(data: EngineData, rhymes: readonly Rhyme[]): HTMLElement {
  let mode: Mode = "grid";
  let grid = emptyGrid();
  let selected: number | null = null;
  /** 詩語候補：選んでいる語の位置と、出す件数（マスを選び直すと戻す） */
  let slotName: string | null = null;
  let limit = 20;
  /** 古い候補の計算が、新しい表示を上書きしないための番号 */
  let assistTurn = 0;
  const store = phraseStore();
  const rhymeIds = rhymes.map((r) => r.id);
  /** マス目に移ってから、マス目を編集したか（貼り付けモードへ戻るときに本文を上書きするかを決める） */
  let gridEdited = false;

  const settings = settingsPanel(data, rhymes, () => update());

  // ---- マス目で作る ----
  const editor = gridEditor({
    initial: grid,
    onChange(next) {
      grid = next;
      gridEdited = true;
      syncNote.textContent = "";
      update();
    },
    onSelect(i) {
      if (i !== selected) {
        slotName = null;
        limit = 20;
      }
      selected = i;
      update();
    },
  });
  const syncNote = h("p", { class: "sync-note", role: "status" });
  const panel = h("div", { id: "cell-panel" });
  const assistBox = h("div", { id: "assist" });
  const gridResult = h("div", { id: "grid-result", class: "result" });
  const hasPoem = () => grid.some((c) => c !== BLANK);
  const replaceGrid = (next: string[], question: string) => {
    if (hasPoem() && !window.confirm(question)) return;
    grid = next;
    gridEdited = true;
    editor.setGrid(grid);
    syncNote.textContent = "";
    update();
    editor.focus(0);
  };
  const gridSample = h("button", { type: "button", class: "small", id: "grid-sample" }, "例の詩を入れる");
  gridSample.addEventListener("click", () => {
    const r = textToGrid(SAMPLE);
    if ("grid" in r) replaceGrid(r.grid, "マス目の詩を、例の詩で置き換えますか？");
  });
  const gridClear = h("button", { type: "button", class: "small", id: "grid-clear" }, "すべて消す");
  gridClear.addEventListener("click", () => replaceGrid(emptyGrid(), "マス目の字をすべて消しますか？"));

  // ---- 必須要素（最大2語）と、置ける位置 ----
  let required: string[] = [];
  const requiredInput = h("input", {
    id: "required-input",
    type: "text",
    lang: "zh-Hant",
    autocomplete: "off",
    spellcheck: "false",
    "aria-describedby": "required-help",
  }) as HTMLInputElement;
  const requiredAdd = h("button", { type: "button", class: "small", id: "required-add" }, "登録");
  const requiredNote = h("p", { class: "required-note", role: "status" });
  const requiredList = h("div", { class: "required-list" });
  const addRequired = () => {
    const error = validateRequired(requiredInput.value, required);
    requiredNote.textContent = error ?? "";
    if (error !== null) return;
    required = [...required, requiredInput.value.trim()];
    requiredInput.value = "";
    update();
  };
  requiredAdd.addEventListener("click", addRequired);
  requiredInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      addRequired();
    }
  });
  const requiredCard = h(
    "section",
    { class: "required", "aria-labelledby": "required-title" },
    h("h2", { id: "required-title" }, `必須要素（最大${MAX_REQUIRED}語）`),
    h("p", { id: "required-help", class: "help" }, "必ず残すと決めた2字・3字の語。登録すると、置ける句と位置を示します。"),
    h("div", { class: "required-entry" }, requiredInput, requiredAdd),
    requiredNote,
    requiredList,
  );

  const gridMode = h(
    "section",
    { id: "grid-mode", class: "grid-mode", role: "tabpanel", "aria-labelledby": "tab-grid" },
    h(
      "div",
      { class: "poem-area" },
      h("h2", {}, "作詩"),
      h("p", { class: "help" }, "1マスに1字。漢字はふだんどおり変換して入れてください。2字以上を確定すると続くマスに入ります。矢印キーで移動できます。"),
      editor.el,
      syncNote,
      h("div", { class: "buttons" }, gridSample, gridClear),
    ),
    h("aside", { class: "cell-panel", "aria-labelledby": "cell-panel-title" }, h("h2", { id: "cell-panel-title" }, "選択中のマス"), panel),
    h("div", { class: "grid-results" }, h("h2", {}, "検査結果"), gridResult),
  );

  // ---- 貼り付けて判定する ----
  const input = h("textarea", {
    id: "poem-input",
    rows: "4",
    spellcheck: "false",
    autocomplete: "off",
    "aria-describedby": "poem-help",
  }) as HTMLTextAreaElement;
  input.addEventListener("input", () => update());
  const output = h("div", { id: "result" });
  const sample = h("button", { type: "button", class: "small", id: "paste-sample" }, "例の詩を入れる");
  sample.addEventListener("click", () => {
    input.value = SAMPLE;
    update();
  });
  const clear = h("button", { type: "button", class: "small" }, "消す");
  clear.addEventListener("click", () => {
    input.value = "";
    update();
    input.focus();
  });
  const pasteMode = h(
    "section",
    { id: "paste-mode", class: "paste-mode", role: "tabpanel", "aria-labelledby": "tab-paste", hidden: "" },
    h(
      "div",
      { class: "entry" },
      h("h2", {}, "貼り付けて判定する"),
      h("label", { for: "poem-input" }, "詩の本文（1句1行、7字×4行）"),
      input,
      h("p", { id: "poem-help", class: "help" }, "未入力のマスは「＿」、繰り返しは「々」で書けます。句読点や空白は漢字以外の文字として位置つきで知らせます。"),
      h("div", { class: "buttons" }, sample, clear),
    ),
    output,
  );

  // ---- 切り替え ----
  const tabs: Record<Mode, HTMLElement> = {
    grid: h("button", { type: "button", role: "tab", id: "tab-grid", "aria-controls": "grid-mode" }, "マス目で作る"),
    paste: h("button", { type: "button", role: "tab", id: "tab-paste", "aria-controls": "paste-mode" }, "貼り付けて判定する"),
  };
  const refreshTabs = () => {
    for (const m of ["grid", "paste"] as const) {
      tabs[m].setAttribute("aria-selected", String(m === mode));
      tabs[m].tabIndex = m === mode ? 0 : -1;
    }
  };
  const setMode = (next: Mode) => {
    if (next === mode) return;
    if (next === "grid") {
      const r = textToGrid(input.value);
      if ("grid" in r) {
        grid = r.grid;
        editor.setGrid(grid);
        syncNote.textContent = "";
      } else {
        syncNote.textContent = `貼り付けた本文は、マス目に移していません。${r.reasons.join("")}マス目は前のままです。`;
      }
      gridEdited = false;
    } else if (gridEdited || "grid" in textToGrid(input.value)) {
      input.value = gridToText(grid);
    }
    mode = next;
    refreshTabs();
    gridMode.hidden = mode !== "grid";
    pasteMode.hidden = mode !== "paste";
    requiredCard.hidden = mode !== "grid";
    update();
  };
  refreshTabs();
  for (const m of ["grid", "paste"] as const) {
    tabs[m].addEventListener("click", () => setMode(m));
    tabs[m].addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const other = m === "grid" ? "paste" : "grid";
      setMode(other);
      tabs[other].focus();
    });
  }

  function update() {
    const options = settings.options();
    const showPattern = settings.showPattern();
    if (mode === "grid") {
      const a = analyze(grid, data, options);
      const v = buildView(a, data);
      editor.refresh(v, showPattern);
      requiredList.replaceChildren(
        ...required.map((w) => requiredItem(
          requiredView(w, grid, data, options),
          (at, word) => editor.place(at, word, at),
          (word) => {
            required = required.filter((w) => w !== word);
            update();
          },
        )),
      );
      gridResult.replaceChildren(...resultParts(v, showPattern));
      panel.replaceChildren(cellPanel(selected === null ? null : cellDetail(a, v, data, selected, options)), assistBox);
      const turn = ++assistTurn;
      if (selected === null) {
        assistBox.replaceChildren();
        return;
      }
      const at = selected;
      void assistPanel({
        a,
        grid,
        data,
        options,
        index: at,
        store,
        rhymes: rhymeIds,
        rhymeSetting: settings.rhyme(),
        slotName,
        limit,
        onSlot(name) {
          slotName = name;
          limit = 20;
          update();
        },
        onMore() {
          limit += 20;
          update();
        },
        onPlace(index, word) {
          editor.place(index, word, at);
        },
      }).then((el) => {
        if (turn === assistTurn) assistBox.replaceChildren(el);
      });
    } else {
      output.replaceChildren(resultView(buildView(analyze(input.value, data, options), data), showPattern));
    }
  }
  update();

  return h(
    "div",
    { class: "app" },
    h("div", { class: "tabs", role: "tablist", "aria-label": "入力のしかた" }, tabs.grid, tabs.paste),
    h("div", { class: "workbench" }, h("div", { class: "side" }, settings.el, requiredCard), gridMode, pasteMode),
  );
}

async function start() {
  const root = document.getElementById("app")!;
  try {
    const [data, rhymes] = await Promise.all([loadEngineData(), loadRhymes()]);
    root.replaceChildren(app(data, rhymes));
  } catch (e) {
    root.replaceChildren(h("p", { class: "error" }, `データを読み込めませんでした。${e instanceof Error ? e.message : ""}`));
  }
}

void start();
