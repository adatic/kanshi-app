# TASKS

進行中のタスクと完了条件。進め方は CLAUDE.md §7.2。

## 進行中

（なし）

## 完了

### m0-scaffold — リポジトリ雛形と Codex 疎通確認（M0）

ブランチ: `task/m0-scaffold`（マージ済み。Codex レビュー2回、記録は `.loop/m0-scaffold/`）

完了条件:
- [x] npm workspaces（`packages/*`, `apps/*`）と Vitest が入っている
- [x] `npm test` が、テストのない状態で緑になる（型検査を含む）
- [x] `packages/engine` が外部依存ゼロで、Node の型なしで型検査を通る
- [x] GitHub Actions で push ごとに `npm test` が走る
- [x] `AGENTS.md` が CLAUDE.md §7.5 の内容を満たしている
- [x] `prompts/codex-review.md` と `prompts/codex-refactor.md` が §7.4 の観点・条件を満たしている
- [x] `codex exec` によるレビューが1回通り、結果が `.loop/m0-scaffold/` に残っている
- [x] CLAUDE.md §7.4 を、実際に動いたコマンドに書き換えている
