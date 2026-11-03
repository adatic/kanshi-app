// ビルドした画面の E2E 確認（CLAUDE.md §6.3）。`npm run web:e2e` で走る（ビルドしてから実行する）。
// 期待値は記憶ではなく、ゴールデンテストのスナップショット（エンジンが出した結果）から取る。
// SHOTS_DIR を渡すと、確認用の画面写真をそこに保存する。
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const webDir = fileURLToPath(new URL("../", import.meta.url));
const root = fileURLToPath(new URL("../../../", import.meta.url));
const PORT = 4173;
const ORIGIN = `http://localhost:${PORT}`;
const shots = process.env.SHOTS_DIR;
if (shots) mkdirSync(shots, { recursive: true });

const snapshot = JSON.parse(readFileSync(`${root}golden/snapshot.json`, "utf-8"));
const input = JSON.parse(readFileSync(`${root}golden/input.json`, "utf-8"));
const poem = (id) => input.poems.find((p) => p.id === id);
const snap = (id) => snapshot.poems.find((p) => p.id === id);

// 頻度表（data/phrases）から語の出現回数を引く。なければ null
const phraseIndex = JSON.parse(readFileSync(`${root}data/phrases/index.json`, "utf-8"));
const phraseGroups = (c) => {
  const f = phraseIndex.chars[c]?.file;
  return f ? JSON.parse(readFileSync(`${root}data/phrases/${f}`, "utf-8")) : { 2: [], 3: [] };
};
const phraseCount = (w) => phraseGroups([...w][0])[String([...w].length)].find((e) => e.w === w)?.n ?? null;
/** first から始まり、頻度表にない2字語（2字目は候補から選ぶ） */
const absentPair = (first, seconds) => {
  const x = seconds.find((c) => phraseCount(first + c) === null);
  if (x === undefined) throw new Error("頻度表にない語を作れない");
  return first + x;
};

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "NG  "} ${message}`);
  if (!ok) failures.push(message);
};

// npx を挟むと、止めたときに中の Vite が残るので、Vite を直接起動する
const viteBin = fileURLToPath(new URL("../../../node_modules/vite/bin/vite.js", import.meta.url));
const server = spawn(process.execPath, [viteBin, "preview", "--port", String(PORT), "--strictPort"], { cwd: webDir, stdio: "pipe" });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("vite preview が起動しない")), 20000);
  server.stdout.on("data", (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(timer);
      resolve();
    }
  });
  server.on("exit", (code) => reject(new Error(`vite preview が終了した（${code}）`)));
});

const browser = await chromium.launch();
try {
  for (const [label, viewport, colorScheme] of [
    ["desktop", { width: 1280, height: 900 }, "light"],
    ["phone", { width: 390, height: 844 }, "light"],
    ["phone-dark", { width: 390, height: 844 }, "dark"],
  ]) {
    const page = await browser.newPage({ viewport, colorScheme });
    const outside = [];
    page.on("request", (req) => {
      if (!req.url().startsWith(ORIGIN)) outside.push(req.url());
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("dialog", (d) => d.accept());
    await page.goto(`${ORIGIN}/`);
    await page.waitForSelector("#grid-mode .gin");
    const cell = (i) => page.locator(`.gin[data-index="${i}"]`);
    const pasteText = (text) =>
      page.evaluate((t) => {
        const dt = new DataTransfer();
        dt.setData("text/plain", t);
        document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      }, text);
    const focused = () => page.evaluate(() => Number(document.activeElement?.getAttribute("data-index") ?? -1));
    const actualSymbols = () =>
      page.$$eval("#grid-mode .grow.gact", (rows) => rows.map((r) => [...r.querySelectorAll(".gsym")].map((s) => s.textContent || "＿").join("")));

    // ---- マス目で作る（最初の画面） ----
    if (label === "desktop") {
      // 3列：設定・作詩・選択中のマスが左から並ぶ
      const xs = await Promise.all([".settings", ".poem-area", ".cell-panel"].map((s) => page.locator(s).boundingBox().then((b) => b.x)));
      check(xs[0] < xs[1] && xs[1] < xs[2], `${label}: 設定・作詩・選択中のマスが3列に並ぶ（x=${xs.map(Math.round).join(", ")}）`);
    } else {
      const ys = await Promise.all([".settings", ".poem-area", ".cell-panel", ".grid-results"].map((s) => page.locator(s).boundingBox().then((b) => b.y)));
      check(ys.every((y, k) => k === 0 || ys[k - 1] < y), `${label}: 設定・作詩・選択中のマス・検査結果が縦に積まれる`);
    }

    // 1句ずつ確定して入れると、続くマスに入り、次の句の頭へ進む。記号列がスナップショット q03 と一致する
    const q03 = poem("q03").lines;
    await cell(0).click();
    for (const line of q03) await page.keyboard.insertText(line);
    check((await focused()) === 27, `${label}: 1句ずつの確定で最後のマスまで進む（いま ${await focused()}）`);
    check(JSON.stringify(await actualSymbols()) === JSON.stringify(snap("q03").symbols), `${label}: マス目の記号列がスナップショット q03 と一致`);

    // 変換中（未確定）は判定せず、確定した字だけを入れる
    const cdp = await page.context().newCDPSession(page);
    await cell(0).click();
    const before = await actualSymbols();
    await cdp.send("Input.imeSetComposition", { text: "かな", selectionStart: 2, selectionEnd: 2 });
    // 変換中に確定扱いすると、かなは漢字でないとして消され、理由が出る
    const composingNote = await page.locator(".grid-note").textContent();
    const preedit = await cell(0).inputValue();
    check(
      JSON.stringify(await actualSymbols()) === JSON.stringify(before) && composingNote === "" && preedit === "かな",
      `${label}: 変換中は確定扱いせず、判定し直さない（入力欄「${preedit}」、知らせ「${composingNote}」）`,
    );
    await cdp.send("Input.insertText", { text: q03[1].slice(0, 2) });
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-index") === "2");
    const two = await Promise.all([cell(0).inputValue(), cell(1).inputValue()]);
    check(two.join("") === q03[1].slice(0, 2), `${label}: 2字の確定が続く2マスに入る（${two.join("")}）`);
    // 元に戻す
    await cell(0).click();
    await page.keyboard.insertText(q03[0].slice(0, 2));

    // かなはマスに入れず、理由を示す
    await cell(5).click();
    await page.keyboard.insertText("か");
    const note = await page.locator(".grid-note").textContent();
    check(note.includes("漢字ではない") && (await cell(5).inputValue()) === q03[0][5], `${label}: かなは入れずに理由を示す`);

    // 矢印キーで移動し、選んだマスを右の列に示す
    await cell(8).click();
    await page.keyboard.press("ArrowDown");
    check((await focused()) === 15, `${label}: 下矢印で次の句の同じ位置へ`);
    const where = await page.locator("#cell-panel .where").textContent();
    check(where === "転句の2字目", `${label}: 選んだマスの場所を示す（${where}）`);
    const big = await page.locator("#cell-panel .big-char").textContent();
    check(big === q03[2][1], `${label}: 選んだマスの字を示す`);

    // 空のマスで Backspace を押すと前のマスに戻る
    await cell(20).click();
    await page.keyboard.press("Backspace");
    check((await cell(20).inputValue()) === "", `${label}: Backspace で字を消す`);
    await page.keyboard.press("Backspace");
    check((await focused()) === 19, `${label}: 空のマスで Backspace を押すと前のマスへ`);
    await cell(20).click();
    await page.keyboard.insertText(q03[2][6]);

    // 詩全体（改行つき）の貼り付けは、句ごとに分けて入る
    await page.locator("#grid-clear").click();
    await cell(0).click();
    await pasteText(q03.join("\n"));
    check(JSON.stringify(await actualSymbols()) === JSON.stringify(snap("q03").symbols), `${label}: 詩全体の貼り付けが句ごとに入る`);
    if (shots) await page.screenshot({ path: `${shots}/${label}-grid.png`, fullPage: true });

    // ---- 選んだマスの条件と詩語候補 ----
    // 入っている語は、頻度表（data/phrases）にあれば出現回数を、なければ「唐詩の用例なし」を示す
    const word0 = q03[0].slice(0, 2);
    const inTable = phraseCount(word0);
    await cell(0).click();
    await page.waitForSelector("#assist .usage");
    const usage = await page.locator("#assist .usage").textContent();
    check(
      inTable === null ? usage.includes("唐詩の用例なし") : usage.includes(`唐詩での出現 ${inTable}回`),
      `${label}: 入っている語「${word0}」の唐詩での用例を、頻度表どおりに示す（${inTable ?? "なし"}）`,
    );
    const absent = absentPair(q03[3][0], [...q03.join("")]);
    await cell(22).click();
    await page.keyboard.insertText(absent[1]);
    await cell(21).click();
    await page.waitForFunction(() => document.querySelector("#assist .usage")?.textContent?.includes("唐詩の用例なし"));
    check(true, `${label}: 頻度表にない語「${absent}」は「唐詩の用例なし」と示すだけ（入力はそのまま）`);
    check((await cell(22).inputValue()) === absent[1], `${label}: 用例のない語も入力として残る`);
    await cell(22).click();
    await page.keyboard.insertText(q03[3][1]);

    // 空きマスを選ぶと、条件と候補が出る。候補を入れると、その語がマスに入り、違反は増えない
    await cell(18).click();
    await page.keyboard.press("Backspace");
    await cell(19).click();
    await page.keyboard.press("Backspace");
    await cell(18).click();
    await page.locator('#assist .slot-tabs button[data-slot="5-6"]').click();
    await page.waitForSelector("#assist .constraint li");
    const constraintItems = await page.locator("#assist .constraint > li").count();
    check(constraintItems === 2, `${label}: 空きマスの条件（平・仄）を示す`);
    await page.waitForSelector("#assist .cand");
    const cands = await page.locator("#assist .cand").count();
    check(cands > 0 && cands <= 20, `${label}: 転句5-6字目の詩語候補を示す（${cands}語）`);
    const metas = await page.$$eval("#assist .cand .cand-meta", (m) => m.map((x) => x.textContent));
    check(metas.every((m) => m.includes("末字") && /\d+回/.test(m)), `${label}: 句末でない位置の候補にも、末字の韻目と出現回数を示す`);
    const first = await page.locator("#assist .cand .cand-word").first().textContent();
    const firstDepends = (await page.locator("#assist .cand").first().locator(".depends").count()) > 0;
    // 用例は開いたときに読み込む
    await page.locator("#assist .cand").first().locator("details.ex summary").click();
    await page.waitForSelector("#assist .cand details.ex .examples li");
    check(true, `${label}: 候補の用例を開くと読み込んで示す`);
    if (shots) await page.locator(".cell-panel").screenshot({ path: `${shots}/${label}-cands.png` });
    await page.locator("#assist .cand .place").first().click();
    const placed = (await cell(18).inputValue()) + (await cell(19).inputValue());
    check(placed === first, `${label}: 候補「${first}」を入れるとマスに入る（${placed}）`);
    const violationsAfter = await page.$$eval("#grid-result .findings.sev-violation li", (li) => li.length);
    check(firstDepends || violationsAfter === 0, `${label}: 置ける候補を入れても明確な違反は出ない（${violationsAfter}件）`);
    await page.waitForSelector("#assist .usage");
    check((await page.locator("#assist .usage").textContent()).includes(first), `${label}: 入れたあとは、その語の用例を示す`);
    if (shots) await page.screenshot({ path: `${shots}/${label}-assist.png`, fullPage: true });
    // 元の詩に戻す
    await cell(18).click();
    await page.keyboard.insertText(q03[2].slice(4, 6));

    // ---- 必須要素 ----
    const register = async (w) => {
      await page.fill("#required-input", w);
      await page.locator("#required-add").click();
    };
    await register("あい");
    check((await page.locator(".required-note").textContent()).includes("漢字だけ"), `${label}: 必須要素は漢字以外を理由つきで断る`);
    await register(word0);
    check(
      (await page.locator(".required-item .present").first().textContent()).includes("起句の1-2字目"),
      `${label}: 詩に入っている必須要素は、その位置を示す`,
    );
    // 空のマス目に、もう一つの語を置ける位置から入れる
    const word2 = q03[2].slice(4, 6);
    await page.locator("#grid-clear").click();
    await register(word2);
    const item2 = page.locator(".required-item").nth(1);
    const places = await item2.locator(".place-req").count();
    check(places > 0, `${label}: 必須要素の置ける位置を示す（${places}か所）`);
    const target = await item2.locator(".place-req").first().textContent();
    await item2.locator(".place-req").first().click();
    check((await item2.locator(".present").textContent()).includes(target), `${label}: 置ける位置を選ぶと、その位置に入る（${target}）`);
    await register(q03[1].slice(0, 2));
    check((await page.locator(".required-note").textContent()).includes("2語まで"), `${label}: 必須要素は2語まで`);
    await page.locator(".required-item .remove").first().click();
    check((await page.locator(".required-item").count()) === 1, `${label}: 必須要素の登録を外せる`);
    // 列の中身が隣の列にはみ出さない（ページ全体がはみ出さなくても、列どうしで重なることがある）
    const spill = await page.evaluate(() =>
      [".side", ".poem-area", ".cell-panel"].flatMap((sel) => {
        const box = document.querySelector(sel).getBoundingClientRect();
        return [...document.querySelectorAll(`${sel} *`)]
          .filter((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().right > box.right + 1)
          .map((el) => `${sel} ${el.tagName.toLowerCase()}.${el.className}`);
      }),
    );
    check(spill.length === 0, `${label}: 列の中身が列の外にはみ出さない${spill.length ? `（${spill.slice(0, 3).join(", ")}）` : ""}`);
    if (shots) await page.screenshot({ path: `${shots}/${label}-required.png`, fullPage: true });
    // 元の詩に戻す（詩全体の貼り付け）
    await page.locator("#grid-clear").click();
    await cell(0).click();
    await pasteText(q03.join("\n"));

    // ---- 貼り付けモード。マス目の詩を引き継ぐ ----
    await page.locator("#tab-paste").click();
    check((await page.inputValue("#poem-input")) === q03.join("\n"), `${label}: 貼り付けモードへマス目の詩を引き継ぐ`);
    const symbols = await page.$$eval("#result .line", (lines) =>
      lines.map((l) => [...l.querySelectorAll(".ch .sym")].map((s) => s.textContent).join("")),
    );
    check(JSON.stringify(symbols) === JSON.stringify(snap("q03").symbols), `${label}: 貼り付けモードの記号列がスナップショット q03 と一致`);

    // 違反のある詩（q10）を入れると、明確な違反の件数がスナップショットと一致する
    await page.fill("#poem-input", poem("q10").lines.join("\n"));
    const violations = snap("q10").findings.filter((f) => f.startsWith("violation:")).length;
    const shown = await page.$$eval("#result .findings.sev-violation li", (li) => li.length);
    check(shown === violations, `${label}: q10 の明確な違反の件数（${shown}）がスナップショット（${violations}）と一致`);
    if (shots) await page.screenshot({ path: `${shots}/${label}-q10.png`, fullPage: true });

    // 入力の誤り（句読点）は位置つきで知らせる
    await page.fill("#poem-input", q03.join("，\n"));
    const inputErrors = await page.$$eval("#result .errors li", (li) => li.length);
    check(inputErrors === 3, `${label}: 句読点3つを入力の誤りとして知らせる（${inputErrors}件）`);

    // 7字×4句の漢字にならない本文は、マス目に移さずに理由を示す
    await page.locator("#tab-grid").click();
    const sync = await page.locator(".sync-note").textContent();
    check(sync.includes("マス目に移していません") && JSON.stringify(await actualSymbols()) === JSON.stringify(snap("q03").symbols), `${label}: 移せない本文は理由を示し、マス目は前のまま`);
    await page.locator("#tab-paste").click();
    check((await page.inputValue("#poem-input")) === q03.join("，\n"), `${label}: マス目を編集していなければ、貼り付けた本文はそのまま`);

    // 貼り付けモードで横にはみ出さない
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow <= 0, `${label}: 貼り付けモードで横にはみ出さない（はみ出し ${overflow}px）`);

    check(outside.length === 0, `${label}: ページの外への通信がない${outside.length ? `（${outside.join(", ")}）` : ""}`);
    check(errors.length === 0, `${label}: スクリプトのエラーがない${errors.length ? `（${errors.join(" / ")}）` : ""}`);
    // マス目モードでも、選択中のマスと検査結果を出した状態で、横にはみ出さない
    await page.locator("#tab-grid").click();
    await page.locator("#grid-sample").click();
    await cell(10).click();
    const panelShown = await page.locator("#cell-panel .big-char").isVisible();
    const resultsShown = await page.locator("#grid-result .findings, #grid-result .none").first().isVisible();
    const gridOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(panelShown && resultsShown && gridOverflow <= 0, `${label}: マス目モード（選択中のマスと検査結果を表示）で横にはみ出さない（はみ出し ${gridOverflow}px）`);
    if (shots) await page.screenshot({ path: `${shots}/${label}-selected.png`, fullPage: true });
    await page.close();
  }

  // ---- 編集の記録と、必須要素の消失警告（M6）。新しい文脈で、パソコン幅だけで確かめる ----
  {
    const label = "log";
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("dialog", (d) => d.accept());
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${ORIGIN}/`);
    await page.waitForSelector("#grid-mode .gin");
    const cell = (i) => page.locator(`.gin[data-index="${i}"]`);
    const rows = () => page.$$eval("#history li", (li) => li.map((x) => x.textContent));
    const q03 = poem("q03").lines;

    check((await page.locator("#history").textContent()).includes("まだ記録はありません"), `${label}: 最初は記録がない`);
    // 1句を入れて次の句に移ると、その句の手入力が1件の記録になる（1マスごとではない）
    await cell(0).click();
    await page.keyboard.insertText(q03[0]);
    let r = await rows();
    check(r.length === 1 && r[0].includes("作者") && r[0].includes("起句の1-7字目") && r[0].includes("手入力"), `${label}: 句を入れて次の句へ移ると1件の記録（${r[0] ?? "なし"}）`);

    // 途中まで入れた句は未確定。理由を書いて確定すると、理由つきの記録になる
    await page.keyboard.insertText(q03[1].slice(0, 3));
    check((await page.locator("#pending-note").textContent()).includes("承句"), `${label}: 途中の句は未確定として示す`);
    check((await rows()).length === 1, `${label}: 未確定のうちは記録にしない`);
    await page.fill("#reason-input", "月の句にする");
    await page.locator("#commit").click();
    r = await rows();
    check(r.length === 2 && r[0].includes("理由：月の句にする"), `${label}: 確定すると理由つきで記録する`);
    check((await page.inputValue("#reason-input")) === "", `${label}: 使った理由の入力欄は空に戻る`);

    // 詩語候補を採用すると、辞書候補の記録になる
    await cell(18).click();
    await page.waitForSelector("#assist .cand .place");
    const first = await page.locator("#assist .cand .cand-word").first().textContent();
    await page.locator("#assist .cand .place").first().click();
    r = await rows();
    check(r[0].includes("辞書候補") && r[0].includes("詩語候補") && r[0].includes(first), `${label}: 候補の採用は辞書候補として記録する（${r[0]}）`);

    // 必須要素：入っていた語を書き換えると、はっきり警告する。置き直すと警告が消え、必須要素からの記録になる
    const word0 = q03[0].slice(0, 2);
    await page.fill("#required-input", word0);
    await page.locator("#required-add").click();
    check((await page.locator(".required-warning").isVisible()) === false, `${label}: 入っている必須要素には警告しない`);
    await cell(0).click();
    await page.keyboard.insertText(q03[3][0]);
    await page.waitForSelector(".required-warning:not(:empty)");
    const warn = await page.locator(".required-warning").textContent();
    check(warn.includes(`必須要素「${word0}」が詩から消えています`), `${label}: 消えた必須要素を警告する（${warn}）`);
    await page.locator(".required-item .place-req").first().click();
    check((await page.locator(".required-warning").isVisible()) === false, `${label}: 置き直すと警告が消える`);
    r = await rows();
    check(r[0].includes(`必須要素「${word0}」`) && r[0].includes("作者"), `${label}: 必須要素の配置は、どの必須要素からかを記録する（${r[0]}）`);
    // 必須要素の配置の前に、未確定だった起句の書き換えも確定されている
    check(r[1].includes("起句の1字目") && r[1].includes("手入力"), `${label}: 操作の前に未確定の手入力を確定する（${r[1]}）`);
    // 未確定の手入力で入れた必須要素を、同じ句のまま書き換えて消しても警告する
    const word3 = q03[3].slice(0, 2);
    await page.fill("#required-input", word3);
    await page.locator("#required-add").click();
    await cell(21).click();
    await page.keyboard.insertText(word3);
    check((await page.locator(".required-warning").isVisible()) === false, `${label}: 未確定の入力で入った必須要素には警告しない`);
    await cell(22).click();
    await page.keyboard.insertText(q03[2][0]);
    check(
      (await page.locator(".required-warning").textContent()).includes(`必須要素「${word3}」が詩から消えています`),
      `${label}: 未確定のまま書き換えて消えた必須要素も警告する`,
    );
    if (shots) await page.screenshot({ path: `${shots}/log.png`, fullPage: true });
    check(errors.length === 0, `${label}: スクリプトのエラーがない${errors.length ? `（${errors.join(" / ")}）` : ""}`);
    await context.close();
  }

  // ---- 保存・書き出し・読み込み（M6 の完了条件：1首作って書き出し、読み込んで同じ状態に戻る） ----
  {
    const label = "save";
    const desktop = { viewport: { width: 1280, height: 900 } };
    const work = mkdtempSync(join(tmpdir(), "kanshi-e2e-"));
    const errors = [];
    const open = async (context) => {
      const page = await context.newPage();
      page.on("dialog", (d) => d.accept());
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${ORIGIN}/`);
      await page.waitForSelector("#grid-mode .gin");
      return page;
    };
    /** 画面の状態：マス目、未確定の表示、必須要素、設定、編集の記録 */
    const stateOf = (page) =>
      page.evaluate(() => ({
        cells: [...document.querySelectorAll(".gin")].map((i) => i.value),
        pending: document.querySelector("#pending-note").textContent,
        required: [...document.querySelectorAll(".required-item .cand-word")].map((x) => x.textContent),
        settings: ["#form-select", "#unknown-select", "#rhyme-select", "#allow-kokuji", "#show-pattern"].map((sel) => {
          const el = document.querySelector(sel);
          return el.type === "checkbox" ? el.checked : el.value;
        }),
        history: [...document.querySelectorAll("#history li")].map((li) => li.textContent),
      }));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    const ctxA = await browser.newContext(desktop);
    const page = await open(ctxA);
    const cell = (i) => page.locator(`.gin[data-index="${i}"]`);
    const q03 = poem("q03").lines;
    // 1首作る：詩全体の貼り付け（手入力）、転句5-6字目を空けて候補を採用、必須要素、設定、理由つきの確定、未確定の手入力
    await cell(0).click();
    await page.evaluate((t) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", t);
      document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, q03.join("\n"));
    for (const i of [18, 19]) {
      await cell(i).click();
      await page.keyboard.press("Backspace");
    }
    await page.fill("#reason-input", "転句を書き直す");
    await page.locator("#commit").click();
    await cell(18).click();
    await page.locator('#assist .slot-tabs button[data-slot="5-6"]').click();
    await page.waitForSelector("#assist .cand .place");
    await page.locator("#assist .cand .place").first().click();
    await page.fill("#required-input", q03[0].slice(0, 2));
    await page.locator("#required-add").click();
    await page.selectOption("#rhyme-select", { index: 3 });
    await page.selectOption("#unknown-select", "仄");
    await cell(27).click();
    await page.keyboard.insertText(q03[2][0]); // 結句末を書き換えたまま（未確定）
    const made = await stateOf(page);
    check(made.history.length >= 5 && made.pending.includes("結句") && made.required.length === 1, `${label}: 1首を作った（記録 ${made.history.length}件、未確定あり）`);
    check((await page.locator("#save-status").textContent()).includes("自動で保存"), `${label}: 自動で保存していると示す`);

    // 開き直すと、未確定の手入力も含めて同じ状態に戻る
    await page.reload();
    await page.waitForSelector("#grid-mode .gin");
    check(same(await stateOf(page), made), `${label}: 開き直すと同じ状態に戻る`);

    // 書き出す（未確定の手入力は確定してから書き出す）
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export").click()]);
    const file = join(work, download.suggestedFilename());
    await download.saveAs(file);
    const exported = await stateOf(page);
    check(exported.pending.includes("未確定の変更はありません") && exported.history.length === made.history.length + 1, `${label}: 書き出す前に未確定の手入力を確定する`);
    const json = JSON.parse(readFileSync(file, "utf-8"));
    check(json.app === "kanshi-app" && json.schema === 1 && json.events.length === exported.history.length, `${label}: 書き出したファイル（${download.suggestedFilename()}）に記録がすべて入っている`);
    check(/^kanshi-\d{8}-\d{4}\.json$/.test(download.suggestedFilename()), `${label}: ファイル名に日時が入る`);

    // 別の環境（保存が空）で読み込むと、同じ状態に戻る
    const ctxB = await browser.newContext(desktop);
    const pageB = await open(ctxB);
    check((await stateOf(pageB)).history.length === 0, `${label}: 別の環境は空から始まる`);
    await pageB.setInputFiles("#import-file", file);
    await pageB.waitForFunction(() => document.querySelector("#save-note")?.textContent?.includes("読み込みました"));
    check(same(await stateOf(pageB), exported), `${label}: 書き出したファイルを別の環境で読み込むと、同じ状態に戻る`);

    // 壊れたファイルは読み込まず、いまの詩はそのまま
    const broken = join(work, "broken.json");
    // 最後の記録の「前」を「後」と同じにする（記録をたどると、その時点のマス目と合わない）
    writeFileSync(broken, JSON.stringify({ ...json, events: json.events.map((e, k) => (k === json.events.length - 1 ? { ...e, before: e.after } : e)) }));
    await pageB.setInputFiles("#import-file", broken);
    await pageB.waitForFunction(() => document.querySelector("#save-note")?.textContent?.includes("読み込めませんでした"));
    const note = await pageB.locator("#save-note").textContent();
    check(note.includes("合いません") && same(await stateOf(pageB), exported), `${label}: 記録の合わないファイルは理由を示して読み込まない（${note}）`);

    // 新しく始める
    await pageB.locator("#new-poem").click();
    const fresh = await stateOf(pageB);
    check(fresh.history.length === 0 && fresh.cells.every((c) => c === "") && fresh.required.length === 0, `${label}: 新しく始めると空になる`);
    await ctxA.close();
    await ctxB.close();

    // localStorage が使えない環境でも動き、自動保存できないことを示す
    const ctxC = await browser.newContext(desktop);
    await ctxC.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("denied", "SecurityError");
        },
      });
    });
    const pageC = await open(ctxC);
    check((await pageC.locator("#save-status").textContent()).includes("自動保存が使えません"), `${label}: localStorage が使えないと示す`);
    await pageC.locator(`.gin[data-index="0"]`).click();
    await pageC.keyboard.insertText(q03[0]);
    check((await stateOf(pageC)).history.length === 1, `${label}: localStorage が使えなくても作詩と記録はできる`);
    await ctxC.close();
    check(errors.length === 0, `${label}: スクリプトのエラーがない${errors.length ? `（${errors.join(" / ")}）` : ""}`);
  }
} finally {
  await browser.close();
  server.kill();
}

if (failures.length > 0) {
  console.error(`\n${failures.length}件の確認に失敗した`);
  process.exit(1);
}
console.log("\n画面の確認がすべて通った");
process.exit(0);
