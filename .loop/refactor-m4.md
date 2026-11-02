# refactor/m4 — マイルストーン M4 のリファクタリング

- 対象: scripts/fetch_corpus.py, scripts/build_phrases.py, packages/engine/src/queries.ts, scripts/placements-report.test.ts
- 実行: CLAUDE.md §7.4 のリファクタリング用コマンド（`--sandbox workspace-write`）。テスト・data/・golden/・公開APIを変えないこと、配置のレポートが変わらないことを条件に加えた
- Codex の変更（報告は `refactor-m4.codex.md`）:
  - queries.ts：格子に字を置くコピーを `withCells` に共通化し、基準の判定結果（違反・要確認・本文の字の集合）を一度だけ計算するようにした。`matchesPattern` を読みやすくした
  - build_phrases.py：語に読みの情報を付けて並べる処理を `_group_phrases` に切り出し、import の順序を整えた
  - fetch_corpus.py：一覧の読み込みを `_load_manifest` にまとめた
  - placements-report.test.ts：頻度表の読み込み・読みの表示・制約の行を関数に分けた
- Claude Code の確認:
  - 差分を読んだ。計算の内容と順序は変わっていない（仮の字を避ける本文の字の集合は、以前と同じく問い合わせのマスを空けた格子から作る）
  - `npm test` が緑（Python 65件、データ生成・ゴールデンの入力・詩語頻度表の再現、Vitest 132件。配置のレポートの一致を含む）
  - テスト・data/・golden/・公開API（types.ts・index.ts）に差分がない
- 判断: §7.3 の条件を満たしている。マージする。
