# 自分でテーマを作ってみる

[前: 原稿と本の構造](05-writing-and-structure.md) / [マニュアル目次](00_vivlio_plugin_manual.md) / [次: 書き出しとトラブルシューティング](07-export-and-troubleshooting.md)

この章では、Vault 内の CSS を Vivlio のテーマとして使います。まず `novel` を土台に小さく変更し、必要に応じてページ CSS を増やす方法が安全です。

## Vivlio での「テーマ」

一般的な Vivliostyle CLI では npm パッケージや `vivliostyle.config.js` を使えますが、Vivlio プラグインの `theme` が直接受け取るのは次のいずれかです。

- 同梱テーマ名。通常は `novel`
- **Vault 内にある一枚の CSS ファイルへの Vault 相対パス**

プラグイン内のテーマを自作 CSS から読み込むために、Vivlio 固有の `vivlio:` URL を使います。

```css
@import url("vivlio:novel");
```

利用できる名前は次のとおりです。

| URL | 内容 |
|---|---|
| `vivlio:novel` | Vivlio 用に調整した日本語小説テーマ。推奨の出発点 |
| `vivlio:base` | Vivliostyle theme-base |
| `vivlio:bunko` | Vivliostyle theme-bunko |
| `vivlio:techbook` | Vivliostyle theme-techbook |
| `vivlio:academic` | Vivliostyle theme-academic |

テーマ選択欄に標準表示される同梱テーマは、プラグインの構造と突き合わせて確認済みの `novel` だけです。ほかのテーマは `vivlio:` import から利用できますが、扉・目次・奥付・柱・ノンブル・縦横組みを必ず確認してください。

## 最初の自作テーマ

### 1. CSS ファイルを作る

Vault に `装丁/遠雷.css` を作ります。

```css
/* 装丁/遠雷.css */
@import url("vivlio:novel");

:root {
  --vs-novel--boten-font-size: 0.32rem;
  --vs-novel--secondary-ink: #4a4a4a;
  --vs-novel--rule-ink: #9a9a9a;

  --vs--h1-font-size: 1.5rem;
  --vs--h2-font-size: 1.25rem;
}

.callout-warning {
  border-color: #a40000;
  background: #fff8f5;
}
```

### 2. 本から選ぶ

`vivlio.yaml` の `theme` に Vault 相対パスを書きます。

```yaml
theme: 装丁/遠雷.css
```

または設定タブ / プレビューツールバーのテーマ選択から `.css` を選びます。Vault 内の CSS は自動的に候補へ追加されます。プレビューツールバーでの選択は Vault 全体の既定テーマとして保存されます。本の `vivlio.yaml` に `theme` がある場合は本側が優先されるので、その本だけの変更は YAML に書きます。

### 3. 再ビルドする

プレビューの **再ビルド**を押し、少なくとも次を確認します。

- 本文、ルビ、傍点、脚注
- `#` 〜 `###` の見出し
- 左右ページの柱とノンブル
- 扉、目次、奥付
- 画像、コールアウト、表、コード
- PDF と EPUB の両方

## import の扱いは Vivlio 固有

自作テーマ内の `@import` は書き出し前に一枚の CSS へ展開されます。

```text
装丁/
├─ 遠雷.css
├─ colors.css
└─ parts/
   └─ callouts.css
```

```css
/* 遠雷.css */
@import url("vivlio:novel");
@import url("./colors.css");
@import "./parts/callouts.css";
```

- `vivlio:*` 形式のパスを指定すると、プラグインに同梱されたテーマを読み込みます。
- それ以外の相対パスは、import 元 CSS の場所を基準に Vault から読みます。
- 各ファイルは一度だけ展開されるため、循環 import で無限ループしません。
- `https:` などのリモート CSS は import のまま残ります。オフライン EPUB や配布の再現性を考えると、必要な CSS は Vault 内に置く方が安全です。
- npm パッケージ名の解決は行いません。CLI 向けの `@import url(../@vivliostyle/...)` をそのまま書いても、Vault に対応ファイルがなければ読めません。Vivlio では `vivlio:` を使います。

展開後の同じ CSS がプレビューと EPUB に使われます。

## CSS の適用順

最終スタイルは概ね次の順に並び、後のものが同じ詳細度なら優先されます。

1. `theme` で選んだ同梱テーマまたは Vault テーマ
2. `vivlio.yaml` / フロントマターから Vivlio が生成する用紙・書字方向・フォント等の指定
3. Vivlio が追加するルビ、傍点、画像、表紙、前後付け、ノンブル等の規則
4. `vivlio.yaml` の `css`
5. 設定タブの **追加 CSS**

このため、用紙サイズや本文フォントのような「本の設定」はテーマより後で上書きされます。テーマの値が効かないときは次を確認してください。

- `vivlio.yaml` に同じ設定がないか
- ノートの `vivlio-*` が上書きしていないか
- 本だけの最終調整なら `css: |` に置くべきか
- Vault 全体の最終調整なら **追加 CSS**に置くべきか

テーマは意匠、本設定は内容に応じた判型・組方向・フォント、`css` はその本だけの例外というように、役割を分けると管理しやすくなります。

## `novel` テーマの主な変数

