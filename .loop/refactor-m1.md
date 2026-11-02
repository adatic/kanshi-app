# refactor/m1 — マイルストーン M1 のリファクタリング

- 対象: scripts/fetch_sources.py, scripts/build_data.py, scripts/test_build_data.py, scripts/check-data.test.ts
- 実行: CLAUDE.md §7.4 のリファクタリング用コマンド（`--sandbox workspace-write`）
- Codex の変更: scripts/build_data.py のみ。異体字候補の収集を `_collect_variant_candidates` に切り出し、未使用の import（OrderedDict）を削除し、`parse_wikisource` の説明文の戻り値の誤り（problems は返していない）を直し、変数名を明確にした。Codex の報告は `refactor-m1.codex.md`。
- Claude Code の確認:
  - 差分を読んだ。候補の順序は、dict の挿入順で以前の candidates リストと同じになる。
  - `npm test` が緑（Python 17件、データ生成の再現 11ファイル、Vitest 13件）。
  - テスト・生成物（data/）・元データ・corrections.json に差分がない。
- 判断: §7.3 の条件を満たしている。マージ可。
