`refactor/m2` で次の2ファイルを整理しました。

- [rules.ts](/home/user/kanshi-app/packages/engine/src/rules.ts)：判定関数を句内・句間・押韻・補助読みの非公開関数に分割。条件式・指摘文言・順序は維持しました。
- [chars.ts](/home/user/kanshi-app/packages/engine/src/chars.ts)：異体字の読みをコピーする重複処理を共通化しました。

`npm test` はすべて成功しました。型検査、Python 25テスト、データ再現性確認、Vitest 96テストが通っています。

公開API、既存テスト、`golden/`、`data/`、依存関係は変更していません。未対応の懸念点はありません。