// 判定結果の表示（DOM）。利用者の入力は textContent でだけ置き、HTML として解釈させない。
import type { Severity } from "@kanshi/engine";
import type { CharStatus } from "@kanshi/engine";
import type { CellDetailView, FindingView, PoemView, ReadingFindingView, ReadingOptionView } from "./view";

type Attrs = Record<string, string>;

/** 要素を作る小さな道具。子は文字列（textContent）か要素 */
export function h(tag: string, attrs: Attrs = {}, ...children: (Node | string | null | false)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== false) el.append(c);
  return el;
}

/** 色だけに頼らないための記号（CLAUDE.md §4.5） */
export const SEVERITY_MARK: Record<Severity, string> = { ok: "", variant: "△", check: "！", violation: "✕" };
export const SEVERITY_NAME: Record<Severity, string> = { ok: "問題なし", variant: "許容される変格", check: "要確認", violation: "明確な違反" };

/** 句ごとに、字と、その下に misima 互換の記号列（と平仄図式）を並べる */
export function poemTable(v: PoemView, showPattern: boolean): HTMLElement {
  const rows = v.lines.map((line) => {
    const chars = line.cells.map((c) =>
      h(
        "span",
        {
          class: `ch ${c.severity ? `sev-${c.severity}` : ""}`,
          title: c.severity ? `${SEVERITY_NAME[c.severity]}（下の一覧を見てください）` : "",
        },
        h("span", { class: "glyph", lang: "zh-Hant" }, c.char),
        h("span", { class: "sym", "aria-label": `記号 ${c.symbol}` }, c.symbol),
        c.severity && c.severity !== "ok" ? h("span", { class: "mark", "aria-label": SEVERITY_NAME[c.severity] }, SEVERITY_MARK[c.severity]) : null,
      ),
    );
    return h(
      "div",
      { class: "line" },
      h("span", { class: "line-name" }, line.name),
      h("span", { class: "chars" }, ...chars),
      showPattern && line.pattern !== null
        ? h("span", { class: "pattern", "aria-label": `平仄図式 ${line.pattern}` }, ...[...line.pattern].map((s) => h("span", { class: "pc", "aria-hidden": "true" }, s)))
        : null,
    );
  });
  return h("div", { class: "poem" }, ...rows);
}

function findingList(items: FindingView[], severity: Severity): HTMLElement {
  return h(
    "ul",
    { class: `findings sev-${severity}` },
    ...items.map((f) =>
      h(
        "li",
        {},
        h("span", { class: "mark", "aria-hidden": "true" }, SEVERITY_MARK[severity]),
        h("span", { class: "rule" }, f.ruleName),
        h("span", { class: "where" }, f.where),
        h("span", { class: "msg" }, f.message),
      ),
    ),
  );
}

/** 読みごと・詩格ごとの欄の1件 */
const choiceItem = (f: ReadingFindingView) =>
  h("li", {}, h("span", { class: `mark sev-${f.severity}`, "aria-label": SEVERITY_NAME[f.severity] }, SEVERITY_MARK[f.severity]), `${f.ruleName}：${f.message}`);

/** 判定結果（詩格、記号列、指摘の一覧、作者が判断すること） */
export function resultView(v: PoemView, showPattern: boolean): HTMLElement {
  const [formLine, legend, ...sections] = resultParts(v, showPattern);
  return h("div", { class: "result" }, formLine!, poemTable(v, showPattern), legend!, ...sections);
}

/** 読みごとの結果の1件分（読み・必ず出る指摘・読みによって出る指摘） */
function readingOption(o: ReadingOptionView): HTMLElement {
  const nothingAdded = o.always.length === 0 && o.sometimes.length === 0;
  return h(
    "li",
    {},
    h("span", { class: "label" }, o.label),
    nothingAdded
      ? h("span", { class: `result ${o.clean ? "ok" : ""}` }, o.clean ? "この読みなら違反なし" : "この読みで加わる指摘はありません（どの読みでも出る指摘は上の一覧にあります）")
      : null,
    o.always.length > 0 ? h("ul", { class: "always" }, ...o.always.map(choiceItem)) : null,
    o.sometimes.length > 0
      ? h(
          "details",
          { class: "sometimes" },
          h("summary", {}, `ほかの字の読みによっては出る指摘（${o.sometimes.length}件）`),
          h("ul", {}, ...o.sometimes.map(choiceItem)),
        )
      : null,
  );
}

