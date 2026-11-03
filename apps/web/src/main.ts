// 画面の起動。マス目で作るモードと、misima 互換の貼り付けモード（CLAUDE.md §4.2・§4.5）。
import { analyze } from "@kanshi/engine";
import type { EngineData } from "@kanshi/engine";
import { assistPanel } from "./assistView";
import { loadEngineData, loadRhymes, phraseStore, type Rhyme } from "./data";
import {
  addRequired,
  commitPending,
  currentRequired,
  currentSettings,
  newDoc,
  pendingEdits,
  record,
  removeRequired,
  requiredWarnings,
  setSettings,
  setWorking,
  type Actor,
  type PoemDoc,
} from "./doc";
import { BLANK, WIDTH, emptyGrid, gridToText, textToGrid, writeAt } from "./grid";
import { parseDoc, savePaste, saveToStorage, serializeDoc } from "./storage";
import { gridEditor } from "./gridEditor";
import { MAX_REQUIRED, requiredView, validateRequired } from "./required";
import { cellPanel, h, resultParts, resultView } from "./render";
import { buildView, cellDetail, lineName } from "./view";

import { historyList, optionsOf, requiredItem, settingsPanel } from "./editorPanels";
import { exportName, startup, type Startup } from "./session";

/** 例の詩（王昌齡「春宮曲」。ゴールデンテストの q03 と同じ本文） */
const SAMPLE = ["昨夜風開露井桃", "未央前殿月輪高", "平陽歌舞新承寵", "簾外春寒賜錦袍"].join("\n");

type Mode = "grid" | "paste";

const now = () => new Date().toISOString();

