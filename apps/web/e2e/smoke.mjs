// ビルドした画面の E2E 確認（CLAUDE.md §6.3）。`npm run web:e2e` で走る（ビルドしてから実行する）。
// 期待値は記憶ではなく、ゴールデンテストのスナップショット（エンジンが出した結果）から取る。
// SHOTS_DIR を渡すと、確認用の画面写真をそこに保存する。
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
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
    await page.evaluate((text) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, q03.join("\n"));
    check(JSON.stringify(await actualSymbols()) === JSON.stringify(snap("q03").symbols), `${label}: 詩全体の貼り付けが句ごとに入る`);
    if (shots) await page.screenshot({ path: `${shots}/${label}-grid.png`, fullPage: true });

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

    // 横にはみ出さない
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow <= 0, `${label}: 横にはみ出さない（はみ出し ${overflow}px）`);

    check(outside.length === 0, `${label}: ページの外への通信がない${outside.length ? `（${outside.join(", ")}）` : ""}`);
    check(errors.length === 0, `${label}: スクリプトのエラーがない${errors.length ? `（${errors.join(" / ")}）` : ""}`);
    if (shots) {
      await page.locator("#tab-grid").click();
      await cell(10).click();
      await page.screenshot({ path: `${shots}/${label}-selected.png`, fullPage: true });
    }
    await page.close();
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
