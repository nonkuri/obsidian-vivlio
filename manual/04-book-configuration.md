# 本ごとの設定 — `vivlio.yaml` とフロントマター

[前: プラグイン設定](03-settings.md) / [マニュアル目次](00_vivlio_plugin_manual.md) / [次: 原稿と本の構造](05-writing-and-structure.md)

## どこに何を書くか

### `vivlio.yaml`

一冊分のフォルダ直下に置く、その本の設定ファイルです。

```text
本/遠雷/
├─ vivlio.yaml
├─ index.md
├─ 01-第一章.md
└─ 02-第二章.md
```

本の書誌情報、判型、テーマ、表紙、前付け・後付け、フォント、出力先などはここへまとめます。入れ子の YAML とコメントが使えます。

### ノートのフロントマター

個別ノートだけを変更するときに使います。Obsidian のプロパティ UI と相性のよいフラット形式は次の形です。

```yaml
---
title: 第一章
vivlio-writing-mode: horizontal-tb
vivlio-order: 3
---
```

手書きなら、次の入れ子形式も読み取れます。ただし Obsidian のプロパティエディタでは入れ子を安全に編集できないため、通常はフラット形式を推奨します。

```yaml
---
vivlio:
  writingMode: horizontal-tb
  order: 3
---
```

**Vivlio: このノートに設定を追加**を実行すると、選択した項目を `vivlio-ケバブケース` の名前で追加します。`sections`、`colophonExtra`、`embedFonts`、`vfm` のような入れ子が必要な項目はこのコマンドに出ず、`vivlio.yaml` へ書きます。

## 設定例

```yaml
# 書誌情報
title: 遠雷
subtitle: 手紙をめぐる四つの夜
series: 北国綺譚
author: 山田花子
publisher: 架空書房
date: 2026-09-04
lang: ja
version: 初版

# 組版
theme: novel
writingMode: vertical-rl
size: 文庫
charsPerLine: 39
linesPerPage: 15
footnote: gcpm
paragraphIndentMode: auto

# 表紙
cover: 本/遠雷/images/cover.jpg
coverFit: cover
coverInPdf: true

# 前付け・後付け
sections:
  halfTitle: off
  titlePage: auto
  dedication: 本/遠雷/献辞.md
  toc: auto
  preface: off
  afterword: 本/遠雷/あとがき.md
  colophon: auto
pageNumbering: roman-then-arabic
tocDepth: 2
startPage: 1

# 出力
output: _output/遠雷.pdf
```

## 全キー一覧

### 本の情報

| キー | 型・例 | 説明 |
|---|---|---|
| `title` | 文字列 | 書名。単独ノートでは通常の `title` も書名候補になります。`vivlio-title` があればそちらを優先。 |
| `subtitle` | 文字列 | 副題。 |
| `series` | 文字列 | シリーズ名。扉・奥付・EPUB メタデータに使用。 |
| `author` | 文字列 | 著者。 |
| `translator` | 文字列 | 訳者。 |
| `publisher` | 文字列 | 発行所。 |
| `printer` | 文字列 | 印刷所。 |
| `contact` | 文字列 | 住所、メールなどの連絡先。 |
| `website` | 文字列 | Web サイト。 |
| `date` | `2026-09-04` など | 発行日。`lang` が日本語なら、縦組みは漢数字、横組みは `2026年9月4日` に整形されます。日付として読めない文字列は書いたまま出ます。 |
| `lang` | `ja` など | 文書の言語。未指定時は `ja`。 |
| `version` | `初版`、`2` など | 版。 |
| `colophonExtra` | マッピングまたは配列 | 奥付へ任意行を追加。下記参照。 |

`colophonExtra` は短いマッピング形式:

```yaml
colophonExtra:
  装丁: 山田花子
  校正: 鈴木一郎
```

または、順序や同じラベルの重複を明示できる配列形式を使えます。

```yaml
colophonExtra:
  - label: 装丁
    value: 山田花子
  - label: 協力
    value: 第一読書会
```

