# Vivliostyle Themes v3 への対応状況

調査日: 2026-10-06 / 対象: obsidian-vivlio 0.18.3

Vivliostyle は 2026-09-15 の更新で **Vivliostyle Themes v3**（`@vivliostyle/theme-base` 3.0.0、公式テーマ各 3.0.0）を公開し、テーマの書き方を大きく変えた（[更新履歴](https://docs.vivliostyle.org/ja/changelog/)、[v3への移行](https://docs.vivliostyle.org/ja/themes/migration-v3/)）。この文書は、その変更に対するプラグインの対応状況と、移行するときに手を入れる箇所をまとめる。

## 結論

- **プラグインは v3 に未対応で、Themes v2 系のまま動いている。** 同梱しているのは `theme-base` 2.1.1、`theme-bunko` / `theme-techbook` / `theme-academic` 2.0.2。
- **今すぐ壊れるものはない。** `package.json` の指定は `^2.x` なので、`npm install` しても 3.0.0 には上がらない。テーマはビルド時に `main.js` へ埋め込まれるため、利用者の環境にも影響しない。
- **単純に依存を 3.0.0 に上げると壊れる。** 公式テーマ v3 は `@import '@vivliostyle/theme-base/page'` のようにパッケージ名で読み込む。これを解決できるのは Vivliostyle CLI 11.3 以降だけで、CLI を使わず Viewer に CSS を直接渡しているこのプラグインでは解決できない（後述 [1](#1-パッケージ名による-import)）。
- 同梱テーマ（`novel`・`english-novel`・`manual`・`paper` ほか）は、v3 で改名・廃止された CSS 変数を数十か所で使っている。名前付きページや外部リンク脚注の既定動作も変わるため、移行するには CSS と出力の確認が必要になる。
- **利用者への影響**: 自作テーマで v3 の変数名（`--vs-color-foreground` など）や v3 のドキュメントの書き方をまねても効かない。現時点では v2 の書き方が正しい。

## 対応方針

検討日: 2026-10-06

### 作り直しにはならない

v3 で変わったのはテーマ CSS の書き方だけで、プラグイン本体はほぼ影響を受けない。VFM による変換、ローカルサーバーとビューア、PDF・EPUB 出力、設定の読み込み、ウィザードはそのまま使える。手を入れるのはテーマ層に限られる。

| 作業 | 規模 |
|---|---|
| テーマの埋め込み時に、パッケージ名の `@import` を相対 URL に書き換える | `esbuild/assets.mjs` に数十行 |
| 同梱テーマ CSS（計約 2,500 行）の変数名の置き換えと、読み込むモジュールの指定 | 置き換えは約 100 行。ほぼ機械的 |
| `css.ts`・`epub.ts` の修正（文字サイズ変数、献辞・題辞のページ指定、bunko の変数名） | 数十行 |
| 外部リンク脚注の扱いを決め、テストを直す | 小 |
| 出力の見比べ（全テーマ × サンプル） | **作業量の大半** |

時間がかかるのはコードの修正ではなく、組版結果の確認である。同梱テーマはこのプラグインのために余白・柱・目次を作り込んであるので、v3 の既定値の変化でずれていないかを一枚ずつ確かめる。

### 新しいプラグインにはしない

互換性が問題になる範囲は狭い。

- 選択欄に出るのはプラグイン独自のテーマだけで、名前も設定項目も変わらない。見た目が同じになるよう移行すれば、大多数の利用者には何も起きない。
- 影響を受けるのは自作テーマの利用者に限られる。`vivlio:base` / `vivlio:bunko` / `vivlio:techbook` / `vivlio:academic` を土台にしている場合と、`--vs-*` 変数を上書きしている場合である。

新しいプラグインにすると、コミュニティプラグインの審査をやり直すことになり、利用者も二つに分かれる。`vivlio.yaml` やフロントマターの設定はそのまま使えるのに、乗り換えの手間だけを利用者に負わせることになる。同じプラグインのまま、次の方法で互換性を保つ。

1. **移行期間は v2 も同梱する。** `vivlio:base` などは v3 にし、旧版は `vivlio:base@v2` のような名前で引き続き指定できるようにする。テーマの CSS は小さく CC0 なので、二つ載せても問題にならない。
2. **自作テーマの古い変数名を検出して警告する。** 自作テーマは `resolveVaultTheme` で一度 1 枚にまとめているので、その時点で v2 の変数名を見つけたら、新しい名前を添えて警告を出す。上書きが黙って効かなくなるのを防ぐ。
3. **0.x の minor 更新（例: 0.19.0）として出す。** semver 上、0.x の minor 更新では破壊的変更が許される。リリースノートに改名表へのリンクを載せる。

### 急がない

v2 のテーマは CC0 でプラグインに埋め込んであるため、今のまま動き続ける。core 2.45 系も v2 の CSS を問題なく処理する。v3 に移る主な理由は、自作テーマを書く人が Vivliostyle の最新ドキュメントどおりに書けるようにすることである。

当面は README / README.ja に「同梱テーマは Vivliostyle Themes v2 準拠」と書いておき、v3 への移行は別の機会にまとめて行う。

2026-10-06 追記: README / README.ja の「テーマを自作する」節と、マニュアル [06-custom-theme.md](../manual/06-custom-theme.md) に、v2 準拠であることと v3 の書き方が使えないことを明記した。マニュアルには、よく使う変数の v2 / v3 対照表と、生成 AI への依頼文に入れる制約を加えた。

## v3 の主な変更点

| 項目 | v2（現在の同梱版） | v3 |
|---|---|---|
| エントリ | `theme-all.css`（全部入り）/ `theme-basic.css` | `theme.css` は基本モジュールのみ。残りはサブパスでオプトイン |
| モジュール | `css/common/`・`css/partial/`・`css/lib/` | `@vivliostyle/theme-base/{page,footnote,toc,figure,table,citation,prism,...}`（`package.json` の `exports`） |
| 読み込み | 相対パスの `@import url(...)` | パッケージ名の `@import '@vivliostyle/theme-base/page'`（CLI ≥ 11.3.0） |
| 変数名 | `--vs-color-body`、`--vs-page--mbox-content-top-left` など | `--vs-color-foreground`、`--vs-page--mbox-top-left-content` など（大量に改名） |
| 画面・印刷の出し分け | `-on-print` / `-on-screen` 接尾辞 | `@media print { :root { ... } }` で同じ変数を再定義 |
| 公式テーマ固有の変数 | `--vs-theme--*` | `--vs-theme-<name>--*` |
| 名前付きページ | `[role='doc-dedication']` など内部要素でも切り替わる | `html` / `body` に付けたときだけ切り替わる |
| 外部リンク脚注 | 印刷時に既定で適用 | 既定では適用しない（`footnote/external-links` で有効化） |
| 脚注領域 | `@-adapt-footnote-area` | `@footnote` |
| 開発ツール | `create-vivliostyle-theme` / `vivliostyle-theme-scripts` | `vivliostyle theme create` / `vivliostyle theme validate` |

既定値も一部変わった。ページの天地余白は 22mm から 18mm に、リストの字下げは `2rem` に、`--vs--anchor-text-color` は `inherit` から `var(--vs-color-foreground)` になった。見出しカウンタは親セクションでリセットされ、相互参照の下線は消えた。

`@layer` は v3 テーマ自体では使われていない（core 2.45.0 の Cascade Layers 対応とは別の話）。

## プラグインへの影響

### 1. パッケージ名による import

**最大の障害。** v3 の `theme-bunko` / `theme-techbook` / `theme-academic` の `theme.css` は、冒頭で次のように読み込む。

```css
@import '@vivliostyle/theme-base';
@import '@vivliostyle/theme-base/page';
@import '@vivliostyle/theme-base/footnote';
```

プラグインは [esbuild/assets.mjs](../esbuild/assets.mjs) でテーマの CSS を `@vivliostyle/<name>/<相対パス>` というキーで埋め込み、ローカルサーバーから配信している。ブラウザ（Viewer）は `'@vivliostyle/theme-base/page'` を **import 元からの相対 URL** とみなすため、`.../@vivliostyle/theme-bunko/@vivliostyle/theme-base/page` を取りにいって 404 になる。

対応策: 埋め込み時に `exports` の対応表（`"./page": "./css/page/index.css"`、`"./*": "./css/*.css"` ほか）で相対 URL に書き換える。自作テーマを解決する [src/build/theme.ts](../src/build/theme.ts) の `inlineImport` も、Vault 内の相対パスとして扱うのをやめ、同じ対応表で同梱テーマへ解決する必要がある。

### 2. 同梱テーマの読み込み元

| テーマ | 現在の import | v3 で必要な変更 |
|---|---|---|
| `novel`（`essay`・`novel-2col`・`verse`・`haiku`・`tanka` が継承） | `theme-base/theme-all.css` | `theme-all.css` は廃止。使うモジュールを個別に import する |
| `english-novel` | `theme-base/theme-all.css` | 同上 |
| `manual` | `theme-techbook/theme.css` | 柱の変数が廃止（下記） |
| `paper` | `theme-academic/theme.css` | 外部リンク脚注・相互参照の変数が変更 |
| `base`（`vivlio:base`、選択欄には出ない） | `theme-base/theme-all.css` | 対応先を決め直す（`theme.css` だけでは中身が大きく減る） |

[src/vendor/assets.ts](../src/vendor/assets.ts) の `BUNDLED_THEMES` と、埋め込み対象を列挙した [esbuild/assets.mjs](../esbuild/assets.mjs) の両方に手を入れる。

### 3. 改名・廃止される CSS 変数

プラグインが使っている変数のうち、v3 で影響を受けるもの。

| v2 の名前 | v3 の名前 | 使用箇所 |
|---|---|---|
| `--vs--html-font-size` | `--vs-font-size` | [css.ts:73](../src/build/css.ts:73)、[english-novel.css:28](../src/themes/english-novel.css:28)、[paper.css:10](../src/themes/paper.css:10)、[epub.ts:185](../src/export/epub.ts:185)・[:295](../src/export/epub.ts:295) |
| `--vs-page--mbox-content-{top,bottom}-{left,right,center}` | `--vs-page--mbox-{top,bottom}-*-content`（左右は `inside` / `outside` 系に整理） | `novel.css`、`english-novel.css`、`paper.css`、[css.ts:945](../src/build/css.ts:945) |
| `--vs-page--margin-inner` / `-outer` | `--vs-page--margin-inside` / `-outside` | `novel.css:121-122`、`english-novel.css:35-36` |
| `--vs-page--mbox-color-body` | `--vs-page--mbox-text-color` | `english-novel.css:41` |
| `--vs--anchor-color` | `--vs--anchor-text-color` | `english-novel.css:521` |
| `--vs-prism--color` / `--vs-prism--color-<token>` | `--vs-prism--text-color` / `--vs-prism--<token>-text-color` | `manual.css:451-482`（約30か所） |
| `--vs-crossref--marker-display` | 種類別（`--vs-figure--*` など）に分割 | `manual.css:563`、`paper.css:107` |
| `--vs-theme--page-{top-left,top-right,bottom}-content`（techbook） | 廃止。`--vs-page--mbox-*-outside-content` で指定 | `manual.css:34-36`・`:369`・`:449` |
| `--vs-theme--figure-img-max-{width,height}`（academic） | `--vs-theme-academic--*` | `paper.css:46`・`:108-109` |
| `--vs-theme--num-of-{character,line,column}`（bunko） | `--vs-theme-bunko--num-of-*` | [css.ts:49-57](../src/build/css.ts:49)。`novel` 系は自前で読むので影響しないが、`vivlio:bunko` には効かなくなる |

**注意**: [epub.ts](../src/export/epub.ts) の `unsizeRoot` は `font-size: var(--vs--html-font-size);` という宣言を正規表現で消している。v3 では `font-size: var(--vs-font-size);` に変わるので、正規表現を直さないと EPUB のルート文字サイズが固定に戻り、リーダーの文字サイズ変更が効かなくなる。エラーにはならないので気づきにくい。

### 4. 名前付きページ（献辞・題辞）

v2 の theme-base は `[role='doc-dedication']` / `[role='doc-epigraph']` に `page: dedication` / `page: epigraph` を当てており、プラグインはそれに頼っている（[sections.ts:19-20](../src/build/sections.ts:19) で role を振り、`css.ts` の `@page titlepage, halftitle, copyrightpage, dedication, epigraph, colophon` で柱を消す）。

v3 では `:is(html, body):is(.dedication, [role='doc-dedication'])` だけが対象になる。プラグインは role を本文中の `<section>` に振っているため、**献辞・題辞のページに柱とノンブルが出るようになる**。扉や奥付と同じように、プラグイン側で `page: dedication` / `page: epigraph` を振れば直る。

表紙と目次は、v2 の時点で `:has()` が効かないことを確認し、すでにプラグイン側で名前を振っている（SPEC 5.9 ほか）。そのため影響はない。

### 5. 外部リンク脚注

v3 では外部リンクの自動脚注が既定でなくなる。

- `novel`（縦組み）: 自動脚注を打ち消すルールがあるが、v3 では打ち消す対象自体がなくなる。テスト `theme-base still auto-footnotes external links`（[convert.test.ts:800](../test/convert.test.ts:800)）は失敗する。テストは「上流が改名したら気づく」ためのものなので、狙いどおりの検知になる。
- `manual`・`paper`・`english-novel`（横組み）: 現在は印刷時に URL が脚注になっている。v3 で同じ挙動を保つには `@vivliostyle/theme-base/footnote/external-links` を明示的に import する。保たないなら、その変更を案内に書く。

### 6. 既定値の変更による見た目の差

v3 の既定値に依存している箇所は、変数名を直しても組版結果が変わる可能性がある。

- ページ天地余白 22mm → 18mm（`manual` / `paper` は techbook / academic の既定を一部継いでいる）
- 最上位リストの字下げ `2rem`（`novel` は目次の `ol` を 0 にしているが、本文のリストは既定のまま）
- 見出しカウンタのリセット、相互参照の下線除去（`manual` / `paper` の図表番号）
- `pre` の印刷時 `overflow-x: visible`

`sample/` 一式の PDF を v2 と v3 で並べて比べるのが確実。

### 7. 自作テーマの利用者

- `@import url("vivlio:base")` で v2 の `theme-all.css` を土台にしている自作テーマは、v3 に上げると中身が変わる。`vivlio:base` を `theme.css`（基本のみ）に対応させるのか、v2 相当の全モジュールを束ねたものを用意するのかを決める必要がある。
- 利用者が v2 の変数名で書いた上書きは、v3 に上げると黙って効かなくなる。逆に今は、Vivliostyle の新しいドキュメントを見て v3 の変数名で書くと効かない。どちらの場合も、README（[README.md:373](../README.md) 付近、[README.ja.md:290](../README.ja.md) 付近）に**同梱テーマの基盤バージョン**を明記するのが最低限の対応になる。

### 影響しないもの

- **Vivliostyle core / viewer**: 2.45.0（最新は 2.45.2）。v3 テーマの前提となる CSS 機能（`@footnote`、CSS Nesting、`@layer`）はすでに使える。
- **VFM**: 2.7.2 で、changelog の版と同じ。
- **CLI の新コマンド**（`vivliostyle theme create` / `validate`）: このプラグインは CLI を使っていない（SPEC 3.4）。

## 移行する場合の作業順

1. `@vivliostyle/theme-*` を 3.0.0 に上げる（`theme-base` 3.0.0、公式テーマ 3.0.0）。SPEC 2.1 の版表も更新する。
2. `esbuild/assets.mjs`: v3 の `exports` に従ってパッケージ名の `@import` を相対 URL に書き換えて埋め込む。`theme-base` 配下の `css/**` と `theme.css` を収集する。
3. `src/build/theme.ts`: 自作テーマの `@import '@vivliostyle/theme-base/...'` を同梱テーマへ解決する（任意。対応すれば v3 のドキュメントの書き方がそのまま使える）。
4. `src/themes/*.css`: `theme-all.css` を必要なモジュールの import に置き換え、上の表に従って変数名を改める。`-on-print` 接尾辞の利用はないことを確認済み。
5. `src/build/css.ts`: `--vs--html-font-size` → `--vs-font-size`、`mbox-content-*` の改名、献辞・題辞の `page:` 付与、bunko 用の `--vs-theme-bunko--num-of-*` を併記する。
6. `src/export/epub.ts`: `unsizeRoot` の正規表現と EPUB 用の上書きを直す。
7. 外部リンク脚注の扱いをテーマごとに決め、`convert.test.ts` の該当テストを書き換える。
8. `sample/` と `manual/` の出力を v2 と見比べ、余白・リスト・柱・ノンブル・目次・図表番号を確認する。
9. 互換措置を入れる（[対応方針](#新しいプラグインにはしない)）。v2 を `vivlio:base@v2` などの名前で残し、自作テーマに v2 の変数名があれば警告する。
10. README / README.ja に「同梱テーマは Vivliostyle Themes v3 準拠」と書き、自作テーマの利用者向けに変数の改名表へのリンクを載せる。0.x の minor 更新として出し、リリースノートに破壊的変更を明記する。

v3 は CLI 11.3.1 以降を前提とした構成で、CLI を使わないこのプラグインには 1・2 の手当てが必須になる。一方で、同梱テーマの多くはこのプラグイン自身のテーマで、v3 の新モジュール（`listing`・`theorem`・`sidenote` など）を直ちに必要としているわけではない。急いで追従する理由は、自作テーマの利用者が v3 のドキュメントの書き方を使えるようにすることにある。
