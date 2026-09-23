# サンプル・カスタマイズ集

目的に合わせて、次の二つから選んでください。

| やりたいこと | 選ぶもの | 必要なファイル |
|---|---|---|
| 自分の原稿の見た目を変えたい | [CSSカスタマイズ](#cssカスタマイズ) | CSS。設定や原稿の短い記述例は使い方のページに掲載 |
| 原稿と設定をまとめて試したい | [完成サンプル](#完成サンプル) | Markdown・YAMLと必要な画像・CSS。一式ZIPには組見本も収録 |

CSSだけをダウンロードする場合も、本の設定は必要です。共通手順はマニュアルの[配布CSSを使う](../manual/06-custom-theme.md#配布cssを使う)、[サンプル一式で試す](../manual/02-first-book.md#サンプル一式で試す)を参照してください。

## CSSカスタマイズ

自分の原稿に適用できるCSSの作例です。配置を試せるMarkdown・YAML・画像を同梱した作例もあります。Vivlioの書籍用CSSであり、Obsidianの「CSSスニペット」では設定しません。

| 作例 | できること | 適用条件 | 入手・使い方 |
|---|---|---|---|
| 小説の章扉 | 章タイトルを独立した左ページに配置する | `novel`を土台にした縦一段組。章見出しとYAMLの設定が必要 | [使い方・バージョンの注意](css/novel-title-page/README.md) / [CSS](css/novel-title-page/novel-title-page.css) |
| 図版付きの縦書き段組み | 先頭の横長図版・段内画像・囲みコラム・見開きの柱とノンブル | A4縦四段。先頭図版が一段分を使用。独立CSS、Vivlio 0.17.3で確認 | [使い方・組見本](css/vertical-feature/README.md) / [CSS](css/vertical-feature/vertical-feature.css) / [Markdown原稿](css/vertical-feature/book/01-風の尾根.md) / [設定](css/vertical-feature/book/vivlio.yaml) |

CSSのリンク先で **Raw** を開き、内容を `.css` ファイルとしてVault内へ保存してください。必要な設定は各作例の説明にあります。

## 完成サンプル

まず付属の原稿でプレビュー・出力を確認し、その後、自分の原稿へ差し替えてください。配置先やフォルダ名の条件は各サンプルの使い方に従います。完成PDFはZIP内の組見本で確認できます。EPUBはリフロー型のため、PDFと同じ改ページ・配置にはなりません。

| サンプル | 試せること | テーマ・追加CSS | バージョン | 使い方・ダウンロード |
|---|---|---|---|---|
| 句集・歌集 | 各8作品、詞書・作者・改行、1・2・3作品／頁の比較 | 内蔵 `haiku` / `tanka`。追加CSS不要 | 0.17.0以降 | [使い方](verse-README.md) / [原稿：句集](haiku/index.md)・[歌集](tanka/index.md) / [一式ZIP](https://raw.githubusercontent.com/nonkuri/obsidian-vivlio/0.17.2/sample/downloads/vivlio-sample-verse-0.17.2.zip) |
| 一般書・エッセイ | 2編の随筆、章・節・引用・箇条書き・図版。PDF・EPUB付き | 内蔵 `essay`。追加CSS不要 | 0.16.0以降 | [使い方](essay-README.md) / [原稿](essay/index.md) / [一式ZIP](https://raw.githubusercontent.com/nonkuri/obsidian-vivlio/0.17.0/sample/downloads/vivlio-sample-essay-0.16.0.zip) |
| マニュアル・操作ガイド | 4原稿、模式図2点、図表参照、注意書き・長表。16ページのPDF・EPUB付き | 内蔵 `manual`。追加CSS不要 | 0.15.0以降 | [使い方](manual-README.md) / [原稿](manual/index.md) / [一式ZIP](https://github.com/nonkuri/obsidian-vivlio/releases/download/0.15.0/vivlio-sample-manual-0.15.0.zip) |
| 論文・レポート | 7原稿、図5点・表6点、数式・脚注・文献、自動採番。15ページのPDF付き | 内蔵 `paper`。追加CSS不要 | 0.14.0以降 | [使い方](paper-README.md) / [原稿](paper/index.md) / [一式ZIP](https://github.com/nonkuri/obsidian-vivlio/releases/download/0.14.0/vivlio-sample-paper-0.14.0.zip) |
| 芥川龍之介短編集 | 同じ原稿をA5縦二段組・四六判・文庫で比較。PDF・EPUB付き | 判型別のYAMLを同梱 | 0.10.1で制作 | [使い方](README.akutagawa.ja.md) / [一式ZIP（30.1 MiB）](https://github.com/nonkuri/obsidian-vivlio/releases/download/0.10.1/vivlio-sample-akutagawa-0.10.1.zip) |
| The Adventures of Sherlock Holmes | 英語小説の前付け・本文・後付けと装丁。PDF・EPUB付き | Vault内の独自CSS一式を同梱 | 0.8.0で制作 | [使い方（英語）](README.sherlock.md) / [一式ZIP（2.7 MiB）](https://github.com/nonkuri/obsidian-vivlio/releases/download/0.8.0/vivlio-sample-sherlock-holmes-0.8.0.zip) |

古いサンプルを新しいVivlioや異なるフォント環境で出力すると、改ページや文字の収まりが変わる場合があります。原稿・画像・フォントの利用条件は各READMEを参照してください。論文サンプルの数値は合成データで、[再現・検証記録](paper/reproduce/verification.md)も公開しています。

## 配布・保守について

新しい配布ZIPは `downloads/` に置き、バージョンタグを固定したリンクで案内します。サンプルはプラグインのRelease資産には追加しません。過去のReleaseへのリンクは移設が完了するまで維持します。[リリース手順](../docs/RELEASING.md)を参照してください。

CSS作例は `css/<作例名>/` にCSSとREADMEをまとめます。旧パスの `novel-title-page.css` は過去のリンクから単体取得できるよう残し、新しい案内は `css/novel-title-page/` に統一します。CSSを更新する際は旧パスの互換コピーも同期してください。

完成サンプルの説明は既存の `*-README.md` などに置き、本文用の `index.md` と区別します。原稿フォルダ直下へ説明用Markdownを追加すると、フォルダから組版する際に本文へ含まれる場合があるためです。パッケージ別のREADMEは配布ZIPにも同梱します。

<details>
<summary>既存パッケージの照合情報・再梱包時の注意</summary>

| 既存パッケージ | SHA-256 |
|---|---|
| `vivlio-sample-manual-0.15.0.zip` | `ff21f5385defb1cc7f3a84bb55c87307994d887fc6f4891b3b18a78af526ae2d` |
| `vivlio-sample-paper-0.14.0.zip` | `0e13821a9840966d14c04b3edfe0db5429dea63d1ad480282c859f1ede8fd58d` |
| `vivlio-sample-akutagawa-0.10.1.zip` | `a582e330fcb77b5cde8ed4037408b2dde27084bf051800eed7e9fb055003ca68` |
| `vivlio-sample-sherlock-holmes-0.8.0.zip` | `8682e0f4d9d18ded900ef714ac039fa8e9306f0fd759ecbb0829a10d65a273f9` |

芥川龍之介とSherlock Holmesの入力原稿ZIPは、それぞれ `A5二段組` と `English Novel Sample` のフォルダ名を維持してください。YAML内にこれらの名前から始まるVault相対パスがあります。既存のエントリー名を変更せず、ZIPのファイル名はUTF-8で格納します。

</details>