### 組版

| キー | 値・例 | 説明 |
|---|---|---|
| `theme` | `novel`、`装丁/my.css` | 同梱テーマ名または Vault 内 CSS のパス。 |
| `writingMode` | `vertical-rl` / `horizontal-tb` | 縦組み / 横組み。 |
| `size` | `A5`、`文庫`、`128mm 188mm` | 用紙サイズ。任意の CSS `size` 値も可。 |
| `charsPerLine` | 数値 / `null` | 1 行の字数。`linesPerPage` と組で指定します。 |
| `linesPerPage` | 数値 / `null` | 1 ページの行数。 |
| `baseFontSize` | `3mm`、`10pt` | 基準文字サイズ。指定すると自動計算より優先。 |
| `paragraphIndent` | 空、`0`、`1em` | 段落の字下げ。空はテーマ任せ。 |
| `paragraphIndentMode` | `auto` / `manuscript` / `brackets` / `all` | 字下げ対象を決定。 |
| `footnote` | `gcpm` / `pandoc` / `dpub` | ページ脚注、章末注、DPUB-ARIA。 |
| `highlight` | `boten` / `strong` / `mark` / `off` | `==...==` の変換先。 |
| `autoTcy` | 真偽値 | 1〜2 桁の数字を自動正立。 |
| `imageWidthUnit` | `px` / `percent` / `mm` | `![[画像.png\|300]]` のような単位なし幅の解釈。画像側の `%`、`mm`、`px` が優先。 |

`charsPerLine` と `linesPerPage` は片方だけでなく両方を指定してください。グリッド系テーマでは、用紙と字数・行数から収まる本文サイズを Vivlio が計算します。`baseFontSize` を指定するとその値を使うため、版面からはみ出さないかプレビューで確認します。

### 表紙

| キー | 値 | 説明 |
|---|---|---|
| `cover` | 画像の Vault 相対パス | 一枚画像を表紙に使用。EPUB の表紙画像にもなります。 |
| `coverPage` | Markdown ノートのパス | ノートを表紙ページとして組版。`cover` より優先。 |
| `coverFit` | `cover` / `contain` | `cover` は全面を埋めて切り抜き、`contain` は全体を収めます。 |
| `coverInPdf` | 真偽値 | PDF へ表紙を含めるか。対話式の書き出しではダイアログの **表紙を含める**が最優先です。 |

### フォント

| キー | 値・例 | 説明 |
|---|---|---|
| `fontFamily` | CSS フォントスタック | 本文。 |
| `headingFontFamily` | CSS フォントスタック | 見出し。 |
| `monospaceFontFamily` | CSS フォントスタック | コード。 |
| `mboxFontFamily` | CSS フォントスタック | 柱・ノンブル。空ならテーマ / 本文に従う。 |
| `tcyFontFamily` | CSS フォントスタック | 縦中横。空なら継承。 |
| `fontFeatureSettings` | `'vert' 1` など | OpenType 機能。 |
| `rubyFontSize` | `0.5em` など | ルビ文字サイズ。 |
| `embedFonts` | 配列 | 本に同梱するフォントファイル。 |

```yaml
fontFamily: "'My Mincho', 'Noto Serif JP', serif"
headingFontFamily: "'My Gothic', 'Noto Sans JP', sans-serif"

embedFonts:
  - family: My Mincho
    src: fonts/MyMincho-Regular.woff2
    weight: 400
    style: normal
  - family: My Mincho
    src: fonts/MyMincho-Bold.woff2
    weight: 700
```

相対パスは Vault 相対です。絶対パスを使う場合は、プラグイン設定の **Vault 外のファイルを許可する**をオンにする必要があります。

### 前付け・後付け

```yaml
sections:
  halfTitle: auto
  titlePage: auto
  dedication: 献辞.md
  epigraph: 題辞.md
  toc: auto
  preface: まえがき.md
  afterword: あとがき.md
  appendix: 付録.md
  bibliography: 参考文献.md
  acknowledgments: 謝辞.md
  colophon: auto
```