function app(data: EngineData, rhymes: readonly Rhyme[], init: Startup): HTMLElement {
  let mode: Mode = "grid";
  /** 詩の記録。マス目・必須要素・設定はここから導き出す（CLAUDE.md §4.6） */
  let doc: PoemDoc = init.doc;
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
  /** 貼り付けモードの本文に、マス目（記録）へ移していない編集があるか */
  let pasteDirty = init.paste.dirty;

  const settings = settingsPanel(data, rhymes, () => {
    doc = setSettings(doc, now(), settings.get());
    update();
  });
  settings.set(currentSettings(doc));

  // ---- 確定と理由 ----
  const reasonInput = h("input", { id: "reason-input", type: "text", autocomplete: "off", placeholder: "なぜそうしたか（任意）" }) as HTMLInputElement;
  const commitButton = h("button", { type: "button", class: "small", id: "commit" }, "確定");
  const pendingNote = h("p", { class: "pending-note", id: "pending-note" });
  /** 記録が増えたら、使った理由の入力欄を空にする */
  const apply = (next: PoemDoc) => {
    if (next.events.length > doc.events.length) reasonInput.value = "";
    doc = next;
  };
  const reason = () => reasonInput.value;
  /** 操作でマス目を変え、記録する（先に未確定の手入力を確定する） */
  const operate = (next: readonly string[], actor: Actor, origin: string, focusAt: number | null) => {
    apply(record(doc, now(), next, { actor, origin, reason: reason() }));
    gridEdited = true;
    editor.setGrid(doc.working);
    syncNote.textContent = "";
    update();
    if (focusAt !== null) editor.focus(focusAt);
  };
  commitButton.addEventListener("click", () => {
    apply(commitPending(doc, now(), { reason: reason() }));
    update();
  });

  // ---- マス目で作る ----
  const editor = gridEditor({
    initial: doc.working,
    onChange(next) {
      doc = setWorking(doc, next);
      gridEdited = true;
      syncNote.textContent = "";
      update();
    },
    onSelect(i) {
      if (i !== selected) {
        slotName = null;
        limit = 20;
      }
      // 別の句に移ったら、それまでの句の手入力を確定する（§4.6：1マスではなく、句の書き換えを単位にする）
      apply(commitPending(doc, now(), { except: Math.floor(i / WIDTH), reason: reason() }));
      selected = i;
      update();
    },
  });
  const syncNote = h("p", { class: "sync-note", role: "status" });
  const warning = h("div", { class: "required-warning", role: "alert" });
  const panel = h("div", { id: "cell-panel" });
  const assistBox = h("div", { id: "assist" });
  const gridResult = h("div", { id: "grid-result", class: "result" });
  const history = h("div", { id: "history" });
  const hasPoem = () => doc.working.some((c) => c !== BLANK);
  const replaceGrid = (next: string[], origin: string, question: string) => {
    if (hasPoem() && !window.confirm(question)) return;
    operate(next, "author", origin, 0);
  };
  const gridSample = h("button", { type: "button", class: "small", id: "grid-sample" }, "例の詩を入れる");
  gridSample.addEventListener("click", () => {
    const r = textToGrid(SAMPLE);
    if ("grid" in r) replaceGrid(r.grid, "sample", "マス目の詩を、例の詩で置き換えますか？");
  });
  const gridClear = h("button", { type: "button", class: "small", id: "grid-clear" }, "すべて消す");
  gridClear.addEventListener("click", () => replaceGrid(emptyGrid(), "clear", "マス目の字をすべて消しますか？"));

  // ---- 必須要素（最大2語）と、置ける位置 ----
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
  const addRequiredWord = () => {
    const error = validateRequired(requiredInput.value, currentRequired(doc).map((r) => r.word));
    requiredNote.textContent = error ?? "";
    if (error !== null) return;
    doc = addRequired(doc, now(), requiredInput.value.trim());
    requiredInput.value = "";
    update();
  };
  requiredAdd.addEventListener("click", addRequiredWord);
  requiredInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      addRequiredWord();
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

  // ---- 保存（自動保存・書き出し・読み込み・新しく始める）（§4.7） ----
  const saveStatus = h("p", { class: "save-status", id: "save-status", role: "status" });
  const saveNote = h("p", { class: "save-note", id: "save-note", role: "status" }, init.note);
  const exportButton = h("button", { type: "button", class: "small", id: "export" }, "書き出す");
  const importButton = h("button", { type: "button", class: "small", id: "import" }, "読み込む");
  const importFile = h("input", { type: "file", id: "import-file", accept: "application/json,.json", hidden: "" }) as HTMLInputElement;
  const newButton = h("button", { type: "button", class: "small", id: "new-poem" }, "新しく始める");
  /** doc を差し替えたあと、画面の状態をそろえる */
  const resetTo = (next: PoemDoc) => {
    doc = next;
    selected = null;
    slotName = null;
    limit = 20;
    reasonInput.value = "";
    settings.set(currentSettings(doc));
    editor.setGrid(doc.working);
    // 貼り付けモードの本文も新しい詩にそろえる（古い本文が、タブを移ったときに新しい詩を上書きしないように）
    input.value = gridToText(doc.working);
    gridEdited = false;
    pasteDirty = false;
    syncNote.textContent = "";
    update();
  };
  /** 消える前に確認すべきものがあるか（マス目に移していない貼り付けの本文も含む） */
  const hasWork = () =>
    doc.events.length > 0 || hasPoem() || currentRequired(doc).length > 0 || (pasteDirty && input.value.trim() !== "");
  exportButton.addEventListener("click", () => {
    // マス目に移していない貼り付けの本文は、先にマス目に移して記録する（タブを移ったときと同じ）。
    // 移せないとき、貼り付けモードでは書き出さない。マス目モード（移せなかった本文を残したまま移ってきた）では、入らないことを示して書き出す
    const moved = movePasteToGrid();
    if (moved !== null && mode === "paste") {
      saveNote.textContent = `貼り付けた本文をマス目に移せないため、書き出していません。${moved}`;
      return;
    }
    // 書き出す前に、未確定の手入力を確定する（書き出したファイルは記録だけでマス目が決まる）
    apply(commitPending(doc, now(), { reason: reason() }));
    update();
    const url = URL.createObjectURL(new Blob([serializeDoc(doc)], { type: "application/json" }));
    const a = h("a", { href: url, download: exportName(new Date()) });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    saveNote.textContent = `書き出しました（記録 ${doc.events.length}件）。${moved !== null ? "マス目に移せなかった貼り付けモードの本文は入っていません。" : ""}`;
  });
  importButton.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", () => {
    const file = importFile.files?.[0];
    importFile.value = "";
    if (file === undefined) return;
    void file.text().then((text) => {
      const r = parseDoc(text);
      if ("error" in r) {
        saveNote.textContent = `「${file.name}」を読み込めませんでした（${r.error}）。いまの詩はそのままです。`;
        return;
      }
      if (hasWork() && !window.confirm("いまの詩を、読み込んだ詩で置き換えますか？（いまの詩を残すなら、先に書き出してください）")) return;
      resetTo(r.doc);
      saveNote.textContent = `「${file.name}」を読み込みました（記録 ${r.doc.events.length}件）。`;
    });
  });
  newButton.addEventListener("click", () => {
    if (hasWork() && !window.confirm("いまの詩と記録を消して、新しく始めますか？（残すなら、先に書き出してください）")) return;
    resetTo(newDoc(now()));
    saveNote.textContent = "新しく始めました。";
  });
  const saveCard = h(
    "section",
    { class: "save", "aria-labelledby": "save-title" },
    h("h2", { id: "save-title" }, "保存"),
    saveStatus,
    h("div", { class: "buttons" }, exportButton, importButton, newButton),
    importFile,
    saveNote,
    h("p", { class: "help" }, "書き出したファイル（JSON）には、詩と編集の記録、必須要素、設定が入っています。別の端末で読み込めば続きから作れます。"),
  );
  let lastSaved: boolean | null = null;
  const autosave = () => {
    const ok = saveToStorage(init.saveTo, doc) && savePaste(init.saveTo, { text: input.value, dirty: pasteDirty });
    if (ok === lastSaved) return;
    lastSaved = ok;
    saveStatus.textContent = ok
      ? "このブラウザに自動で保存しています。"
      : init.blocked !== null
        ? init.blocked
        : init.store === null
          ? "このブラウザでは自動保存が使えません。「書き出す」でファイルに保存してください。"
          : "自動保存できませんでした（保存できる量を超えたなど）。「書き出す」でファイルに保存してください。";
    saveStatus.classList.toggle("warn", !ok);
  };

  const gridMode = h(
    "section",
    { id: "grid-mode", class: "grid-mode", role: "tabpanel", "aria-labelledby": "tab-grid" },
    h(
      "div",
      { class: "poem-area" },
      h("h2", {}, "作詩"),
      warning,
      h("p", { class: "help" }, "1マスに1字。漢字はふだんどおり変換して入れてください。2字以上を確定すると続くマスに入ります。矢印キーで移動できます。"),
      editor.el,
      syncNote,
      h(
        "div",
        { class: "commit-row" },
        pendingNote,
        h("label", { for: "reason-input", class: "visually-hidden" }, "理由（任意）"),
        reasonInput,
        commitButton,
      ),
      h("p", { class: "help" }, "同じ句の中の手入力は、別の句に移るか「確定」を押すと、1件の記録になります。理由は書かなくてもかまいません。"),
      h("div", { class: "buttons" }, gridSample, gridClear),
    ),
    h("aside", { class: "cell-panel", "aria-labelledby": "cell-panel-title" }, h("h2", { id: "cell-panel-title" }, "選択中のマス"), panel),
    h(
      "div",
      { class: "grid-results" },
      h("h2", {}, "検査結果"),
      gridResult,
      h("h2", { class: "history-title" }, "編集の記録"),
      history,
    ),
  );

  // ---- 貼り付けて判定する ----
  const input = h("textarea", {
    id: "poem-input",
    rows: "4",
    spellcheck: "false",
    autocomplete: "off",
    "aria-describedby": "poem-help",
  }) as HTMLTextAreaElement;
  input.value = init.paste.text;
  input.addEventListener("input", () => {
    pasteDirty = true;
    update();
  });
  const output = h("div", { id: "result" });
  const sample = h("button", { type: "button", class: "small", id: "paste-sample" }, "例の詩を入れる");
  sample.addEventListener("click", () => {
    input.value = SAMPLE;
    pasteDirty = true;
    update();
  });
  const clear = h("button", { type: "button", class: "small" }, "消す");
  clear.addEventListener("click", () => {
    input.value = "";
    pasteDirty = true;
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
  /**
   * 貼り付けモードで編集した本文を、マス目に移して記録する。移せたら（または移すものがなければ）null、
   * 7字×4句の漢字にならず移せなければ理由を返す（マス目は変えない）
   */
  function movePasteToGrid(): string | null {
    if (!pasteDirty) return null;
    const r = textToGrid(input.value);
    if (!("grid" in r)) return r.reasons.join("");
    apply(record(doc, now(), r.grid, { actor: "author", origin: "paste", reason: reason() }));
    editor.setGrid(doc.working);
    pasteDirty = false;
    gridEdited = false;
    return null;
  }

  const setMode = (next: Mode) => {
    if (next === mode) return;
    if (next === "grid") {
      const reasons = movePasteToGrid();
      syncNote.textContent = reasons === null ? "" : `貼り付けた本文は、マス目に移していません。${reasons}マス目は前のままです。`;
      gridEdited = false;
    } else {
      apply(commitPending(doc, now(), { reason: reason() }));
      // マス目に移していない貼り付けの編集は残す。ただしマス目を編集したら、マス目の詩で置き換える
      if (!pasteDirty || gridEdited) {
        input.value = gridToText(doc.working);
        pasteDirty = false;
      }
    }
    mode = next;
    showMode();
    update();
  };
  function showMode() {
    refreshTabs();
    gridMode.hidden = mode !== "grid";
    pasteMode.hidden = mode !== "paste";
    requiredCard.hidden = mode !== "grid";
  }
  // マス目に移していない貼り付けの本文が残っていれば、離れたときと同じく貼り付けモードで始める
  if (pasteDirty) mode = "paste";
  showMode();
  for (const m of ["grid", "paste"] as const) {
    tabs[m].addEventListener("click", () => setMode(m));
    tabs[m].addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const other = m === "grid" ? "paste" : "grid";
      setMode(other);
      tabs[other].focus();
    });
  }

  /** 必須要素の消失警告。文が変わったときだけ書き換える（読み上げを繰り返さない） */
  const renderWarning = () => {
    const text = requiredWarnings(doc)
      .map((w) => (w.kind === "lost" ? `必須要素「${w.word}」が詩から消えています。` : `必須要素「${w.word}」が詩に入っていません。`))
      .join("");
    if (warning.textContent !== text) warning.textContent = text;
  };

  const renderHistory = () => {
    const pending = pendingEdits(doc);
    pendingNote.textContent =
      pending.length === 0
        ? "未確定の変更はありません。"
        : `未確定：${pending.map((e) => `${lineName(e.line)}「${e.before}」→「${e.after}」`).join("、")}`;
    commitButton.toggleAttribute("disabled", pending.length === 0);
    history.replaceChildren(historyList(doc));
  };

  function update() {
    autosave();
    const current = currentSettings(doc);
    const options = optionsOf(current);
    const showPattern = current.showPattern;
    if (mode === "grid") {
      const grid = doc.working;
      const a = analyze(grid, data, options);
      const v = buildView(a, data);
      editor.refresh(v, showPattern);
      renderWarning();
      renderHistory();
      requiredList.replaceChildren(
        ...currentRequired(doc).map((r) =>
          requiredItem(
            requiredView(r.word, grid, data, options),
            (at) => operate(writeAt(doc.working, at, r.word).grid, "author", `required:${r.id}`, at),
            () => {
              doc = removeRequired(doc, now(), r.id);
              update();
            },
          ),
        ),
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
        rhymeSetting: current.rhyme,
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
          operate(writeAt(doc.working, index, word).grid, "dictionary", `phrase:${word}`, at);
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
    h("div", { class: "workbench" }, h("div", { class: "side" }, settings.el, requiredCard, saveCard), gridMode, pasteMode),
  );
}

async function start() {
  const root = document.getElementById("app")!;
  try {
    const [data, rhymes] = await Promise.all([loadEngineData(), loadRhymes()]);
    root.replaceChildren(app(data, rhymes, startup()));
  } catch (e) {
    root.replaceChildren(h("p", { class: "error" }, `データを読み込めませんでした。${e instanceof Error ? e.message : ""}`));
  }
}

void start();
