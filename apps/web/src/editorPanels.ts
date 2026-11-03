// 作詩画面の表示部品。文書の変更は呼び出し側に委ねる。
import type { EngineData, FormId, Options } from "@kanshi/engine";
import type { Rhyme } from "./data";
import { historyView, type PoemDoc, type Settings } from "./doc";
import { WIDTH } from "./grid";
import type { RequiredView } from "./required";
import { h } from "./render";

/** 設定（マス目と貼り付けモードで共通） */
export function settingsPanel(data: EngineData, rhymes: readonly Rhyme[], onChange: () => void) {
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
    get(): Settings {
      return {
        form: (formSelect.value || null) as FormId | null,
        unknownAs: (unknownSelect.value || null) as "平" | "仄" | null,
        allowKokuji: kokuji.checked,
        showPattern: pattern.checked,
        rhyme: rhymeSelect.value || null,
      };
    },
    set(v: Settings) {
      formSelect.value = v.form ?? "";
      unknownSelect.value = v.unknownAs ?? "";
      kokuji.checked = v.allowKokuji;
      pattern.checked = v.showPattern;
      rhymeSelect.value = v.rhyme ?? "";
    },
  };
}

/** 設定から、エンジンに渡す判定の条件 */
export function optionsOf(s: Settings): Options {
  const o: Options = {};
  if (s.form !== null) o.form = s.form;
  if (s.unknownAs !== null) o.unknownAs = s.unknownAs;
  if (s.allowKokuji) o.allowKokuji = true;
  return o;
}

/** 記録の時刻を、画面に出す短い形にする */
const timeLabel = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 必須要素1語の表示。編集と登録解除は呼び出し側に委ねる。 */
export function requiredItem(
  r: RequiredView,
  onPlace: (at: number) => void,
  onRemove: () => void,
): HTMLElement {
  const placeButton = (pl: { line: number; start: number; label: string }, extra = "") => {
    const b = h("button", { type: "button", class: "small place-req", "aria-label": `「${r.word}」を${pl.label}に入れる` }, `${pl.label}${extra}`);
    const at = pl.line * WIDTH + pl.start;
    b.addEventListener("click", () => onPlace(at));
    return b;
  };
  const remove = h("button", { type: "button", class: "small remove", "aria-label": `「${r.word}」の登録を外す` }, "外す");
  remove.addEventListener("click", () => onRemove());
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

/** 編集記録の表示（新しい順）。 */
export function historyList(doc: PoemDoc): HTMLElement {
  const rows = historyView(doc);
  return (
    rows.length === 0
      ? h("p", { class: "none" }, "まだ記録はありません。")
      : h(
          "ol",
          { class: "history", reversed: "" },
          ...rows.map((r) =>
            h(
              "li",
              {},
              h("span", { class: "h-time" }, timeLabel(r.at)),
              h("span", { class: `h-who ${r.who === "作者" ? "" : "dict"}` }, r.who),
              h("span", { class: "h-where" }, r.where),
              h("span", { class: "h-change", lang: "zh-Hant" }, `${r.before} → ${r.after}`),
              h("span", { class: "h-origin" }, r.origin),
              r.reason !== null ? h("span", { class: "h-reason" }, `理由：${r.reason}`) : null,
            ),
          ),
        )
  );
}
