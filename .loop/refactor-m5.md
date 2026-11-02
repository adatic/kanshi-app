# refactor/m5 — マイルストーン M5 のリファクタリング

- 対象: apps/web/src（M5 で作った画面）
- 実行: CLAUDE.md §7.4 のリファクタリング用コマンド（`--sandbox workspace-write`）。§7.3 の条件に加えて、apps/web/test・apps/web/e2e・engine・scripts・data を変えないこと、画面の id・class・aria 属性・文言を変えないこと（E2E が頼っている）を条件にした
- Codex の変更（報告は `refactor-m5.codex.md`）:
  - main.ts：必須要素1語の表示を `requiredItem` に切り出し（配置と登録解除は呼び出し側から渡す）、タブの状態の更新を `refreshTabs` にまとめた
  - gridEditor.ts：入力欄への反映を `syncInputs` にまとめ、句の名前は view.ts の `lineName` を使う（0〜3句の名前は同じ）
  - assistView.ts：候補1語の表示を `candidateItem` に切り出した
- Claude Code の確認:
  - 差分を読んだ。構造の整理だけで、表示の要素・文言・処理の順序は変わっていない
  - Codex の環境ではポートを開けず E2E を実行できなかったので、Claude Code が実行した：`npm test` 緑（Vitest 206件、Python 68件、データ生成・ゴールデン・詩語頻度表の再現）、`npm run web:e2e` 緑（desktop・phone・phone-dark）
  - テスト・E2E・engine・data・golden・scripts に差分がない
- 判断: §7.3 の条件を満たしている。マージする。
