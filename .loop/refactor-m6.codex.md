`refactor/m6` で整理しました。振る舞い・画面の属性と文言・保存形式・既存の公開APIは維持しています。

変更したファイル：

- [main.ts](/home/user/kanshi-app/apps/web/src/main.ts)：表示部品と起動処理を分離し、660行から490行へ縮小。
- [editorPanels.ts](/home/user/kanshi-app/apps/web/src/editorPanels.ts)：設定・必須要素・編集履歴の表示を集約。
- [session.ts](/home/user/kanshi-app/apps/web/src/session.ts)：保存データの起動時復元と書き出しファイル名を分離。
- [storage.ts](/home/user/kanshi-app/apps/web/src/storage.ts)：JSON読み込み・版変換と文書検証を分離。検査順序とエラー文言は維持。

検証結果：

- `npm test`：成功。Vitest 248件、Python 68件、データ再現検証すべて通過。
- `npm run web:e2e`：ビルド成功。`127.0.0.1:4173` の待ち受けが環境側で拒否され（`EPERM`）、E2Eは実行できませんでした。
- テスト・ゴールデン・エンジン・scripts・data・依存は変更していません。

`doc.ts` は純関数としてまとまっているため変更していません。残る確認事項は、ポートを利用できる環境でのE2E実行です。