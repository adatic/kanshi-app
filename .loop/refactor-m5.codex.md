専用ブランチ `refactor/m5` で、以下の3ファイルを整理しました。

| ファイル | 変更の目的 |
|---|---|
| [main.ts](/home/user/kanshi-app/apps/web/src/main.ts) | 必須要素の描画を内部関数に分離し、タブ状態の更新を共通化 |
| [gridEditor.ts](/home/user/kanshi-app/apps/web/src/gridEditor.ts) | 入力欄の同期処理と句名の重複を除去 |
| [assistView.ts](/home/user/kanshi-app/apps/web/src/assistView.ts) | 候補1語の描画を内部関数に分離 |

公開API・判定ロジック・画面の属性と文言は維持しています。テスト、ゴールデン、エンジン、scripts、data、依存関係は変更していません。

- `npm test`：成功。Python 68件、Vitest 206件がすべて通過。
- `npm run web:e2e`：ビルド成功。環境がポート待受を拒否（`listen EPERM`）するため、Chromium での検証は実行できませんでした。

手を付けなかった点として、`main.ts` には画面構築と状態管理がまだ集まっています。今回は描画関数の分離と重複除去に留めました。