`novel` は [Vivliostyle theme-base](https://docs.vivliostyle.org/ja/themes/usage/#theme-baseを直接使う) の全モジュールを土台にしています。

| 変数 | 初期値 | 用途 |
|---|---:|---|
| `--vs-writing-mode` | `vertical-rl` | 書字方向。通常は Vivlio の `writingMode` が上書き |
| `--vs-line-height` | `2` | 行送り。版面計算にも関係するため変更後は全ページ確認 |
| `--vs--p-text-indent` | `1em` | 段落字下げ。通常は本設定から調整 |
| `--vs--p-text-align` | `justify` | 本文の揃え |
| `--vs--rt-font-size` | `0.5rem` | ルビサイズ |
| `--vs-novel--boten-font-size` | `0.35rem` | 傍点サイズ |
| `--vs-novel--chars-per-line` | `40` | 本設定に字数がない場合のフォールバック |
| `--vs-novel--lines-per-page` | `16` | 本設定に行数がない場合のフォールバック |
| `--vs-novel--secondary-ink` | `#3a3a3a` | シリーズ名、役割、連絡先など補助文字 |
| `--vs-novel--rule-ink` | `#bdbdbd` | 奥付などの罫線 |
| `--vs--h1-font-size` | `1.4rem` | H1 の大きさ |
| `--vs--h1-margin-block` | `0 4rem` | H1 前後の空き |
| `--vs-page--mbox-font-family` | 本文を継承 | 柱・ノンブルのフォント |

`charsPerLine` / `linesPerPage` が本に設定されている場合、Vivlio は `--vs-theme--num-of-character` / `--vs-theme--num-of-line` を生成します。テーマ側の `--vs-novel--chars-per-line` を変えてもそちらが優先される点に注意してください。

## Vivlio が付けるクラスと属性

### 文書ルート

| セレクタ | 対象 |
|---|---|
| `:root.vivlio-doc` | すべての生成文書 |
| `:root.vivlio-vertical` | 縦組み文書 |
| `:root.vivlio-horizontal` | 横組み文書 |
| `:root.vivlio-body` | 本文の章 |
| `:root.vivlio-front-matter` | 前付け |
| `:root.vivlio-toc` | 自動目次 |
| `:root.vivlio-cover` | 表紙 |

### 本文中の要素

| セレクタ | 対象 |
|---|---|
| `ruby.boten` / `ruby.boten > rt` | 傍点 |
| `.tcy` | 縦中横 |
| `.callout` / `.callout-<種別>` | コールアウト |
| `.callout-title` | コールアウト見出し |
| `.task-list` / `.task-list-item` | タスクリスト |
| `.vivlio-page-break` | 強制改ページ先のブロック |
| `.vivlio-blank-lines` | 連続空行から作った空き |
| `p.vivlio-no-indent` | 字下げしない段落 |
| `.vivlio-rendered` | Mermaid / Dataview 等の描画結果 |
| `.titlepage` / `.halftitle` | 扉 / 半扉 |
| `[role='doc-toc']` | 目次 |
| `[role='doc-colophon']` | 奥付 |

論理プロパティの `margin-block`、`padding-inline`、`block-size`、`inline-size` を使うと、縦横両方に対応しやすくなります。

## よく使うカスタマイズ

### コールアウトを種類別にする

```css
.callout-note {
  border-color: #3465a4;
}

.callout-warning {
  border: 2px solid #a40000;
  background: #fff7f4;
}
```

### 見出しの前で改ページする

```css
h1 {
  break-before: page;
  break-after: avoid;
}
```

### 左右ページで柱を変える

```css
@page :left {
  --vs-page--mbox-content-top-left: var(--vivlio-running-chapter);
}

@page :right {
  --vs-page--mbox-content-top-right: var(--vivlio-running-title);
}
```

### その本だけ最後に上書きする

```yaml
css: |
  :root {
    --vs-page--mbox-font-size: 7pt;
  }

  .callout-warning {
    border-color: #a40000;
  }
```

## Vivliostyle 公式ドキュメントへの案内

Vivlio 固有なのは、Vault 内 CSS の選択、`vivlio:` import、適用順、上記クラスです。CSS 組版そのものは Vivliostyle の公式資料を参照してください。

- [テーマの使い方 — CSS 変数と公式テーマ](https://docs.vivliostyle.org/ja/themes/usage/)
- [Theme の開発](https://docs.vivliostyle.org/ja/themes/development/)
- [Vivliostyle Theme の仕様](https://docs.vivliostyle.org/ja/themes/spec/)
- [チュートリアル: 用紙と文字のスタイル](https://vivliostyle.org/ja/tutorials/configure-page-text/)
- [チュートリアル: 基本的な要素のスタイル](https://vivliostyle.org/ja/tutorials/configure-basic-elements/)
- [Vivliostyle リファレンス — サポートする CSS 機能への入口](https://docs.vivliostyle.org/ja/reference/)
- [VFM リファレンス](https://docs.vivliostyle.org/ja/vfm/vfm/)

> 公式資料にある `vivliostyle.config.js`、npm テーマのインストール、CLI の `--theme` は、一般の Vivliostyle プロジェクト向けです。Vivlio の Vault テーマへ移すときは、CSS 本体を Vault に置き、同梱テーマの参照を `vivlio:*` に置き換えてください。

## 壊れにくいテーマ開発手順

1. `@import url("vivlio:novel");` だけの CSS から始める。
2. CSS 変数を一つずつ変更する。
3. 変数で足りない箇所だけ要素セレクタを追加する。
4. 短いテスト本に、見出し、ルビ、傍点、脚注、画像、表、コード、コールアウト、扉、目次、奥付を用意する。
5. 縦組みと横組み、左右ページ、短い章と長い章を確認する。
6. PDF と EPUB の両方で確認する。
7. 使うフォントと画像のライセンス、外部 URL への依存を確認する。
