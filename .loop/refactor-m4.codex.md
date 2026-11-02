`refactor/m4` で対象4ファイルを整理しました。

| ファイル | 変更の目的 |
|---|---|
| `scripts/fetch_corpus.py` | マニフェスト読み込みの重複を除去 |
| `scripts/build_phrases.py` | 読みの付与・グループ分け・整列を出力処理から分離 |
| `packages/engine/src/queries.ts` | 格子コピー処理の共通化、命名の改善、重複計算の削減 |
| `scripts/placements-report.test.ts` | 詩語読み込み・読みの表示・制約行の生成を関数に分離 |

`npm test` は全件成功しました（Python 65件、Vitest 132件）。詩語頻度表の再現確認、配置レポートの一致確認、全唐詩キャッシュの検証も成功しています。

判定ロジックの意味、公開API、変更禁止のテスト、`data/`、`golden/` に変更はありません。手を付けずに残した懸念点はありません。