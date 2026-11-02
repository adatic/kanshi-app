`refactor/m3` で、次の2ファイルを整理しました。

- [scripts/build_golden_input.py](/home/user/kanshi-app/scripts/build_golden_input.py)：1首分の本文取得・検証・入力情報の組み立てを内部関数に分離。
- [golden/golden.ts](/home/user/kanshi-app/golden/golden.ts)：解釈別の選択肢・指摘・ダイジェストの集計を内部関数に分離。

`npm test` はすべて成功しました。Python 40件、Vitest 106件が通過し、型検査・データ再現・ゴールデン生成物の一致も確認済みです。

公開API、判定ロジック、既存テスト、生成物、`data/` は変更していません。

残る3ファイルは整理の必要性が低いため変更していません。追加の懸念点はありません。