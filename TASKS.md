# TASKS

進行中のタスクと完了条件。進め方は CLAUDE.md §7.2。

## 進行中

### m3-golden-input — ゴールデンテストの入力（M3）

ブランチ: `task/m3-golden-input`

完了条件:
- [ ] 対象の詩は、chinese-poetry `蒙学/tangshisanbaishou.json`（唐詩三百首）の分類「七言絕句」の全件。分類「樂府」のうち4句×7字の詩は別枠で記録し、含めるかは人間が判断する
- [ ] 本文は、上記ファイルの本文（簡体字からの機械変換の誤りを含む）ではなく、chinese-poetry `御定全唐詩/` の繁体字の本文から照合して取る（CLAUDE.md §6.2）。照合の結果（巻・番号・一致した字数・字の違い）を記録する
- [ ] 照合で一つに決まらない詩、一致が低い詩は、本文を推測で埋めずに一覧に出す
- [ ] 元データ（版を固定）はハッシュで検証して取得し、ゴールデンの入力 `golden/input.json` は同じ入力から同じ出力で生成される（`npm test` で確かめる）
- [ ] `DATA_SOURCES.md` に、使ったファイル名・字体・版・ライセンス・照合の方法を書く

## 完了

### m2-engine — 規則エンジン（M2）

ブランチ: `task/m2-engine`（マージ済み。Codex レビュー4回（4回目は人間の許可）、記録は `.loop/m2-engine/`）

完了条件:
- [x] `packages/engine` が純関数 `analyze(入力, データ, オプション)` を公開し、外部依存がない（データは引数で受け取る）
- [x] 入力：1句1行のテキスト、または28マスの配列。未入力の「＿」、直前の字として扱う「々」、漢字以外の文字の位置（エラー）を扱う
- [x] 字の情報：平仄データ・異体字の対応（候補が複数なら一つに決めない）・国字・データにない字を区別し、misima 互換の記号列（○●◎□■）を返す
- [x] 詩格を第1句の2字目と句末から自動判定し、手動で固定もできる。2字目が未入力なら反法・粘法で他の句から推定し、決まらなければ定型に依存する規則を判定しない
- [x] CLAUDE.md §4.1 の全規則（hasami-hei・kogan-nyugun・supplement-reading・ichisango-furon を含む）を、重みを `data/rules.json` から読んで判定する。オプション（国字で続行、データにない字を平／仄として扱う、重みの上書き）がある
- [x] 両韻字・異体字の候補ごとに読みの組み合わせを作り、解釈ごとの結果を返す。組み合わせが2の10乗を超えたら位置ごとに独立して評価し、その旨を結果に含める
- [x] 規則ごとに、適合例と、意図的に1か所だけ崩した違反例のテストがある。両韻字・未入力マス・国字・データにない字を含む例がある。テストの平仄は架空の小さなデータで与え、実在の字の平仄を記憶で使わない（CLAUDE.md §0）
- [x] 実データ（`data/`）を読み込んで動くことを確かめるテストがある（期待値は記憶ではなく `data/` から引く）

### m2-forms — 定型と規則のデータ（M2）

ブランチ: `task/m2-forms`（マージ済み。Codex レビュー1回、記録は `.loop/m2-forms/`）

完了条件:
- [x] `data/forms.json` に4定型（◐つきの pattern と、律句どおりの base）と照合元（版番号つき）がある
- [x] 照合元の記事（ja・zh「近体詩」）を版を固定して `data/raw/` に取得するスクリプトがある
- [x] テストが記事の本文から律句を読み取り、資料の組み立て方（相対・相黏・首句の入韻）で4定型を作って `forms.json` と一致することを確かめる。◐の位置が一三五不論（禁忌に抵触しない限り問わない）と合うことも確かめる
- [x] `data/rules.json` に CLAUDE.md §4.1 の全規則（人間の判断で足した hasami-hei・kogan-nyugun・supplement-reading を含む）と ichisango-furon が、既定の重みと根拠つきであり、重みが CLAUDE.md の表と一致することをテストで確かめる
- [x] 照合で見つかった食い違いとその判断が `DECISIONS.md` に、出典が `DATA_SOURCES.md` にある

### m1-unihan — 平仄データにつながらない字を Unihan の異体字情報で補う（DECISIONS.md (c)）

ブランチ: `task/m1-unihan`（マージ済み。Codex レビュー2回、記録は `.loop/m1-unihan/`）

完了条件:
- [x] Unicode 18.0.0 の `Unihan_Variants.txt` とライセンス文を、ハッシュで検証して `data/raw/unicode-18.0.0/` に取得するスクリプトがある
- [x] OpenCC の対応で平仄データにつながらなかった字にだけ、Unihan の `kZVariant`・`kSemanticVariant`・`kJapaneseOldVariant` を1段たどって、平仄データにある字を候補として足す（入力字そのものと、OpenCC の候補の両方からたどる）。OpenCC でつながる字には足さない
- [x] 使わない欄（`kSpecializedSemanticVariant`・`kSpoofingVariant`・`kSimplifiedVariant`・`kTraditionalVariant`・`kJapaneseNewVariant`）を使っていないことがテストで確かめられている
- [x] Unihan で補った字は、根拠（欄名と経由した字）とともに `data/reports/unihan-supplemented.txt` に出る。候補が2字以上なら、今までどおり `ambiguous.txt` にも出る
- [x] それでもつながらない字は `unmapped.txt` に残る
- [x] `npm test` が緑で、`DATA_SOURCES.md` に Unihan の出典・ライセンス・加工内容が書かれている

### m1-chars — 平仄データの取得・正規化・検査（M1）

ブランチ: `task/m1-chars`（マージ済み。Codex レビュー3回、記録は `.loop/m1-chars/`）

完了条件:
- [x] 元データ（ウィキソース「平水韻」版8264804、OpenCC ver.1.4.2 の対応表、ウィキペディア「和製漢字」版109822326）を版を固定して `data/raw/` に保存し、ハッシュで検証して取得するスクリプトがある
- [x] 生成スクリプトが `data/raw/` と、根拠つきの修正一覧 `data/corrections.json` だけから `data/chars.json`・`data/rhymes.json`・`data/variants.json`・`data/kokuji.json` と `data/reports/` を作り、同じ入力から同じ出力を出す（`npm test` で再生成して差分がないことを確かめる）
- [x] ウィキソース版の【詞】【辭】欄の字は本体と区別し、`note` で印を付けて残す（扱いは人間が判断する）
- [x] 簡体字→繁体字、新字体→旧字体の対応で候補が複数になった字は一つに決めず `data/reports/ambiguous.txt` に、対応先がデータにない字は `data/reports/unmapped.txt` に出す
- [x] データ検査（声調の値域、韻目名の表記揺れ、同一字の重複定義など）が `npm test` で走り、エラーがゼロ
- [x] `DATA_SOURCES.md` に、データごとの入手元URL・取得日・ライセンス・加工内容・再配布の可否が書かれている

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
