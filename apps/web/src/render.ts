// 判定結果の表示（DOM）。利用者の入力は textContent でだけ置き、HTML として解釈させない。
import type { Severity } from "@kanshi/engine";
import type { FindingView, PoemView } from "./view";

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

/** 判定結果（詩格、記号列、指摘の一覧、作者が判断すること） */
export function resultView(v: PoemView, showPattern: boolean): HTMLElement {
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
            ...c.options.map((o) =>
              h(
                "li",
                {},
                h("span", { class: "label" }, o.label),
                o.always.length === 0 && o.sometimes.length === 0
                  ? h("span", { class: "result ok" }, "この読みなら違反なし")
                  : null,
                o.always.length > 0
                  ? h("ul", { class: "always" }, ...o.always.map((m) => h("li", {}, h("span", { class: "mark", "aria-hidden": "true" }, "✕"), m)))
                  : null,
                o.sometimes.length > 0
                  ? h(
                      "details",
                      { class: "sometimes" },
                      h("summary", {}, `ほかの字の読みによっては出る違反（${o.sometimes.length}件）`),
                      h("ul", {}, ...o.sometimes.map((m) => h("li", {}, m))),
                    )
                  : null,
              ),
            ),
          ),
        ),
      ),
    );
  }
  if (v.judgements.length === 0 && v.readingChoices.length === 0) judge.push(h("p", { class: "none" }, "ありません。"));
  sections.push(
    h(
      "section",
      {},
      h("h3", {}, `${SEVERITY_MARK.check} 作者が判断すること`, h("span", { class: "count" }, `${v.judgements.length + v.readingChoices.length}件`)),
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

  return h("div", { class: "result" }, formLine, poemTable(v, showPattern), legend, ...sections);
}
