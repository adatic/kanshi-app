// ゴールデンテスト（CLAUDE.md §6.2）。`npm test` で走る。
// GOLDEN_UPDATE=1 のときだけ、スナップショット・レポート・確認一覧を書き出す（`npm run golden:update`）。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  loadExceptions,
  loadQuestions,
  renderNeedsReview,
  renderReport,
  root,
  runGolden,
  toSnapshot,
  violationsOf,
} from "./golden";

const UPDATE = process.env.GOLDEN_UPDATE === "1";
const results = runGolden();
const exceptions = loadExceptions();

const outputs: Record<string, string> = {
  "golden/snapshot.json": JSON.stringify(toSnapshot(results), null, 2) + "\n",
  "data/reports/golden.md": renderReport(results, exceptions),
  "golden/needs-review.md": renderNeedsReview(exceptions, loadQuestions(), results),
};

describe("ゴールデンテスト", () => {
  it("対象は51首", () => {
    expect(results).toHaveLength(51);
  });

  it("明確な違反はすべて分類されている（golden/exceptions.json と過不足なく一致）", () => {
    const actual = Object.fromEntries(
      results.map((r) => [r.poem.id, violationsOf(r.analysis)] as const).filter(([, v]) => v.length > 0),
    );
    const recorded = Object.fromEntries(exceptions.map((e) => [e.poem, [...e.findings].sort()]));
    expect(recorded).toEqual(actual);
  });

  it("分類にはすべて理由と根拠がある", () => {
    for (const e of exceptions) {
      expect(e.reason.length, e.poem).toBeGreaterThan(0);
      expect(e.evidence.length, e.poem).toBeGreaterThan(0);
      if (e.needsReview) expect(e.question?.length ?? 0, e.poem).toBeGreaterThan(0);
    }
  });

  for (const [path, content] of Object.entries(outputs)) {
    it(`${path} が最新の判定結果と一致する`, () => {
      const url = new URL(path, root);
      if (UPDATE) writeFileSync(url, content);
      expect(existsSync(url), `${path} がない。npm run golden:update で作る`).toBe(true);
      expect(readFileSync(url, "utf-8")).toBe(content);
    });
  }
});
