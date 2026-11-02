# refactor/m3 — マイルストーン M3 のリファクタリング

- 対象: scripts/golden_text.py, scripts/find_golden_sources.py, scripts/fetch_golden_sources.py, scripts/build_golden_input.py, golden/golden.ts
- 実行: CLAUDE.md §7.4 のリファクタリング用コマンド（`--sandbox workspace-write`）。テスト・ゴールデンの生成物・data/ を変えないことを条件に加えた
- Codex の変更（報告は `refactor-m3.codex.md`）:
  - golden/golden.ts：スナップショットの解釈の集計（選択肢・選択ごとの指摘・ダイジェスト）を `snapshotInterpretations` に切り出した
  - scripts/build_golden_input.py：1首分の本文の取り出し・検証・組み立てを `_build_poem` に切り出した
  - ほかの3ファイルは変更なし
- Claude Code の確認:
  - 差分を読んだ。処理の切り出しだけで、計算の内容と順序は変わっていない
  - `npm test` が緑（Python 40件、データ生成とゴールデンの入力の再現、Vitest 106件。ゴールデンのスナップショット・レポート・確認一覧の一致を含む）
  - テスト・data/・golden/ の生成物と分類・エンジンに差分がない
- 判断: §7.3 の条件を満たしている。マージする。
