// 右の列の後半：選んだマスの条件と、詩語候補・入っている語の用例（DOM）。組み立ての規則は assist.ts の純関数にある。
import { constraintsAt } from "@kanshi/engine";
import type { Analysis, EngineData, Options, PhraseEntry } from "@kanshi/engine";
import {
  checkCandidates,
  constraintView,
  filledWord,
  findPhrase,
  rhymeFor,
  rowsToEntries,
  searchFileNames,
  slotCandidates,
  slotPattern,
  slotsAt,
  type Slot,
} from "./assist";
import type { PhraseStore } from "./data";
import { WIDTH } from "./grid";
import { h } from "./render";
import { lineName } from "./view";

export type AssistContext = {
  a: Analysis;
  grid: readonly string[];
  data: EngineData;
  options: Options;
  index: number;
  store: PhraseStore;
  /** data/rhymes.json の並びの韻目 */
  rhymes: readonly string[];
  /** 設定で選んだ押韻の韻目（自動なら null） */
  rhymeSetting: string | null;
  /** 選んでいる語の位置（なければ最初の位置） */
  slotName: string | null;
  /** 候補を何件まで出すか */
  limit: number;
  onSlot(name: string): void;
  onMore(): void;
  /** 語をマス目に入れる（index は語の先頭のマス） */
  onPlace(index: number, word: string): void;
};

const slotLabel = (line: number, s: Slot) => `${lineName(line)}の${s.name}字目`;

/** 用例の一覧（作者「題」 句） */
function examples(e: PhraseEntry): HTMLElement {
  return h("ul", { class: "examples" }, ...e.e.map(([author, title, text]) => h("li", { lang: "zh-Hant" }, h("span", { class: "ex-line" }, text), h("span", { class: "ex-src" }, `${author}「${title}」`))));
}

/** 開いたときに用例を読み込む details */
function lazyExamples(word: string, store: PhraseStore): HTMLElement {
  const body = h("div", {}, h("p", { class: "none" }, "読み込んでいます…"));
  const d = h("details", { class: "ex" }, h("summary", {}, "用例"), body) as HTMLDetailsElement;
  let loaded = false;
  d.addEventListener("toggle", () => {
    if (!d.open || loaded) return;
    loaded = true;
    store
      .groups([...word][0]!)
      .then((g) => {
        const e = findPhrase(g, word);
        body.replaceChildren(e && e.e.length > 0 ? examples(e) : h("p", { class: "none" }, "用例がありません。"));
      })
      .catch(() => body.replaceChildren(h("p", { class: "error" }, "用例を読み込めませんでした。")));
  });
  return d;
}

function constraintSection(ctx: AssistContext, line: number, pos: number): HTMLElement[] {
  const v = constraintView(constraintsAt(ctx.grid, ctx.data, line, pos, ctx.options), ctx.data);
  const items = v.options.map((o) =>
    h(
      "li",
      { class: o.ok ? "ok" : "ng" },
      h("span", { class: `pz pz-${o.pz === "平" ? "hei" : "soku"}` }, o.pz),
      o.ok ? "置けます" : "置くと違反が出ます",
      o.problems.length > 0 ? h("ul", { class: "problems" }, ...o.problems.map((p) => h("li", {}, p))) : null,
      o.checks.length > 0 ? h("ul", { class: "problems checks" }, ...o.checks.map((p) => h("li", {}, `要確認　${p}`))) : null,
    ),
  );
  const rhyme = v.rhyme.position
    ? h(
        "p",
        { class: "rhyme" },
        "押韻の位置です。",
        v.rhyme.groups.length > 0 ? `ほかの押韻字の韻目：${v.rhyme.groups.join("・")}` : "ほかの押韻字はまだありません。",
      )
    : null;
  return [
    h("h3", {}, "このマスの条件"),
    h("p", { class: "explain" }, "いま入っている字にかかわらず、平・仄それぞれを置いたときの判定です。"),
    h("ul", { class: "plain constraint" }, ...items),
    ...(rhyme ? [rhyme] : []),
  ];
}

