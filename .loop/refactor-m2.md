# refactor/m2 — マイルストーン M2 のリファクタリング

- 対象: packages/engine/src（規則エンジン）
- 実行: CLAUDE.md §7.4 のリファクタリング用コマンド（`--sandbox workspace-write`）。テスト・data/・公開API・判定の意味（文言を含む）を変えないことを条件に加えた
- Codex の変更（報告は `refactor-m2.codex.md`）:
  - rules.ts：`evaluate` を、句の中（evaluateLines）・句の間（evaluateLinks）・押韻（evaluateRhymes）・【詞】欄（evaluateSupplementReadings）の非公開関数に分割。指摘の並び順は保つ
  - chars.ts：異体字の候補の読みを集める重複を一つにまとめた
- Claude Code の確認:
  - 差分を読んだ。条件式・文言・指摘の順序は変わっていない。分けた関数ごとに小さな補助関数（平仄の取り出し、句数、字の取り出し）が重複するが、関数ごとの独立性を優先して許容する
  - `npm test` が緑（Python 25件、データ生成の再現 12ファイル、Vitest 96件）
  - テスト・data/・scripts/・公開API（types.ts・index.ts）に差分がない
- 判断: §7.3 の条件を満たしている。マージする。
