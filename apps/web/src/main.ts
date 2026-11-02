// 画面の起動。いまは misima 互換の貼り付けモード（CLAUDE.md §4.2・§4.5）。
import { analyze } from "@kanshi/engine";
import type { EngineData, FormId, Options } from "@kanshi/engine";
import { loadEngineData } from "./data";
import { h, resultView } from "./render";
import { buildView } from "./view";

/** 最初に表示する例（王昌齡「春宮曲」。ゴールデンテストの q03 と同じ本文） */
const SAMPLE = ["昨夜風開露井桃", "未央前殿月輪高", "平陽歌舞新承寵", "簾外春寒賜錦袍"].join("\n");

function pasteMode(data: EngineData): HTMLElement {
  const input = h("textarea", {
    id: "poem-input",
    rows: "4",
    spellcheck: "false",
    autocomplete: "off",
    "aria-describedby": "poem-help",
  }) as HTMLTextAreaElement;
  input.value = SAMPLE;

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
  const kokuji = h("input", { id: "allow-kokuji", type: "checkbox" }) as HTMLInputElement;
  const pattern = h("input", { id: "show-pattern", type: "checkbox", checked: "" }) as HTMLInputElement;
  const output = h("div", { id: "result" });

  const update = () => {
    const options: Options = {};
    if (formSelect.value) options.form = formSelect.value as FormId;
    if (unknownSelect.value) options.unknownAs = unknownSelect.value as "平" | "仄";
    if (kokuji.checked) options.allowKokuji = true;
    const view = buildView(analyze(input.value, data, options), data);
    output.replaceChildren(resultView(view, pattern.checked));
  };
  for (const el of [input, formSelect, unknownSelect, kokuji, pattern]) el.addEventListener("input", update);
  for (const el of [formSelect, unknownSelect, kokuji, pattern]) el.addEventListener("change", update);
  update();

  const sample = h("button", { type: "button", class: "small" }, "例の詩を入れる");
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

  return h(
    "section",
    { class: "mode paste", "aria-labelledby": "paste-title" },
    h(
      "div",
      { class: "entry" },
      h("h2", { id: "paste-title" }, "貼り付けて判定する"),
      h("label", { for: "poem-input" }, "詩の本文（1句1行、7字×4行）"),
      input,
      h("p", { id: "poem-help", class: "help" }, "未入力のマスは「＿」、繰り返しは「々」で書けます。句読点や空白は漢字以外の文字として位置つきで知らせます。"),
      h("div", { class: "buttons" }, sample, clear),
      h(
        "fieldset",
        { class: "options" },
        h("legend", {}, "設定"),
        h("label", { for: "form-select" }, "詩格"),
        formSelect,
        h("label", { for: "unknown-select" }, "平仄データにない字"),
        unknownSelect,
        h("label", { class: "check" }, kokuji, "国字があっても続ける（違反ではなく要確認にする）"),
        h("label", { class: "check" }, pattern, "平仄図式を表示する"),
      ),
    ),
    output,
  );
}

async function start() {
  const app = document.getElementById("app")!;
  try {
    const data = await loadEngineData();
    app.replaceChildren(pasteMode(data));
  } catch (e) {
    app.replaceChildren(h("p", { class: "error" }, `データを読み込めませんでした。${e instanceof Error ? e.message : ""}`));
  }
}

void start();