async function slotSection(ctx: AssistContext, line: number, slot: Slot): Promise<HTMLElement[]> {
  const word = filledWord(ctx.grid, line, slot);
  if (word !== null) {
    // 入っている語：唐詩での用例を示すだけ。見つからなくても拒否しない（§4.4）
    const e = findPhrase(await ctx.store.groups([...word][0]!), word);
    return [
      h(
        "div",
        { class: "usage" },
        h("p", {}, h("span", { class: "cand-word", lang: "zh-Hant" }, word), e ? `唐詩での出現 ${e.n}回` : "唐詩の用例なし"),
        e
          ? examples(e)
          : h("p", { class: "explain" }, "全唐詩の七言句に2回以上出てくる語の表にありません。使えないという意味ではありません。"),
      ),
    ];
  }

  const pattern = slotPattern(ctx.a, ctx.data, line, slot);
  const endsLine = slot.start + slot.length === WIDTH;
  const rhyme = endsLine ? rhymeFor(constraintsAt(ctx.grid, ctx.data, line, WIDTH - 1, ctx.options), ctx.rhymeSetting) : undefined;
  const names = searchFileNames(pattern);
  const [index, ...files] = await Promise.all([ctx.store.searchIndex(), ...names.map((n) => ctx.store.search(n))]);
  const entries = rowsToEntries(
    names.map((name, k) => ({ name, rows: files[k]! })),
    ctx.rhymes,
    index.slots,
  );
  const fixed = Array.from({ length: slot.length }, (_, k) => {
    const c = ctx.grid[line * WIDTH + slot.start + k]!;
    return c === "＿" ? null : c;
  });
  const candidates = slotCandidates(entries, { pattern, fixed, ...(rhyme !== undefined ? { rhyme } : {}) });
  const checked = checkCandidates(candidates, ctx.grid, ctx.data, ctx.options, line, slot, ctx.limit);

  const head = h(
    "p",
    { class: "explain" },
    `定型の平仄 ${pattern}`,
    rhyme !== undefined ? `、韻目 ${rhyme}` : "",
    fixed.some((c) => c !== null) ? "、入っている字" : "",
    `で絞った語（${candidates.length}語）を、唐詩での出現回数の多い順に示します。`,
  );
  const list = h(
    "ul",
    { class: "cands" },
    ...checked.shown.map((c) => {
      const place = h("button", { type: "button", class: "small place", "aria-label": `「${c.word}」を${slotLabel(line, slot)}に入れる` }, "入れる");
      place.addEventListener("click", () => ctx.onPlace(line * WIDTH + slot.start, c.word));
      return h(
        "li",
        { class: "cand" },
        place,
        h("span", { class: "cand-word", lang: "zh-Hant" }, c.word),
        h("span", { class: "cand-meta" }, c.patterns.join("／"), endsLine && c.rhymes.length > 0 ? `　${c.rhymes.join("・")}` : "", `　${c.count}回（この位置 ${c.slotCount}回）`),
        c.status === "depends"
          ? h("details", { class: "depends" }, h("summary", {}, "字の読みによっては違反"), h("ul", {}, ...c.dependent.map((d) => h("li", {}, d))))
          : null,
        lazyExamples(c.word, ctx.store),
      );
    }),
  );
  const more = h("button", { type: "button", class: "small more" }, "さらに表示");
  more.addEventListener("click", () => ctx.onMore());
  return [
    head,
    checked.shown.length > 0 ? list : h("p", { class: "none" }, "条件に合う語が頻度表にありません。"),
    checked.excluded > 0 ? h("p", { class: "explain" }, `置くと違反が出るため除いた語：${checked.excluded}語`) : null,
    checked.remaining > 0 ? more : null,
  ].filter((x): x is HTMLElement => x !== null);
}

/** 選んだマスの条件と、語の位置ごとの詩語候補（または入っている語の用例） */
export async function assistPanel(ctx: AssistContext): Promise<HTMLElement> {
  const line = Math.floor(ctx.index / WIDTH);
  const pos = ctx.index % WIDTH;
  const slots = slotsAt(pos);
  const slot = slots.find((s) => s.name === ctx.slotName) ?? slots[0]!;
  const tabs = h(
    "div",
    { class: "slot-tabs", role: "group", "aria-label": "語の位置" },
    ...slots.map((s) => {
      const b = h("button", { type: "button", class: "small", "aria-pressed": String(s === slot), "data-slot": s.name }, `${s.name}字目`);
      b.addEventListener("click", () => ctx.onSlot(s.name));
      return b;
    }),
  );
  let body: HTMLElement[];
  try {
    body = await slotSection(ctx, line, slot);
  } catch {
    body = [h("p", { class: "error" }, "詩語頻度表を読み込めませんでした。")];
  }
  return h(
    "div",
    { class: "assist" },
    ...constraintSection(ctx, line, pos),
    h("h3", {}, "詩語"),
    h("p", { class: "explain" }, `${slotLabel(line, slot)}に入る語。`),
    tabs,
    ...body,
  );
}
