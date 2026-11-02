import { defineConfig } from "vitest/config";

// `npm test` 一発で、エンジンの単体テスト・データ検査・ゴールデンテストを走らせる（CLAUDE.md §5）。
export default defineConfig({
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "scripts/**/*.test.ts",
      "golden/**/*.test.ts",
    ],
    // M0 の時点ではテストがまだない。M1 以降で各ディレクトリにテストが入る。
    passWithNoTests: true,
  },
});