各値は `auto`、`off`、ノートパスのいずれかです。ただし `auto` で内容を生成できるのは `halfTitle`、`titlePage`、`toc`、`colophon` だけです。

配置順は上の並びどおりで、`preface` の後に本文、本文の後に `afterword` 以降が続きます。

| キー | 値 | 説明 |
|---|---|---|
| `pageNumbering` | `roman-then-arabic` / `continuous` / `none` | ノンブル方式。 |
| `tocDepth` | 1〜6 | 自動目次と EPUB ナビゲーションへ拾う見出しの深さ。 |
| `includeToc` | 真偽値 | 章順の元にした目次ノート自身も本文へ入れる。初期値は `false`。 |
| `startPage` | 数値 / `null` | 本文の算用数字ノンブルの開始番号。 |

### 出力と追加 CSS

| キー | 値・例 | 説明 |
|---|---|---|
| `output` | `_output/book.pdf`、絶対パス | 書き出し先。対話式の書き出しではダイアログに表示されたパスが最優先。 |
| `cropMarks` | 真偽値 | トンボを付ける。 |
| `bleed` | `3mm` など | 塗り足し。 |
| `css` | 複数行文字列 | その本だけの追加 CSS。テーマと Vivlio の生成規則の後に入る。 |

```yaml
cropMarks: true
bleed: 3mm
css: |
  .callout-warning {
    border-color: #b00020;
  }
```

`css` は本ごとの細かな調整に便利です。長い CSS は別ファイルにし、`theme` で指定するか、Vault 全体なら設定タブの **追加 CSS**を使ってください。

> **0.2.0 の注意:** 対話式の書き出しダイアログは、設定タブの **出力フォルダ**と対象名から初期パスを作ります。`vivlio.yaml` の `output` はダイアログへ自動反映されないため、実行前に表示中のパスを確認してください。同様に PDF 表紙の最終判断はダイアログのトグルです。

### VFM と記法変換

`vfm` は [VFM のオプション](https://docs.vivliostyle.org/ja/vfm/)を渡すための入れ子です。

```yaml
vfm:
  hardLineBreaks: true
```

`syntax` では、本ごとに前処理を上書きできます。

```yaml
syntax:
  boten: true
  aozoraRuby: true
  keepTags: false
  dynamic: false
```

利用できる名前は `embed`、`dynamic`、`boten`、`aozoraRuby`、`tcy`、`autoTcy`、`highlight`、`imageEmbed`、`wikilink`、`callout`、`taskList`、`keepTags`、`stripComments`、`stripBlockIds`、`stripLeadingSpace`、`pageBreak`、`blankLines` です。

## ノート専用キー

次の二つは本の設定ではなく、章としてのノートに属します。`vivlio.yaml` ではなくフロントマターへ書きます。

| フロントマター | 説明 |
|---|---|
| `vivlio-order: 3` | 完成した本の 1 始まりの位置に固定。目次リンク順やファイル名順より優先。 |
| `vivlio-toc: true` | このノートを章順を定める目次ノートとして扱う。 |

## 空の値と型

- 空欄または `null` は「この層では決めない」として上位層の値を継承します。
- `charsPerLine`、`linesPerPage`、`tocDepth`、`startPage` は数値として扱われます。
- `autoTcy`、`coverInPdf`、`cropMarks`、`includeToc` は YAML の `true` / `false` を使います。
- 不明なキーや不正な値は組版時の警告対象になります。綴りとインデントを確認してください。

## 設定リファレンスを自動生成する

コマンド **Vivlio: 設定リファレンスを書き出す**を実行すると、現在の既定値と日本語コメントを付けた `vivlio-reference.yaml` がアクティブノートのフォルダへ作られます。値の候補やキー名を確認するときは、手入力で覚えるよりこのファイルを利用するのが確実です。
