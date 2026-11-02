変更は [scripts/build_data.py](/home/user/kanshi-app/scripts/build_data.py) のみです。

- 異体字候補の収集を内部関数に分離し、順序を保つ辞書で候補と由来を管理。
- 重複処理の変数名を明確化。
- 未使用の import と戻り値の説明を整理。

検証結果：

- `npm test`：成功（型検査、Python 17件、Vitest 13件）。
- `python3 scripts/build_data.py --check`：生成物11ファイルすべて一致。
- `git diff --check`：成功。

テスト、生成物、元データ、公開APIは変更していません。他の対象ファイルは整理の必要がなく、未変更です。追加の懸念点はありません。