/** 詩格の行、凡例、指摘の一覧（明確な違反・作者が判断すること・許容される変格）。マス目の下と貼り付けモードで共通 */
export function resultParts(v: PoemView, showPattern: boolean): HTMLElement[] {
  const formLine = h(
    "p",
    { class: "form" },
    "詩格：",
    h("strong", {}, v.form.name ?? "未定"),
    v.form.name !== null ? `（${v.form.auto ? "自動判定" : "固定"}）` : "",
    v.form.note ? h("span", { class: "note" }, v.form.note) : null,
  );
  const legend = h(
    "p",
    { class: "legend" },
    "記号：○平　●仄　◎平仄両方の読み　□平仄データにない　■国字　＿未入力",
    showPattern ? "　／　平仄図式：○平　●仄　◐平仄を問わない　◎平声の押韻字" : "",
  );

  const sections: HTMLElement[] = [];
  if (v.errors.length > 0) {
    sections.push(h("section", { class: "errors" }, h("h3", {}, "入力の誤り"), h("ul", {}, ...v.errors.map((e) => h("li", {}, e)))));
  }
  sections.push(
    h(
      "section",
      {},
      h("h3", {}, `${SEVERITY_MARK.violation} 明確な違反`, h("span", { class: "count" }, `${v.violations.length}件`)),
      v.violations.length > 0 ? findingList(v.violations, "violation") : h("p", { class: "none" }, "ありません。"),
    ),
  );

  const judge: (HTMLElement | null)[] = [
    h("p", { class: "explain" }, "機械は判定しません。意図した作りかどうか、作者が判断してください。"),
    v.judgements.length > 0 ? findingList(v.judgements, "check") : null,
  ];
  if (v.readingChoices.length > 0) {
    judge.push(
      h("h4", {}, "読みが複数ある字"),
      h("p", { class: "explain" }, "どの読みが正しいかは文脈で決まるので、機械は決めません。読みごとに、出る違反を示します。"),
      v.independent ? h("p", { class: "note" }, "読みの組み合わせが多いため、字ごとに独立して評価しています。") : null,
      ...v.readingChoices.map((c) =>
        h(
          "div",
          { class: "choice" },
          h("p", { class: "cell" }, c.cell),
          h(
            "ul",
            {},
            ...c.options.map(readingOption),
          ),
        ),
      ),
    );
  }
  if (v.formChoices.length > 0) {
    judge.push(
      h("h4", {}, "詩格の候補ごとの指摘"),
      h("p", { class: "explain" }, "未入力のマスなどのため詩格が一つに決まりません。候補ごとに、その詩格でだけ出る指摘を示します。"),
      ...v.formChoices.map((c) =>
        h(
          "div",
          { class: "choice" },
          h("p", { class: "cell" }, c.formName),
          c.always.length === 0 && c.sometimes.length === 0 ? h("p", { class: "result" }, "この詩格で加わる指摘はありません") : null,
          c.always.length > 0 ? h("ul", { class: "always" }, ...c.always.map(choiceItem)) : null,
          c.sometimes.length > 0
            ? h(
                "details",
                { class: "sometimes" },
                h("summary", {}, `字の読みによっては出る指摘（${c.sometimes.length}件）`),
                h("ul", {}, ...c.sometimes.map(choiceItem)),
              )
            : null,
        ),
      ),
    );
  }
  if (v.judgements.length === 0 && v.readingChoices.length === 0 && v.formChoices.length === 0) judge.push(h("p", { class: "none" }, "ありません。"));
  sections.push(
    h(
      "section",
      {},
      h("h3", {}, `${SEVERITY_MARK.check} 作者が判断すること`, h("span", { class: "count" }, `${v.judgements.length + v.readingChoices.length + v.formChoices.length}件`)),
      ...judge.filter((x): x is HTMLElement => x !== null),
    ),
  );
  sections.push(
    h(
      "section",
      {},
      h("h3", {}, `${SEVERITY_MARK.variant} 許容される変格`, h("span", { class: "count" }, `${v.variants.length}件`)),
      v.variants.length > 0 ? findingList(v.variants, "variant") : h("p", { class: "none" }, "ありません。"),
    ),
  );

  return [formLine, legend, ...sections];
}

const STATUS_TEXT: Record<CharStatus, string> = {
  known: "平仄データにある字です。",
  undetermined: "異体字の対応で候補の字が複数あり、どの字か一つに決まりません。候補の字の読みをすべて示します。",
  unknown: "平仄データにない字です。平仄は判定していません（設定で平・仄のどちらかとして扱えます）。",
  kokuji: "国字（日本で作られた字）です。漢詩には使えません（設定で続けることもできます）。",
  blank: "未入力のマスです。",
  invalid: "漢字ではありません。",
};

/** 右の列：選択中のマスの字、声調・韻目、定型が求めるもの、指摘、読みごとの結果 */
export function cellPanel(d: CellDetailView | null): HTMLElement {
  if (d === null) return h("div", { class: "cell-detail" }, h("p", { class: "none" }, "マスを選ぶと、ここにその字の声調・韻目と、定型が求める平仄を示します。"));
  const parts: (HTMLElement | null)[] = [
    h("p", { class: "where" }, d.where),
    h("p", { class: `big-char ${d.char === null ? "blank" : ""}`, lang: "zh-Hant" }, d.char ?? "＿"),
    h("p", { class: "status" }, STATUS_TEXT[d.status]),
  ];
  if (d.readings.length > 0) {
    parts.push(
      h("h3", {}, "声調・韻目"),
      h("ul", { class: "plain" }, ...d.readings.map((r) => h("li", {}, h("span", { class: `pz pz-${r.pz === "平" ? "hei" : "soku"}` }, r.pz), r.label))),
    );
  }
  parts.push(
    h("h3", {}, "定型が求めるもの"),
    d.required.length === 0
      ? h("p", { class: "none" }, "詩格が決まらないため、示せません。")
      : h(
          "ul",
          { class: "plain" },
          ...d.required.map((r) =>
            h("li", {}, h("span", { class: "req-sym", "aria-hidden": "true" }, r.symbol), d.required.length > 1 ? `${r.formName}：${r.text}` : r.text),
          ),
        ),
  );
  if (d.findings.length > 0) {
    parts.push(
      h("h3", {}, "このマスの指摘"),
      h("ul", { class: "plain" }, ...d.findings.map((f) => h("li", {}, h("span", { class: `mark sev-${f.severity}`, "aria-label": SEVERITY_NAME[f.severity] }, SEVERITY_MARK[f.severity]), `${f.ruleName}：${f.message}`))),
    );
  }
  if (d.choice !== null) {
    parts.push(
      h("h3", {}, "読みごとの結果"),
      h("p", { class: "explain" }, "どの読みが正しいかは文脈で決まるので、機械は決めません。"),
      h("div", { class: "choice" }, h("ul", {}, ...d.choice.map(readingOption))),
    );
  }
  return h("div", { class: "cell-detail" }, ...parts.filter((x): x is HTMLElement => x !== null));
}
