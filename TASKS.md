# TASKS

進行中のタスクと完了条件。進め方は CLAUDE.md §7.2。

## 進行中

（なし）

## 完了

### m4-queries — 詩語の検索と、制約・配置の問い合わせ（M4）

ブランチ: `task/m4-queries`（マージ済み。Codex レビュー3回、記録は `.loop/m4-queries/`）

完了条件:
- [x] `searchPhrases(語の一覧, 条件)`：平仄パターン（必須。◐は平仄を問わない）、含む字、末字の韻目で絞り込み、出現回数の多い順に返す（CLAUDE.md §4.4）。読みが複数ある語は、ありうるパターンのどれかが合えば合うとする
- [x] `constraintsAt(詩, 句, 位置)`：そのマスに平・仄を置いたときに新しく出る違反を返し、置ける平仄と、押韻の位置なら必要な韻目を示す（§4.1）
- [x] `placementsFor(語, 詩)`：2字語は各句の1-2・3-4・5-6・6-7字目、3字語は5-7字目に置いてみて、置ける／読みによる／置けない／すでにある字と食い違う、を理由つきで返す（§4.1）
- [x] どれも純関数で、判定は analyze を使う（判定の基準を二重に持たない）。入出力はしない（頻度表の読み込みはエンジンの外）
- [x] 架空のデータで境界をテストする。実在の字の平仄を記憶で使わない（§0）
- [x] 「雲雀」「薰風」など数語の配置結果を `data/reports/placements.md` に出し、目で確かめられる。`npm test` で最新であることを確かめる

### m4-phrases — 詩語頻度表（M4）

ブランチ: `task/m4-phrases`（マージ済み。Codex レビュー3回、記録は `.loop/m4-phrases/`）

完了条件:
- [x] 全唐詩（chinese-poetry `全唐诗/poet.tang`、ゴールデンと同じコミット）の全ファイルを、ハッシュを固定した一覧で検証して作業用のキャッシュに取得するスクリプトがある（全文はリポジトリに入れない）
- [x] 七言句（7字の句）を取り出し、2字語（1-2・3-4・5-6・6-7字目）と3字語（5-7字目）の出現回数を数える。出現回数1の語は除く
- [x] 各語に、平仄パターン（読みが複数ある字は、ありうるパターンをすべて）、末字の韻目、出現回数、位置ごとの出現回数、用例（最大3件：作者・題・句）を付ける。平仄・韻目は平仄データ（chars.json・variants.json）から引き、記憶で決めない
- [x] 先頭の字ごとのファイルに分けて `data/phrases/` に置き、索引を作る。生成は同じ入力から同じ出力（`npm test` と CI で確かめる）
- [x] 抽出・パターン・用例の選び方の境界を単体テストで確かめる。`DATA_SOURCES.md` に出典と加工内容を書く

### m3-unihan-more — 平仄データにない字を Unihan でさらに補う（DECISIONS.md 2026-11-02 M3）

ブランチ: `task/m3-unihan-more`（マージ済み。Codex レビュー1回、記録は `.loop/m3-unihan-more/`）

完了条件:
- [x] M3 の判断（4首の承認、3つの判断事項）が DECISIONS.md・golden/exceptions.json に記録され、golden/needs-review.md が空になっている
- [x] 平仄データにも variants.json の見出しにもない字について、Unihan の kZVariant・kSemanticVariant・kJapaneseOldVariant を1段たどり、平仄データにある字を候補として variants.json に足す（OpenCC の表にある字の扱いは今までどおり）
- [x] 足した対応は根拠（欄名）とともにレポートに出る。候補が2字以上なら ambiguous.txt にも出る
- [x] 生成は同じ入力から同じ出力（npm test で確かめる）。境界をテストで確かめる
- [x] ゴールデンの結果の変化を説明してからスナップショットを更新する（DECISIONS.md の判断による更新）

### m3-golden-run — ゴールデンテストの実行・分類・スナップショット（M3）

ブランチ: `task/m3-golden-run`（マージ済み。Codex レビュー2回、記録は `.loop/m3-golden-run/`）

完了条件:
- [x] `golden/input.json` の対象51首をエンジンに通し、結果を `data/reports/golden.md`（詩ごとの判定、違反・要確認の内訳）に出す
- [x] 判定結果のスナップショット `golden/snapshot.json` を保存し、`npm test` で結果がスナップショットと一致することを確かめる。更新は明示的なコマンドだけで行い、差分が出たら理由を説明する（一括更新は人間の承認が要る、CLAUDE.md §0）
- [x] 「明確な違反」が出た詩を全件分類する：データの誤りはデータを直し、ロジックの誤りはエンジンを直し、規則外として正当なものは理由をつけて `golden/exceptions.json` に記録する
- [x] 分類されていない違反判定がゼロであることを `npm test` で確かめる（例外の記録が実際の違反と過不足なく一致する）
- [x] 分類に自信がない詩（規則外として正当とする判断を含む）を `golden/needs-review.md` に集め、根拠（平仄データの読み、本文の版の違い）を添える
- [x] 平仄の判断を記憶で行わない。根拠は平水韻データ・本文の版・名詩の実例だけ（CLAUDE.md §0）

### m3-golden-input — ゴールデンテストの入力（M3）

ブランチ: `task/m3-golden-input`（マージ済み。Codex レビュー2回、記録は `.loop/m3-golden-input/`）

完了条件:
- [x] 対象の詩は、chinese-poetry `蒙学/tangshisanbaishou.json`（唐詩三百首）の分類「七言絕句」の全件。分類「樂府」のうち4句×7字の詩は別枠で記録し、含めるかは人間が判断する
- [x] 本文は、上記ファイルの本文（簡体字からの機械変換の誤りを含む）ではなく、chinese-poetry の繁体字の全唐詩から照合して取る（CLAUDE.md §6.2）。2種類の全唐詩を比べ、変換の誤りが見つからなかった `全唐诗/poet.tang` を本文に使い、`御定全唐詩/` は比較にだけ使う（理由は DATA_SOURCES.md の 6）。照合の結果（ファイル・番号・一致した字数・字の違い）を記録する
- [x] 対象の詩を漏れなく重複なく拾えていることを、保存した唐詩三百首のファイルから数え直すテストで確かめる
- [x] 照合で一つに決まらない詩、一致が低い詩は、本文を推測で埋めずに一覧に出す
- [x] 元データ（版を固定）はハッシュで検証して取得し、ゴールデンの入力 `golden/input.json` は同じ入力から同じ出力で生成される（`npm test` で確かめる）
- [x] `DATA_SOURCES.md` に、使ったファイル名・字体・版・ライセンス・照合の方法を書く

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
