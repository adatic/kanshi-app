# refactor/m6 — マイルストーン M6 のリファクタリング

- 対象: apps/web/src（M6 で作った・変えたもの）
- 実行: CLAUDE.md §7.4 のリファクタリング用コマンド（`--sandbox workspace-write`）。§7.3 の条件に加えて、apps/web/test・apps/web/e2e・engine・scripts・data を変えないこと、画面の id・class・aria 属性・文言と、保存・書き出しのデータの形を変えないことを条件にした
- Codex の変更（報告は `refactor-m6.codex.md`）:
  - main.ts（660行→490行）：設定・必須要素1語・編集の記録の一覧の表示を `editorPanels.ts` に、起動時の復元と書き出しファイル名を `session.ts` に移した
  - storage.ts：版の変換のあとの形の検査を `validateDoc` に分けた（検査の順序と文言は同じ）
- Claude Code の確認:
  - 差分を読んだ。関数の移動と分割だけで、中身・文言・属性・処理の順序は変わっていない
  - Codex の環境ではポートを開けず E2E を実行できなかったので、Claude Code が実行した：`npm test` 緑（Vitest 248件、Python 68件、データ生成・ゴールデン・詩語頻度表の再現）、`npm run web:e2e` 緑（desktop・phone・phone-dark、記録、保存・書き出し・読み込み）
  - テスト・E2E・engine・data・golden・scripts に差分がない
- 判断: §7.3 の条件を満たしている。マージする。
