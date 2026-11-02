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
    await page.goto(`${ORIGIN}/`);
    await page.waitForSelector("#result .poem");

    // 例の詩（q03 と同じ本文）の記号列が、スナップショットと一致する
    const symbols = await page.$$eval("#result .line", (lines) =>
      lines.map((l) => [...l.querySelectorAll(".ch .sym")].map((s) => s.textContent).join("")),
    );
    check(JSON.stringify(symbols) === JSON.stringify(snap("q03").symbols), `${label}: 例の詩の記号列がスナップショット q03 と一致`);

    // 違反のある詩（q10）を入れると、明確な違反の件数がスナップショットと一致する
    await page.fill("#poem-input", poem("q10").lines.join("\n"));
    const violations = snap("q10").findings.filter((f) => f.startsWith("violation:")).length;
    const shown = await page.$$eval("#result .findings.sev-violation li", (li) => li.length);
    check(shown === violations, `${label}: q10 の明確な違反の件数（${shown}）がスナップショット（${violations}）と一致`);
    if (shots) await page.screenshot({ path: `${shots}/${label}-q10.png`, fullPage: true });

    // 入力の誤り（句読点）は位置つきで知らせる
    await page.fill("#poem-input", poem("q03").lines.join("，\n"));
    const inputErrors = await page.$$eval("#result .errors li", (li) => li.length);
    check(inputErrors === 3, `${label}: 句読点3つを入力の誤りとして知らせる（${inputErrors}件）`);

    // 横にはみ出さない
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow <= 0, `${label}: 横にはみ出さない（はみ出し ${overflow}px）`);

    check(outside.length === 0, `${label}: ページの外への通信がない${outside.length ? `（${outside.join(", ")}）` : ""}`);
    check(errors.length === 0, `${label}: スクリプトのエラーがない${errors.length ? `（${errors.join(" / ")}）` : ""}`);
    if (shots) {
      await page.fill("#poem-input", poem("q03").lines.join("\n"));
      await page.screenshot({ path: `${shots}/${label}-sample.png`, fullPage: true });
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
