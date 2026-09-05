# obsidian-vivlio 仕様検討

Obsidian の Markdown を Vivliostyle で日本語組版し、プレビュー付きで PDF / EPUB に出力するプラグイン。

作成日: 2026-09-01 / 調査時点の各パッケージ版数を明記
更新: 2026-09-02 — 0.1.0 の実装に合わせて修正。実装して初めて分かった点は
**【実装時の修正】**と記し、決定 31〜33 と「10. 実装状況」に集約した。

---

## 1. 結論

**実現可能。難易度は「中」。** ただし `@vivliostyle/cli` をそのまま呼ぶ構成ではなく、
**VFM + Vivliostyle Core/Viewer + Electron の `printToPDF`** を自前で組み合わせるのが最短で、
これなら Playwright / Chromium の別途ダウンロードが一切不要になる。

最大の判断ポイントは技術ではなく **ライセンス（AGPL-3.0）**。→ 3.1

| 機能 | 難度 | 根拠 |
|---|---|---|
| Markdown → 日本語組版 HTML | 低 | `@vivliostyle/vfm` をバンドルするだけ |
| ページ組版プレビュー（縦書き含む） | 低〜中 | `@vivliostyle/core` の `CoreViewer` を iframe/webview で動かす |
| PDF 出力 | 中 | Electron `webContents.printToPDF({preferCSSPageSize:true})` |
| EPUB 出力 | 中〜高 | CLI の実装（747行・Node依存）を JSZip で再実装が必要 |
| モバイル対応 | 不可 | `isDesktopOnly: true` 前提 |

---

## 2. 調査で確認できた事実

### 2.1 パッケージ

| パッケージ | 版 | ライセンス | 用途 |
|---|---|---|---|
| `@vivliostyle/vfm` | 2.7.2 | **Apache-2.0** | Markdown → HTML（ルビ・脚注・frontmatter） |
| `@vivliostyle/core` | 2.45.0 | **AGPL-3.0** | CSS 組版エンジン（`CoreViewer` クラス） |
| `@vivliostyle/viewer` | 2.45.0 | **AGPL-3.0** | 完成品ビューア UI（prebuilt `lib/index.html` + js、tgz 1.4MB） |
| `@vivliostyle/cli` | 11.2.0 | **AGPL-3.0** | node >= 22.12。今回は不採用（3.4） |
| `@vivliostyle/theme-bunko` / `-techbook` / `-base` / `-academic` | 2.x | **CC0-1.0** | 組版テーマ。同梱・改変自由 |

### 2.2 VFM が備える日本語向け記法

- ルビ: `{Ruby|ルビ}` → `<ruby>Ruby<rt>ルビ</rt></ruby>`（`\|` でパイプのエスケープ可）
- 脚注: `pandoc` / `dpub` / `gcpm` の3モード（`gcpm` = CSS Generated Content for Paged Media の傍注）
- Frontmatter: `id` `lang` `dir` `class` `title` `html` `body` `base` `meta` `link` `script` `vfm`
- `vfm` サブキー: `math` `mathRenderer` `partial` `hardLineBreaks` `theme` `footnote`
  `imgFigcaptionOrder` `captionlessImagePolicy` `parseFigcaptionAsInline` `rewriteRelativeHrefExtensions` `table`
- 見出しの自動セクション化（`<section>` 生成）、図表キャプション、Temml による数式

**縦中横（tcy）は VFM の記法にはない。** CSS（`text-combine-upright`）かテーマ側、
または本プラグイン独自の前処理記法で補う。→ 5.3

### 2.3 theme-bunko（文庫テーマ）が実際に使っている指定

```css
--vs-writing-mode: vertical-rl;
--vs-font-family: '游明朝', 'YuMincho', serif;
--vs-theme--num-of-line: 15;      /* 1ページ 15行 */
--vs-theme--num-of-character: 39; /* 1行 39字 */
--vs--p-hanging-punctuation: first allow-end;  /* 行末句読点ぶら下げ */
--vs--p-text-spacing: space-first allow-end ideograph-alpha ideograph-numeric; /* 和欧文間アキ */
```

`hanging-punctuation` / `text-spacing` は Chromium が未実装 or 部分実装。
**Vivliostyle Core が自前で解釈する**ため、Obsidian 標準の PDF 書き出しでは絶対に出せない品質になる。
これが本プラグインの存在意義そのもの。

### 2.4 CoreViewer の API（`lib/vivliostyle/core-viewer.d.ts` で確認）

```ts
new CoreViewer({ viewportElement, window?, userAgentRootURL?, debug? }, options?)
  .loadDocument(url | {url,startPage,skipPagesBefore} | [...],
                { documentObject?, fragment?, authorStyleSheet?: [{url|text}],
                  userStyleSheet?: [{url|text}] },
                { renderAllPages, pageViewMode, zoom, fitToScreen, defaultPaperSize, pixelRatio })
  .readyState        // 'loading' | 'interactive' | 'complete'
  .addListener(type, cb)
  .getTOC() / .getMetadata() / .getPageSizes() / .getCurrentPageProgression()
  .navigateToPage(...) / .navigateToInternalUrl(...)
```

- `authorStyleSheet: [{ text: css }]` で**テーマ CSS を文字列のまま注入できる**（ファイル配置不要）
- `getTOC()` / `getPageSizes()` は PDF の栞・ページラベル生成にそのまま使える
- リソース（UA スタイルシート等）はバンドル済みなので `userAgentRootURL` は不要

### 2.5 vivliostyle-cli の PDF 生成は「viewer を待って印刷」しているだけ

`src/output/pdf.ts` の実体:

```
page.waitForNetworkIdle()
page.waitForFunction(() => !!window.coreViewer)
page.emulateMediaType('print')
page.waitForFunction(() => window.coreViewer.readyState === 'complete')
page.pdf({ margin: 0, printBackground: true, tagged: true, preferCSSPageSize: true })
→ src/output/pdf-postprocess.ts が pdf-lib で メタデータ / 目次(栞) / ページラベル を後付け
```

**Electron の `webContents.printToPDF` は `preferCSSPageSize` `printBackground`
`generateTaggedPDF` `generateDocumentOutline` `pageRanges` を全てサポート**しており、
CDP の `Page.printToPDF` と同一の実装に乗っている。つまり Playwright なしで等価な出力が得られる。

### 2.6 Obsidian 側の前提（既存プラグインで実証済み）

`l1xnan/obsidian-better-export-pdf`（コミュニティ登録済み・`isDesktopOnly: true`）が実際に行っていること:

- `import * as electron from "electron"` がそのまま通る
- `electron.remote.dialog.showSaveDialog` / `electron.remote.shell.openPath`
- `document.createElement("webview")` + `webview.nodeintegration = true`
- **`await webview.printToPDF(printOptions)` → `Buffer`**
- `pdf-lib` で PDF の栞・アンカーを後処理
- `require("fs").promises` など Node 組み込みモジュール

環境: **Obsidian 1.10.3 = Electron 37.9.0 / Node 22.16**。ES2022 以降・Node 22 API が使える。

### 2.7 競合

Obsidian コミュニティプラグイン 7,153 件を全走査した結果、**Vivliostyle を使うプラグインは存在しない**。
EPUB/PDF 出力系はすべて Pandoc ラッパ（`obsidian-pandoc`, `enhancing-export`, `book-exporter` 等）か
単純な HTML→EPUB で、**CSS 組版・日本語縦組み対応は空白地帯**。

---

## 3. リスクと対策

### 3.1 【最重要】ライセンス: AGPL-3.0

`@vivliostyle/core` と `@vivliostyle/viewer` は **AGPL-3.0**。
これをバンドルした `main.js` を配布する以上、**本プラグイン全体を AGPL-3.0 で公開する必要がある**。

- Obsidian コミュニティプラグインはライセンス自由なので、AGPL でも登録・配布は可能
- 実害はほぼない（プラグインはネットワーク越しにサービス提供しないため AGPL の追加義務が発動しにくい）
- ただし「MIT で出したい」なら**この構成は取れない**。その場合の代替は
  ユーザー環境の `vivliostyle` CLI を `child_process` で呼ぶ薄いラッパ（= AGPL コードを同梱しない）だが、
  ユーザーに Node と CLI のインストールを強いることになり、プレビューの即応性も落ちる

→ **【決定】AGPL-3.0 で公開する。** core / viewer を同梱し、プラグイン全体を AGPL-3.0 とする。
リポジトリ直下に `LICENSE`（AGPL-3.0 全文）と `NOTICE`（VFM = Apache-2.0、テーマ = CC0-1.0 の帰属表示）を置く。

### 3.2 なぜローカル HTTP サーバが必要か

Vivliostyle Core は文書本体・CSS・画像を **fetch/XHR で取得する**。

- `file://` → origin が opaque で fetch が CORS で失敗
- `iframe srcdoc` → origin `null` で同上
- `app://`（Obsidian 独自）→ 独自プロトコルの CORS 挙動が不安定

したがって **`127.0.0.1` の一時 HTTP サーバ（Node の `http` モジュール、ランダムポート）** を立てて、
コンパイル結果と viewer アセットを配る。vivliostyle-cli の `preview` もまったく同じ理由で同じことをしている。

### 3.3 EPUB 出力

CLI の `src/output/epub.ts` は 747 行で `archiver` / `@vivliostyle/jsdom` / `fs-extra` / `w3c-xmlserializer` に依存。
そのままレンダラプロセスには持ち込めない。**JSZip + `DOMParser`/`XMLSerializer` で再実装する**。

必要な生成物: `mimetype`（無圧縮・先頭）、`META-INF/container.xml`、`OEBPS/package.opf`（manifest/spine/metadata）、
`nav.xhtml`（`<nav epub:type="toc">`）、XHTML 化した各章、画像・フォント・CSS。

なお **EPUB は「組版済み PDF」ではなくリフロー型**になる。Vivliostyle のページ組版結果は EPUB には入らず、
テーマ CSS（縦書き・ルビ）を同梱してリーダー側に再組版させる形。ここはユーザーに明示しないと誤解を生む。
→ MVP から外し Phase 2 とするのが妥当。

### 3.4 @vivliostyle/cli を直接使わない理由

- `playwright-core` 経由で **Chromium を別途ダウンロード**する（数百 MB、初回体験が最悪）
- `--executable-browser` で既存 Chrome/Edge を指すことは可能だが、環境依存の不安定要因が増える
- ESM + Node 専用で、esbuild の Obsidian プラグインバンドルに素直に載らない
- 一方 Obsidian 自身が Chromium 37 を内蔵しており、`printToPDF` で同じことができる（2.5）

ただし **`preflight: press-ready`（入稿用 PDF/X 変換、Ghostscript/Docker）や CMYK 変換が必要になったら
CLI を外部コマンドとして呼ぶ経路を残す**（Phase 3・オプトイン）。

### 3.5 その他

| リスク | 対策 |
|---|---|
| `emulateMediaType('print')` 相当がない | **【決定 33】`webview.getWebContentsId()` → `remote.webContents.fromId()` → `debugger.attach()` → `Emulation.setEmulatedMedia` を、文書を読み込む前に行う**（Vivliostyle は組版時にメディアクエリを評価するため、読み込み後では遅い）。アタッチできなければ警告を出して続行する。`@media print` の書き換え注入は代替にならない（消したいのは `@media screen` 側のルールのため） |
| VFM が `refractor@3`（多言語シンタックスハイライト）を引きバンドルが肥大 | 使用言語のみを登録する薄いモジュールに差し替える。**esbuild の `alias` は `refractor/lang/*.js` のような下位パスまで書き換えてしまうため使えない**。`onResolve` で裸の `refractor` だけを捕まえる |
| VFM が `vfile@4` 経由で `path` / `process` を参照 | Obsidian デスクトップでは Node 組み込みが使えるため external 指定で解決 |
| Obsidian のテーマ CSS がプレビューに漏れる | iframe/webview で完全に隔離されるので問題なし |
| 大きな本のライブプレビューが重い | デバウンス（600ms）＋ `renderAllPages: false` ＋章単位の差分再組版 |

---

## 4. アーキテクチャ

```
Vault の .md（1枚 / フォルダ / 目次ノート）
        │
        ▼
 ┌────────────────────────────┐
 │ 1. Obsidian 記法の正規化     │  [[wikilink]] → 相対リンク, ![[embed]] → 実体展開,
 │    （プラグイン独自）          │  ==mark==, > [!note] callout, 独自ルビ/縦中横記法
 └────────────────────────────┘
        ▼
 ┌────────────────────────────┐
 │ 2. @vivliostyle/vfm          │  Markdown → XHTML（ルビ・脚注・セクション化）
 └────────────────────────────┘
        ▼
 ┌────────────────────────────┐
 │ 3. 一時ワークスペース構築      │  {plugin}/.cache/build/
 │                              │  index.html, ch*.html, publication.json,
 │                              │  theme.css, viewer/(prebuilt), assets/
 └────────────────────────────┘
        ▼
 ┌────────────────────────────┐
 │ 4. http://127.0.0.1:<port>   │  Node http。ワークスペースを静的配信
 └────────────────────────────┘
        │
        ├──► ① <iframe>（プレビュー用 ItemView）
        │        CoreViewer.loadDocument() で組版 → 縦書き・ページめくり・TOC
        │
        ├──► ② 非表示 <webview>（PDF 用）
        │        readyState === 'complete' を待つ
        │        → printToPDF({preferCSSPageSize:true, printBackground:true, generateTaggedPDF:true})
        │        → pdf-lib で メタデータ + 栞(getTOC()) + ページラベル を付与
        │        → 保存
        │
        └──► ③ EPUB ビルダ（Phase 2）
                 JSZip で OPF / nav.xhtml / XHTML / assets を梱包
```

---

## 5. 仕様

### 5.1 manifest.json

```json
{
  "id": "vivlio",
  "name": "Vivlio",
  "version": "0.1.0",
  "minAppVersion": "1.8.7",
  "description": "Typeset your notes with Vivliostyle (CSS paged media) and export to PDF / EPUB with a live preview. Japanese vertical writing, ruby and emphasis dots supported.",
  "author": "nonkuri",
  "isDesktopOnly": true
}
```

`description` は英語（コミュニティ登録の慣例）。UI 文言は日英両対応（5.5）。

### 5.2 コマンド / UI

| コマンド | 挙動 |
|---|---|
| `Vivlio: プレビューを開く` | 右ペインに `VivlioPreviewView`（ItemView）を開き、アクティブノートを組版 |
| `Vivlio: PDF に書き出す` | 出力設定モーダル → 保存ダイアログ → PDF |
| `Vivlio: EPUB に書き出す` | 同上（Phase 2） |
| `Vivlio: このフォルダを本として書き出す` | フォルダ内 `.md` をファイル名順で章立て |
| `Vivlio: このノートを目次として本を組む` | ノート内の `[[リンク]]` の並び順を spine とする |
| `Vivlio: 組版結果を再読み込み` | キャッシュ破棄して再ビルド |
| `Vivlio: 本の設定を作成` | ウィザードで `vivlio.yaml` を生成（5.4） |
| `Vivlio: このノートに設定を追加` | 入れるキーを選んでフラットな `vivlio-*` frontmatter を挿入（5.4） |
| `Vivlio: 設定リファレンスを書き出す` | 全キー + 既定値 + コメント付きの `vivlio.yaml` を生成（5.4） |
| `Vivlio: 現在の設定を vivlio.yaml に書き出す` / `… を Vault の既定にする` | 設定タブと `vivlio.yaml` の相互変換（5.4） |

- リボンアイコン 1 個（プレビュー開閉）
- ファイルエクスプローラのフォルダ右クリック / ノート右クリックにメニュー追加
- ページ送り・見開き・ズーム・目次は同梱した `@vivliostyle/viewer` の UI に任せる。
  ItemView 側のツールバーは Obsidian 固有の操作（再ビルド・テーマ選択・PDF / EPUB 書き出し・脚注モード未指定の警告）のみ

#### 章の並び順の決定規則

1. 対象フォルダに **目次ノート**（`index.md` / フォルダと同名のノート / frontmatter に `vivlio.toc: true`）があれば、
   その本文中に現れる `[[リンク]]` の**登場順**を spine とする
2. 無ければ**ファイル名の自然順**（`2.md` < `10.md` となるよう数値部分を数値として比較）
3. どちらの場合も、`vivlio.order` が書かれたノートはその数値を優先キーとして使う（部分的な差し込み用）
4. 目次ノート自身は既定で spine に含めない（`vivlio.includeToc: true` で含める）

### 5.3 Obsidian 記法の前処理（VFM に渡す前）

#### 実装方式【決定】: 文字列置換をせず、すべて VFM の拡張フックに寄せる

VFM は 2 つの公式フックを持つ（`docs/ja/hooks.md`）。**独自の前処理パイプラインを自作せず、これに載せる。**

| フック | 何ができるか | 本プラグインでの用途 |
|---|---|---|
| `replace: [{ test: RegExp, match: (m, h) => hast }]` | **テキストノードに対してのみ**正規表現置換し、任意の HAST を返す | 傍点 / ルビ / 縦中横 / ハイライト |
| `editPlugins(plugins)` | VFM が組み立てる unified プラグイン配列（`mdastPlugins` / `mdastToHastHandlers` / `hastPlugins`）に自作プラグインを挿す | Obsidian 固有のリンク・埋め込み解決、callout、タスクリスト、タグ除去、パス書き換え |

これが重要な理由:

- **テキストノードだけを対象にするため、URL・HTML 属性の中は最初から対象外になる。**
  自前の文字列正規表現置換で起きるはずだった事故が**構造的に発生しない**
- 処理順はルール配列の順で決まるので、傍点 `《《…》》` をルビ `｜…《…》` より前に置くだけで衝突が解ける
- VFM のバージョンアップに追従しやすい（`editPlugins` は「先頭への追加」と「末尾への追加」のみ挙動が安定、と VFM 側が明記しているのでその 2 箇所しか使わない）
- オプションは valibot スキーマ（`StringifyMarkdownOptionsSchema` 等）として export されているので、
  frontmatter のバリデーションをそのまま流用できる

##### 【実装時の修正】`replace` オプションは使わず、同等のパスを自前で持つ

**当初の想定は誤りだった。** VFM の `replace` は `hast-util-find-and-replace` に丸投げしており、
その既定 ignore は `['title', 'script', 'style', 'svg', 'math']` で、**`code` / `pre` を含まない**
（`node_modules/@vivliostyle/vfm/lib/plugins/replace.js` および `hast-util-find-and-replace/index.js` で確認）。
`replace` にルールを渡すと、自動縦中横がコードブロック内の 2 桁数字を `<span class="tcy">` で包んでしまう。

したがって **`replace` オプションは使わず、同じ「テキストノードだけを置換する」処理を
`editPlugins` の末尾に足す rehype プラグインとして持つ**（`src/util/tree.ts` の `replaceTextNodes`）。
ignore は上記に `code` `pre` `kbd` `samp` `var` `textarea` `head` `rt` `rp` を加えた集合とする。

- 「文字列置換をせず、VFM のフックに載せる」という決定 25 の方針自体は変わらない
- ルールは 1 ルール 1 パスで配列順に適用するので、傍点→ルビの順序保証も変わらない
- コードブロックが無傷であることは `test/convert.test.ts` の "code block untouched" で検証する

例外は 1 つだけ。**`![[Note]]` によるノート埋め込みは他ファイルを読んで mdast を差し込む**必要があるため、
`mdastPlugins` の先頭に置く非同期 remark プラグインとして実装する（unified の transformer は Promise を返せる）。

#### 適用順

**処理順が重要。** `《》` を使う記法が複数あり、`|` は Obsidian のエイリアスと VFM ルビで衝突するため、
下表の順に適用する。各段は設定で個別に ON/OFF できる。
「層」列は上記のどのフックで実装するかを示す
（M = mdastPlugins の先頭、R = テキスト置換パス、H = hastPlugins の末尾）。

**【実装時の修正】実行順は `M → H → R` であり、下表の番号順ではない。**
番号順（R が H より先）に実行すると、**自動縦中横（#6）が `[[02]]` の中の 2 桁数字を
`<span class="tcy">` で包んでしまい、ウィキリンク（#9）が壊れる**（実装時にテストで再現）。
リンク・画像の記法（#8〜#12）を先に消費し、文字装飾（#3〜#7, #13〜#15, #17）はその後に適用する。
こうするとリンクの表示名の中でもルビや傍点が効くという副次的な利点もある。
表の番号は「同じ層の中での適用順」を示すものと読むこと。

**H 層の中にも順序がある。**

- **#18（連続する空行）は H 層の先頭**。数える材料はパーサが記録した行番号で、
  callout（#10）はノードを**差し替える**ので、後に回すと差し替え後のノードから数えられない
- **#16（字下げ）は 2 段に分かれ、前半が #15 の前、後半が R 層の後**。
  原稿が字下げに使った全角スペースは #15 が消す前に読む必要があり、
  始め括弧の判定は `《《傍点》》`（#3）が畳まれた後でなければ当てにならない

| # | 層 | 入力 | 変換 | 既定 |
|---|---|---|---|---|
| 1 | M | `![[Note]]` / `![[Note#見出し]]` | ノート本文の mdast をその場に差し込む（再帰は深さ 3 まで、循環検出あり）。**非同期 transformer** | ON |
| 2 | M | ` ```dataview ` / ` ```dataviewjs ` / ` ```mermaid ` 等 | `MarkdownRenderer.render()` で描画し、生成 DOM を raw HTML ノードとして差し込む → 5.8(8)。**非同期 transformer** | ON |
| 3 | R | **`《《テキスト》》`（カクヨム式傍点）** | 一字ごとにゴマ点を振った `<ruby class="boten">`（下記）。**ルビより前に置く**（`《《` が `《` にマッチして壊れるため） | ON |
| 4 | R | **`漢字《かんじ》`（親文字省略形）** / `｜漢字《かんじ》` / `\|漢字《かんじ》`（青空文庫・カクヨム式ルビ） | `<ruby>漢字<rt>かんじ</rt></ruby>`。下記 | ON |
| 5 | R | `^^10^^`（独自・縦中横） | `<span class="tcy">10</span>` | ON |
| 6 | R | 1〜2 桁の半角数字（縦組み時のみ） | 自動で `<span class="tcy">` を付与 | ON（設定で OFF） |

**【実装時の修正】1 桁も対象にする。** 2 桁だけを拾っていたので、`3 歳` の `3` は
`text-orientation: mixed` のまま横倒しになっていた。縦組みの地の文で数字が寝るのは誤りで
（JIS X 4051 は 1 桁の数字を正立させる）、`text-combine-upright` は 1 文字の連なりに対しても
「1 em に 1 文字を正立させる」として正しく働く。3 桁以上は対象外のまま —— 1 em に収まらないし、
正立させたい原稿は漢数字で書く。

| 7 | R | `==ハイライト==` | **4 モードから選択（既定: 傍点）** → 下記 | 傍点 |
| 8 | H | `![[image.png]]` / `![[image.png\|300]]` | → 5.8 | ON |
| 9 | H | `[[Note]]` / `[[Note\|表示名]]` | 本に含まれる → `<a href="ch03.html#...">`／**含まれない → プレーンテキスト化**（表示名があればそれ、なければノート名） | ON |
| 10 | H | `> [!note] タイトル`（callout） | `<aside class="callout callout-note"><p class="callout-title">…</p>…</aside>` + テーマ CSS | ON |
| 11 | H | `- [ ]` / `- [x]`（チェックボックス） | `<ul class="task-list"><li class="task-list-item" data-checked="false">`。CSS で `☐` / `☑` を出す（`list-style: none` だとマーカーボックスが生成されず `::marker` が効かないため、実装では `::before` を使う）。`<input type="checkbox">` は除去し、PDF にフォーム部品を残さない | ON |
| 12 | H | `#タグ` | 削除（設定で `<span class="tag">` 保持） | 削除 |
| 13 | R | `%%コメント%%` | 削除 | 削除 |
| 14 | R | `^ブロックID` | 削除 | 削除 |
| 15 | R | **行頭の全角スペース**（原稿が字下げに使ったもの） | 削除する。字下げは #16 と CSS が行う（下記） | ON |
| 16 | H | **字下げしない段落**（原稿が全角スペースを置かなかった段落、または始め括弧で始まる段落） | `<p class="vivlio-no-indent">` を付け、CSS で `text-indent: 0` にする → 下記 | ON |
| 17 | R | **強制改ページ**。`［＃改ページ］`（青空文庫式）と `===`（でんでんマークダウン式・イコール 3 つ以上だけの行） | 記号を消し、**次のブロックに `.vivlio-page-break` を付ける**（下記） | ON |
| 18 | H | **連続する空行** | 3 行で 1 行アキ。次のブロックに `.vivlio-blank-lines` と空ける行数を付ける（下記） | ON |
| 19 | — | frontmatter | Vivlio 用キー（5.4）を抜き、残りを VFM の `vfm:` に委譲 | — |

VFM 標準のルビ `{漢字|かんじ}` は VFM 自身が処理するので、本プラグインは何もしない（#4 は別記法の追加分）。

#### ルビは `｜` 無しの形も拾う（#4）

青空文庫もカクヨムも、ルビの書き方を 2 つ持つ:

| 形 | 親文字 |
|---|---|
| **`漢字《かんじ》`** | 直前の**漢字の連なり**。原稿はほぼこちらで書かれる |
| `｜任意《よみ》` | `｜` が始まりを示すので、親文字は何でもよい |

`｜` 有りだけを拾っていたので、**原稿の大半のルビが素通りしていた。**

漢字の範囲には `々〆〇ヵヶ` を含める。`人々` や `一ヶ月` は読み手にとって漢字の連なりであり、
Unicode がそれらを別の分類に置いていることは関係がない。
**かなは親文字にしない** —— かなにかなのルビを振りたい人はいないし、
そういうときのために `｜` がある。

`《《傍点》》`（#3）はこれより**先**に消費されるので、`本文《《強調》》` が
「本文」にルビを振ってしまうことはない。

#### 連続する空行は紙面の空きになる（#18）

Markdown は空行を捨てる —— 1 行で段落が切れ、それ以上は構文上の意味を持たない。
だが小説は空行に意味を持たせる（場面の切り替わりを空行で書く）ので、**拾い直して紙面の空きにする。**

**1 行目は段落の区切り、2 行目は遊び。3 行目からが紙面の 1 行アキ**になる。
原稿の 3 行が本の 1 行 —— 空行を置く書き手が求めているのはこれである。
（`n` 行の空行 → `n - 2` 行アキ。2 行目を遊びにしてあるのは、うっかり 1 行多く空けた原稿を
そのまま組んでしまわないため。）

数え方は**パーサが記録した行番号**から取る。原稿の文字列を触らない（決定 25）ので、
隣り合うブロックの `position` の差がそのまま空行の数になる。

空きは**マージンで与える。空要素を挟んではいけない**（#17 と同じ理由: 高さ 0 のブロックは
ページを消費せず、組版が終わらない）。マージンならページの先頭では落ちるので、
ページをまたいだときの振る舞いも正しい。

**この段は他の変換より先に走らせる。** callout は `<blockquote>` を `<aside>` に**差し替える**ので、
後に回すと差し替え後のノードには `position` が無く、数えられない。

#### 強制改ページ（#17）

行に `［＃改ページ］` とだけ書くと、そこでページが変わる。青空文庫の注記と同じ書き方にしたのは、
ルビと傍点で既に青空文庫・カクヨム式に対応しているため。
CSS を直接書きたい人は `<div class="vivlio-page-break">…</div>` でもよい。

**でんでんマークダウン式の `===` も同じ意味に読む【決定】。** イコール記号 3 つ以上だけの行で、
電子書籍を書く側では青空文庫式より通りがよい。**ただし前に空行が要る** —— 段落の直下に置いた
イコールの行は Markdown 本来の setext 見出しの下線であり、そこへ到達する前に見出しとして
食べられてしまう（でんでんマークダウン自身も前後の空行を求めている）。
判定はテキスト規則として書き、`<code>` / `<pre>` を飛ばす既存の仕組みに乗せる ——
コードブロックに書いた `===` は本文の一部であって、改ページの指示ではない。

**【実装時の修正】改ページ用の空要素を置いてはいけない。**
記号の位置に高さ 0 のブロックを置いて `break-before: page` を当てると、
**そのブロックはページを消費せずに何度でも置けるため、Vivliostyle の組版が終わらない**
（実測: 記号のあるページで停止する）。記号は削除し、**直後のブロックにクラスを付けて**
そちらに改ページを持たせる。後ろに何もない記号は捨てる —— 次のドキュメントはどのみち改ページで始まる。

EPUB 用に `page-break-before: always`（旧綴り）も併記する。まだそれしか解さないリーダーが多い。

#### 字下げは原稿の言うとおりにする（#16）

日本語の段落は 1 字下げるが、`「` で始まる行は下げない。**始め括弧類は文字の右半分に描かれ、
左半分の空きがそのまま字下げに見える**ため、さらに 1 字下げると 1 字半下がってしまう。

ただし **どの段落を下げるかは、たいてい原稿がすでに答えている** ——
下げる段落だけ全角スペースで始めてある。**その答えを使う。**
括弧を見て決める規則は、原稿が何も言っていないときのためのものである。

| 原稿 | 扱い |
|---|---|
| 全角スペースで始まる段落が **1 つでもある** | その原稿は自分で字下げを決めている。スペースのあった段落だけ `text-indent` を効かせ、**なかった段落は `vivlio-no-indent` にする** |
| 全角スペースが **1 つもない** | 字下げは組版に任されている。全段落に `text-indent` を効かせ、**始め括弧類（`「『（〈《【〔［｛〖〘〚｟〝“‘`）で始まる段落だけ**外す |

半角スペースは判定に使わない。行頭の半角スペースは決定より打ち間違いのことが多く、
それを決定と読むとノート内の他の段落から字下げが全部消える。

**書き手が直接指定することもできる。** `paragraphIndentMode`（3 層すべてから指定可、設定タブにも項目を置く）:

| 値 | 字下げする段落 |
|---|---|
| **`auto`（既定）** | 上の表のとおり。原稿が答えていればそれに従い、答えていなければ始め括弧の規則 |
| `manuscript` | 原稿が全角スペースを置いた段落だけ（原稿が一度も置いていなければ、どの段落も下げない） |
| `brackets` | 始め括弧で始まる段落以外すべて（原稿のスペースは見ない） |
| `all` | すべての段落 |

「まったく下げない」は `paragraphIndent: 0`（字下げ幅そのもの）で表す。モードには置かない —— 
幅とモードで同じことが二通りに書けるようにはしない。

**2 パスに分ける。** スペースは `stripLeadingSpace`（#15）が消す**前**に読む必要があり、
括弧は記法変換の**後**に見る必要がある（`《《傍点》》` で始まる段落は、傍点が畳まれるまで
「始め括弧で始まる段落」に見えてしまう）。前半のパスは印を属性で残し、後半のパスが決めて消す。

#### `==ハイライト==` の 4 モード

Obsidian のハイライトは「電子の蛍光ペン」で、紙面にそのまま黄色の地を出すと本として成立しない。
用途が人によって割れるため設定で選ばせる。

| モード | 出力 | 用途 |
|---|---|---|
| **`boten`（既定）** | `<ruby class="boten">` = 傍点（下記） | 小説・文芸。日本語の紙面で「強調」を表す最も自然な形 |
| `strong` | `<strong>` = 太字 | 実用書・技術書 |
| `mark` | `<mark>` のまま | 参考書・問題集など、地色を意図して使う場合 |
| `off` | 記号を外して地の文に | 読書メモの `==` を本文に持ち込みたくない場合 |

`boten` と #3 のカクヨム式傍点は**同じ `.boten` に合流する**ので、テーマ側の指定は 1 箇所で済む。

#### 傍点は `text-emphasis` ではなくルビで書く【決定】

`text-emphasis: filled sesame` は現代的な綴りだが、**圏点を文字の外側に描くので行ボックスが伸び、
傍点のある行だけ隣の行より広く組まれて縦のグリッドが崩れる。**
ルビはどの行でも同じ帯を確保するため、一字ごとにゴマ点（`﹅`）を振ったルビとして書く ——
原稿が傍点をルビで書いてきたのと同じ理屈である。

```html
<ruby class="boten">そ<rp>(</rp><rt>﹅</rt><rp>)</rp>の<rp>(</rp><rt>﹅</rt><rp>)</rp></ruby>
```

- 傍点はルビより一段小さい（`--vs-novel--boten-font-size`、既定 0.35rem）。ルビは読み、傍点は印であり、
  同じ大きさで組むと本文の脇にもう一行あるように見える
- **`ruby` と `rt` の `line-height` は `1` に固定する**（5.10 の縦組み特有の考慮）。
  さもないとルビ自身が行送りを広げ、`text-emphasis` を避けた意味がなくなる

```css
.tcy { text-combine-upright: all; }
```

### 5.4 設定の置き場所

#### 前提: Obsidian の Properties UI は入れ子 YAML を編集できない

**Obsidian のプロパティ編集 UI はネストした YAML をサポートしていない。**
`vivlio:` の下にキーを並べる設計だと、プロパティパネルには
`{"theme":"bunko","size":"文庫"}` のような JSON 文字列が表示されるだけで、
**ソースモードで生の YAML を手書きするしか編集手段がなくなる。**

設定項目が 40 近くあるので、これを全部 frontmatter の入れ子で持たせるのは Obsidian と相性が悪い。
**設定の置き場所を 3 層に分け、frontmatter に置くものはフラットなキーだけに限定する。**

#### 3 層【決定】

| 層 | 置き場所 | 適用範囲 | 入れ子 | 用途 |
|---|---|---|---|---|
| 1 | **設定タブ** | Vault 全体の既定 | — | テーマ・フォント・出力先など、毎回同じもの |
| 2 | **`vivlio.yaml`** | その本 | **可** | **本ごとの設定の正式な置き場。** 前付け・埋め込みフォントなど入れ子が要るものは全部ここ |
| 3 | **ノートの frontmatter** | その章 / そのノート | **不可（フラットのみ）** | 単一ノートの書き出しと、章単位の小さな上書き |

下位の層が上位を上書きする（1 < 2 < 3）。

#### 層 2: `vivlio.yaml`（本ごとの設定）

本のフォルダ直下に置く。**YAML ファイルなので入れ子もコメントも自由に書け、Properties UI の制約と無関係。**
フォルダ本ではこれを正式な設定ファイルとする（無ければ目次ノートの frontmatter、それも無ければ設定タブの既定）。

```yaml
# 本の情報
title: 吾輩は猫である
subtitle: 全一巻
series: 名作文庫          # あれば。扉と奥付に出る
author: 夏目漱石
translator: ""            # あれば
publisher: 個人出版
printer: ""               # あれば。以下 4 つは奥付にだけ出る
contact: ""
website: ""
date: 2026-09-01
version: 初版
lang: ja
colophonExtra:            # 奥付に足す任意の項目 → 5.11
  装丁: 山田花子

# 組版
theme: novel              # novel | novel-2col | manual | <vault内のcssパス>（bunko / techbook / academic / base も解決はする）
writingMode: vertical-rl  # vertical-rl | horizontal-tb
size: 文庫                # 文庫（=A6）| 新書 | JIS-B6 | 四六判 | A5 | JIS-B5 | B5 | A4 | letter | "128mm 188mm"
charsPerLine: 40          # 1段の字詰め。省略するとテーマの既定グリッド → 5.10
linesPerPage: 16          # 1段の行数
columns: null             # 段数。空はテーマ任せ（novel-2col は 2）→ 5.10
baseFontSize: ""          # 空なら用紙と字詰めから算出
paragraphIndent: ""       # 字下げの幅。空ならテーマ任せ
paragraphIndentMode: auto # auto | manuscript | brackets | all → 5.3 #16
footnote: gcpm            # gcpm（ページ下）| pandoc（章末）| dpub
highlight: boten          # boten | strong | mark | off
autoTcy: true
imageWidthUnit: px

# 表紙 → 5.9
cover: 装丁/表紙.png
coverFit: cover
coverInPdf: true

# フォント → 5.10
fontFamily: "游明朝, YuMincho, 'Hiragino Mincho ProN', 'Noto Serif JP', serif"
headingFontFamily: "游ゴシック Medium, YuGothic, sans-serif"
monospaceFontFamily: "Consolas, 'BIZ UDGothic', monospace"
embedFonts:
  - family: 源ノ明朝
    src: 装丁/fonts/SourceHanSerifJP-Regular.otf
    weight: 400

# 前付け・後付け → 5.11
sections:
  titlePage: auto         # auto | <ノートパス> | off
  toc: auto
  preface: まえがき.md
  afterword: あとがき.md
  colophon: auto
pageNumbering: roman-then-arabic
tocDepth: 2

# 出力
output: 原稿/出力/猫.pdf
cropMarks: false
bleed: 3mm

css: |                    # 追加 CSS（テーマの後に注入）
  h1 { letter-spacing: .2em }
```

#### 層 3: frontmatter（フラットキーのみ）

**`vivlio-` 接頭辞を付けたフラットなキーだけを使う。** すべて文字列 / 数値 / 真偽値なので、
**Obsidian のプロパティパネルにそのまま並び、GUI で編集できる。**

```yaml
---
title: 第一章 猫である
vivlio-subtitle: 全一巻
vivlio-author: 夏目漱石
vivlio-theme: novel
vivlio-size: 文庫
vivlio-chars-per-line: 40
vivlio-lines-per-page: 16
vivlio-footnote: gcpm
vivlio-cover: 装丁/表紙.png
vivlio-output: 原稿/出力/猫.pdf
vivlio-start-page: 1
---
```

- 対応するのは**入れ子が不要なキーのみ**。`sections` / `embedFonts` / `css` / `colophonExtra` は
  `vivlio.yaml` 専用（`colophonExtra` は手書きの `vivlio-colophon-extra:` なら frontmatter でも読める）
- **素のキー名は読まない。** `subtitle:` とだけ書いても拾わないので `vivlio-subtitle:` と書く。
  例外は `title:` だけで、これは Obsidian のノート名と兼ねるため
- キー名は `vivlio.yaml` のキャメルケースをケバブケースにしたもの（`writingMode` → `vivlio-writing-mode`）
- 単一ノートの書き出しでは、これと設定タブの既定だけで完結する
- **入れ子の `vivlio:` 形式も読み込みは受け付ける**（手書き派のため）が、自動生成では使わない
- 未知のキーは触らず VFM にそのまま委譲する

#### 設定テンプレートの自動生成【決定】

設定項目が多いので、**手書きさせない。** 3 つの入口を用意する。

**(1) ウィザード — `Vivlio: 本の設定を作成`**

モーダルで対話的に作り、`vivlio.yaml` を書き出す。

| ステップ | 内容 |
|---|---|
| 1. プリセット | 縦組みの 5 つ（文庫 39x15 / 文庫 40x16 / B6 43x17 / 四六判 44x17 / A5 45x18）／マニュアル・技術書（A5 横組み）／カスタム（論文はテーマともども保留 → 12「未実装」） |
| 2. 書誌情報 | 書名・副題・シリーズ・著者・訳者・発行所・**印刷所**・連絡先・WEB・発行日・版・言語（書名はフォルダ名、発行日は当日で埋める） |
| 3. 造本 | テーマ・判型・書字方向・行あたりの文字数・ページあたりの行数・基準文字サイズ・字下げ・脚注・ハイライト・縦中横・画像幅の単位 |
| 4. 前付け・後付け | 各部位のドロップダウン＋ノンブル・目次の深さ（5.11） |
| 5. 表紙 | Vault 内の画像／表紙にするノート／合わせ方／PDF に含めるか |
| 6. フォント | `queryLocalFonts()` のドロップダウン（5.10）＋ノンブル・縦中横・OpenType 機能・ルビ寸法 |
| 7. 出力 | 書き出し先・トンボ・塗り足し |

**全キーを書き出すが、「既定値を使う」を選んだキーはコメント行として書く。**
書き手に見えない設定項目は使われないので、`vivlio.yaml` が持てるキーはすべてウィザードに出す。
一方、全キーを**値として**書き出すと、プラグインの既定が変わっても追従しなくなり、差分も
読めなくなる。コメント行はその両方を満たす —— ファイルはそれ自体がリファレンスになり、
`#` を消せばその項目だけこの本のものになる。

| 決定 | 理由 |
|---|---|
| **どの行にもキーの説明を添える**（`KEY_DOCS` から） | ウィザードの各行の説明文と生成 YAML のコメントを同じ一文から引く。片方だけ古くなることがない |
| **部位（`sections`）は「新しいノートを作る」を選べる** | 中身になるノートが要る部位は、ノートを書く前の書き手にはドロップダウンが空に見える。ウィザードが見出しだけのノートを作って、そこを指す |
| **`sections:` のキー自体は常に値行として書く** | 全スロットがコメントでも `sections:` は残す。スロット行の `#` を外すだけで部位が足せる。空の `sections:` は「誰も埋めていないキー」で、`applyLayer` が飛ばす |
| **部位に指定したノートは本文から外す** | 部位のノートは本の中に一度だけ置かれる。本のフォルダに置いた「まえがき」を本文の一章としても組んでしまえば、同じ文章が二度出る |

**(2) プロパティの選択挿入 — `Vivlio: このノートに設定を追加`**

カーソル位置のノートに**フラットな `vivlio-*` frontmatter** を挿入する。
**どのキーを入れるかはモーダルで選ぶ。**

固定の一覧を挿し込む方式（「最小」「標準」の 2 択）は、どちらの側にも外れる。
8 つ目が要るノートはリファレンスファイルを見に行くしかなく、7 つのうち 2 つで足りるノートは
使わないプロパティを 5 つ抱える —— **プロパティパネルは付いている限りそれを並べ続ける**ので、
これは書き手が毎回目にするノイズになる。正しい一覧はノートごとに違う、というのが答えである。

| 決定 | 理由 |
|---|---|
| **一覧は `KEY_DOCS` から作る**（グループ・説明文ごと） | リファレンス生成（下記 (3)）と同じ表。キーを足したときに片方だけ古くなることがない |
| **入れ子の要るキー（`sections` / `colophonExtra` / `embedFonts` / `vfm`）は出さない** | Obsidian のプロパティエディタは入れ子 YAML を編集できない。出せば、ノート自身のプロパティパネルが設定を壊せてしまう |
| **既にあるキーはチェック済み・操作不可で見せる** | このコマンドは「足す」もの。ノートが持っている値を黙って書き換えるのは別の、ずっと不作法なコマンドである |
| **選んだキーは値が空でも書く** | 空のプロパティは「これから埋める行」であって、それを出すことこそ依頼の内容。逆に、誰も選んでいない既定の一覧から空を書く理由はない |
| **空の値は下の層を上書きしない**（`applyLayer` は `null` を飛ばす） | 空の `vivlio-theme:` は「ここでは決めない」であって「テーマ無し」ではない |
| 初期チェックは `STANDARD_KEYS` | 何も無いノートで開いたとき、いちばん多い答えから始める |

**(3) 全キー版の書き出し — `Vivlio: 設定リファレンスを書き出す`**

**全キーを既定値とコメント付き**で並べた `vivlio.yaml` を生成する。
`vivlio.yaml` はコメントを書けるので、**これ自体がリファレンスとして機能する**（ドキュメントを探しに行かなくて済む）。

#### 逆方向と検証

- `Vivlio: 現在の設定を vivlio.yaml に書き出す` — 設定タブの現在値をその本に固定する
- `Vivlio: この vivlio.yaml を Vault の既定にする` — 逆に設定タブへ取り込む
- **検証**: VFM が valibot スキーマ（`StringifyMarkdownOptionsSchema` 等）を export しているので、
  `vfm:` 部分はそれをそのまま流用。Vivlio 独自キーも valibot スキーマとして定義し、
  **未知キー・型不正・`auto` にできない部位への `auto` 指定**を書き出し前チェックで警告する
- プレビュー中に `vivlio.yaml` を編集したら再ビルドする（監視対象に含める）

#### 既定値についての決定事項

| キー | 決定 |
|---|---|
| `theme` | **`novel`（縦組み・文庫判）**。指定がなければ縦組みで組む。ノート内容による自動判定はしない（挙動が読めなくなるため）。同梱の `bunko` / `techbook` / `academic` / `base` は名前としては解決するが、設定タブのテーマ選択には出さない（下記） |
| `footnote` | **設定タブに既定値を置く（工場出荷値 `gcpm` = ページ下の脚注）。** 上位層の指定があればそれを優先 |
| `output` | **指定があれば最優先。** なければ設定タブの「Vault 内の固定出力フォルダ」（既定 `_output/`）に `<本のタイトル>.pdf` で書き出す。Vault 相対 / 絶対パスの両方を受ける |
| `highlight` | **`boten`** |
| `imageWidthUnit` | **`px`**（Obsidian の編集画面と見た目が一致する） |
| `baseFontSize` | **空（用紙と字詰めから算出）。** `theme-bunko` は版面を「字詰め × 1em」×「行数 × 行送り」で作り `margin: auto` で用紙の中央に置く。既定の 16px では 39字×15行の版面が文庫判より大きくなり、**余白が全て 0 になって柱が本文に重なる**。テーマは print メディアで 83.33% に縮めて凌いでいるが、それでも足りず、プレビューと PDF で結果も変わる。用紙から逆算すれば必ず収まり、メディアにも依存しない |
| `paragraphIndent` | **空（テーマ任せ）。** 字下げの**幅**だけを決める。まったく下げないなら `0` |
| `paragraphIndentMode` | **`auto`。** どの段落を下げるかを決める（5.3 #16）。原稿が全角スペースで字下げしていればそれに従い、していなければ始め括弧の段落だけ外す。`manuscript` / `brackets` / `all` で直接指定もできる |

### 5.5 設定タブ

- **既定のプリセット**: 新規に本の設定を作るときの初期値（文庫本 / Web 小説の書籍化 / カスタム）
- **組版**: 既定テーマ（選べる同梱テーマと Vault 内の .css、初期値 `novel`）／既定用紙サイズ／既定書字方向／**既定の脚注モード（初期値 `gcpm` = ページ下）**／**字下げの幅と、字下げする段落の決め方（初期値 `auto` = 原稿に従う）**／追加 CSS のパス（Vault 内）
- **フォント**: 本文／見出し／等幅を**インストール済みフォントのドロップダウンから選択**（初期値は 5.10 の OS 横断スタック）。Vault 内フォントフォルダのパス（`@font-face` を自動生成、初期値 `.obsidian/fonts`）。**指定フォントが見つからない場合に警告する ON/OFF**（初期値 ON）。EPUB にフォントを埋め込む ON/OFF（初期値 OFF、ライセンス注意書き付き）
- **出力先**: Vault 内の固定フォルダ（初期値 `_output/`）。frontmatter の `output` が優先（5.4）。書き出し後に開く ON/OFF。
  **`.yaml` / `.css` / `.epub` をファイルエクスプローラーに表示する ON/OFF（初期値 ON）** → 下記
- **記法**: 5.3 の各段のトグル。`==ハイライト==` の 4 モード選択（トグルの直下に置く）、`dataviewjs / templater` の実行可否（`dynamic` トグルの直下）。`autoTcy` の ON/OFF。行頭全角スペースの削除（#15）だけは字下げ設定の直下、「組版」に置く
- **造本**: 前付け・後付けの各部位の既定モード（`auto` / `off`）、既定の `pageNumbering`、`tocDepth`（初期値 2）。
  `auto` にできない部位（献辞・題辞・まえがき・あとがき・付録・参考文献・謝辞）はトグルを出さず、
  「`vivlio.yaml` の `sections:` にノートを指定すれば入る」と書く。中身になるノートが要る部位なので、
  設定タブだけでは決められない。**`vivlio.yaml` が何であるかは見出しの直下に一度だけ書く** ——
  7 つの部位それぞれに書けば節が説明文で埋まるし、この語を初めて見る人はどの部位を読んでも同じことを
  知りたがる。「原稿と同じフォルダに置く、本ごとの設定ファイル。コマンド『本の設定を作成』が書き出す」
  と、置き場所と作り方まで書く（ファイル名だけでは探せない）
- **プレビュー**: **自動更新 ON（初期値）／OFF**、デバウンス ms（初期値 600）、全ページ描画 ON/OFF
- **PDF**: タグ付き PDF・栞生成・メタデータ埋め込み・**画像の実効 dpi 警告の閾値**（初期値 300、0 で無効）・表紙を PDF に含める ON/OFF（初期値 ON）
- **言語**: 日本語 / English / Obsidian の設定に従う（初期値）
- **詳細**: ポート番号固定、ログレベル

**選択肢は値の名前ではなく、その値が何をするかで書く。** `gcpm` / `roman-then-arabic` / `boten` は
実装の語彙であって、設定を読む人の語彙ではない。ドロップダウンには「呼び出したページの地に出す（gcpm）」
「前付けはローマ数字、本文の一章目から算用数字で 1 に戻す」「傍点（文字の脇に点を打つ）」のように、
結果を書いて識別子は括弧に落とす。同じ理由で、意味が隣の項目との関係でしか決まらない設定
（`==ハイライト==` の 4 モード、`dataviewjs` の実行可否、行頭全角スペースの削除）は、
セクションを分けずに関係する項目の直下に置く。

**実装のない設定項目は置かない。** 入力しても何も起きない欄は、機能があるという誤解そのものになる。

#### プラグインが書くファイルを、書き手に見せる

**`.yaml` / `.css` / `.epub` の拡張子を `registerExtensions()` で引き受ける（初期値 ON）。**

Obsidian のファイルエクスプローラーは、**どこかのビューが引き受けた拡張子しか一覧に出さない**
（`.md` / `.canvas` / 画像 / 音声 / 動画 / `.pdf`）。「すべてのファイル拡張子を検出」をオンにすれば
出るが、既定はオフで、ほとんどの Vault はそのままである。つまりウィザードが `vivlio.yaml` を
書いた瞬間から、書き手には**見えず・クリックできず・存在を信じる理由もない**設定ファイルが
できていた。本ごとの設定が第 2 層の中心（5.4）である以上、これは説明文の不足ではなく導線の欠落。

引き受けるとサイドバーに出る。出たあとクリックして何が起きるかは、こちらで用意する:

| 拡張子 | ビュー | 中身 |
|---|---|---|
| `.yaml` / `.yml` / `.css` | `vivlio-text` | `TextFileView` + textarea の簡易エディタ。`requestSave()` に載せる |
| `.epub` | `vivlio-binary` | ファイル名とサイズ、「外部アプリで開く」「フォルダを開く」 |

- **CodeMirror ではなく textarea。** Obsidian のエディタは Markdown のためのもので、ここで要るのは
  「Vault を出ずにインデントを直せる場所」である。それ以上は本物のテキストエディタの仕事で、
  同じ画面のボタンがそれを開く
- **`.epub` は読めないと書く。** Obsidian に EPUB を読む力はない。黙って空の画面を出すより、
  リーダーアプリに渡すボタンを出す
- **引き受けは 1 拡張子ずつ try で囲む。** 他のプラグインが既に持っていれば Obsidian は 2 度目を拒む。
  `css` をテーマエディタに取られたことは、`yaml` まで諦める理由にならない
- **ビューの登録自体は設定に関係なく常に行う。** ワークスペースに保存されたリーフは、再起動後に
  自分のビュー型を見つけられなければならない。オプションなのは拡張子の引き受けの方だけ
- **ウィザードは書き出した `vivlio.yaml` をその場で開く**（引き受けが ON のときだけ）。
  ファイルが実在し、言ったとおりの場所にあることの、いちばん短い証明になる

#### i18n

Obsidian は公式の i18n API を提供しないため、`src/i18n/{ja,en}.ts` に文言辞書を置き、
`moment.locale()` もしくは `window.localStorage.getItem('language')` でロケールを判定する自前実装とする
（`better-export-pdf` など既存プラグインと同じ方式）。フォールバックは英語。

### 5.6 主要モジュール構成

実装後の構成（当初案から増えた分に「＋」を付す）。

```
src/
  main.ts                   プラグイン本体・コマンド登録・サーバの参照カウント
  config/types.ts         ＋ 設定の型（3 層で共有）
  config/defaults.ts      ＋ 既定値・OS 横断フォントスタック・判型表
  config/resolve.ts         3 層（設定タブ / vivlio.yaml / frontmatter）のマージ（5.4）
  config/schema.ts          valibot スキーマと検証
  config/presets.ts         文庫本 / Web小説 のプリセット
  config/yaml.ts          ＋ vivlio.yaml の生成（ウィザード出力 / 全キーリファレンス / 相互変換）
  view/PreviewView.ts       ItemView + iframe + ビューア
  view/ExportModal.ts       出力設定モーダル + 書き出し前チェックの提示
  view/SetupWizard.ts       vivlio.yaml 生成ウィザード（5.4）
  view/FrontmatterModal.ts  ノートに足す vivlio-* プロパティの選択（5.4）
  view/FileViews.ts         .yaml / .css / .epub のビューと拡張子の引き受け（5.5）
  view/SettingsTab.ts     ＋ 設定タブ（当初案の settings.ts に相当）
  build/context.ts        ＋ ビルド 1 回分の文脈（設定・章・警告・URL 群）
  build/pipeline.ts       ＋ ビルドの総括（収集 → 章立て → 変換 → 生成物）
  build/collect.ts          対象ノートの収集と章順の決定（単体 / フォルダ / 目次ノート）
  build/vfm.ts              VFM 呼び出し（editPlugins の組み立て）
  build/mdast/embed.ts      ![[Note]] 展開（非同期 remark プラグイン）
  build/mdast/render.ts     Dataview / mermaid の MarkdownRenderer 描画
  build/replace/rules.ts    傍点・ルビ・縦中横・ハイライトのテキスト置換ルール
  build/hast/links.ts       [[link]] / 章間リンクの書き換え（rehype）
  build/hast/obsidian.ts    callout / タスクリスト / タグ（rehype）
  build/hast/assets.ts      画像パスの書き換えと収集（rehype）・画像ごとのサイズ指定（5.8）
  build/imageSizes.ts       組版前に全画像の intrinsic size を読む（5.8）
  build/hast/indent.ts      段落の字下げを決める 2 パス（5.3 #16）
  build/hast/spacing.ts      連続する空行を紙面の空きにする（5.3 #18）
  build/theme.ts            テーマの解決（同梱 / Vault の自作テーマ、5.10）
  build/css.ts            ＋ 設定 → テーマ CSS 変数の上書き（5.10）
  build/document.ts       ＋ 生成ページの HTML 骨格
  build/cover.ts            表紙ページの生成（5.9）
  build/sections.ts         前付け・後付けの構築（5.11）
  build/toc.ts              目次ページ（nav role=doc-toc）の生成
  build/fonts.ts            @font-face 生成・フォント存在検査（5.10）
  build/workspace.ts        ワークスペース（メモリ上の生成物とアセット表）
  build/materialize.ts    ＋ 書き出し前のアセット解決（外部 URL 取得・寸法読み・EPUB 用変換）
  build/manifest.ts         publication.json（Web Publications manifest）生成
  server/static.ts          127.0.0.1 静的 HTTP サーバ（トークン認証・パス境界チェック）
  export/run.ts           ＋ 書き出しの総括（ビルド → 検査 → 生成 → 保存）
  export/preflight.ts     ＋ 書き出し前チェック（実効 dpi・フォント・表紙比率）
  export/pdf.ts             webview + printToPDF
  export/pdfPostprocess.ts  pdf-lib でメタ・栞・ページラベル
  export/epub.ts            JSZip で EPUB 3 梱包（Phase 2）
  i18n/{index,ja,en}.ts   ＋ 文言辞書（5.5）
  util/                   ＋ tree（木の走査と置換）/ kanji（漢数字）/ paths / async / imageSize / electron / log
  themes/novel.css        ＋ 独自テーマ（決定 37）。novel-2col.css は novel を二段組にしたもの
  vendor/assets.ts        ＋ 埋め込みアセットへの入口（下記）
test/                     ＋ Obsidian API のスタブと、Node 上で走る検証
  test/sample.md            記法と奥付の項目を一通り含む検証用の原稿
  test/serve.ts             ビューア用と EPUB 用の両方を配信する目視用ハーネス
```

**【実装時の修正】`themes/` と `vendor/viewer/` はソースツリーに置かない。**
ファイルとして同梱すると、コミュニティプラグインの標準インストーラが配る
`main.js` / `manifest.json` / `styles.css` の 3 点に収まらなくなる。
esbuild プラグインで `@vivliostyle/viewer/lib/**` と CC0 テーマを**ビルド時に `main.js` へ埋め込み**、
ローカルサーバが `/viewer/*` `/themes/*` として配る（`main.js` は約 3MB）。

### 5.7 依存

| パッケージ | 用途 | ライセンス |
|---|---|---|
| `@vivliostyle/vfm` | MD→HTML | Apache-2.0 |
| `@vivliostyle/core` | 組版 | AGPL-3.0 |
| `@vivliostyle/viewer` | ビューア UI（任意。自前 UI にするなら不要） | AGPL-3.0 |
| `@vivliostyle/theme-*` | テーマ | CC0-1.0 |
| `pdf-lib` | PDF 後処理 | MIT |
| `jszip` | EPUB 梱包 | MIT / GPLv3 |

ビルドは Obsidian 標準の esbuild 構成。`obsidian` / `electron` / Node 組み込みは external。

#### `overrides`【決定】: VFM の下の古い版を前に引く

VFM が抱える推移的依存に、公開済みの脆弱性勧告が付いたものが 3 つあった。いずれも
VFM の更新を待つ以外に上流の直し方が無いので、`package.json` の `overrides` で持ち上げる。

| パッケージ | 入っていた版 | 勧告 | 上げた先 |
|---|---|---|---|
| `trim` | 0.0.1（`remark-parse@8` 経由） | ReDoS（High、`<0.0.3`） | `0.0.3` |
| `prismjs` | 1.27.0（`refractor@3.6` 経由） | DOM Clobbering（Medium、`<1.30.0`） | `^1.30.0` |
| `valibot` | 1.2.0（VFM が**完全固定**） | `flatten()` が throw（Medium、`<=1.4.1`） | `^1.4.2` |

`valibot` は直接依存でもあるので、override は `$valibot` と書いて直接依存の版を指す
（版を二重に書くと npm が `EOVERRIDE` で衝突を報告する）。同時に直接依存の範囲も
`^1.4.2` に上げ、解決結果が勧告の範囲へ落ちないようにした。

`prismjs` の DOM Clobbering は、Prism がブラウザの DOM から属性を読む経路の話である。
このプラグインは refractor の `highlight()` を呼んで hast を受け取るだけで DOM を触らない
ので、到達経路は無いと見ている。それでも版としては該当するので上げる。

**バージョンを跨いだので、コード強調表示にテストを付けた。** それまで `test/sample.md` には
コードブロックが 1 つも無く、文法定義が壊れても誰も気づかない状態だった。

### 5.8 画像の扱い

#### (1) 参照の解決

| 記法 | 解決方法 |
|---|---|
| `![[fig.png]]` / `![[fig.png\|300]]` | `app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)` → `TFile`。**パスの直接結合では解決できない**（Vault 設定の「添付ファイルの保存先」と短縮リンクに依存するため、必ず metadataCache 経由） |
| `![alt](fig.png)` / `![alt](sub/fig.png)` | ノートからの相対パス。`%20` のパーセントデコードと `![alt](<a b.png>)` の角括弧エスケープを先に処理 |
| `![alt](https://...)` | 外部 URL。→ (2) |

#### (2) ワークスペースへの収集

**プレビュー時はコピーしない。書き出し時のみ収集する**（ビルドを軽く保つため）。

- **プレビュー**: ローカル HTTP サーバに `/vault/<Vault相対パス>` ルートを生やし、Vault のファイルを直接ストリーム配信する。`<img src>` は `/vault/...` に書き換えるだけでコピー不要
- **PDF / EPUB 書き出し**: `assets/<正規化名>` を参照させ、EPUB は zip 梱包時に実体を読み込む
  - **【実装時の修正】ディスクへのコピーはしない。** `.cache/build/assets/` に実体をコピーする案の狙いは
    「パスの安定性」だったが、`assets/<正規化名>` → 実ファイルの対応表をサーバが持ち、
    要求時に Vault から `fs.createReadStream` で流せば同じ安定性が得られる（→ 5.12 のワークスペース）。
    PDF は組版済みの描画を印刷するだけなのでコピーは元から不要で、EPUB だけが実体を必要とする。
    コピーを廃したことで、書き出しのたびに画像を二重に持つことも、後片付けも無くなる
- **ファイル名衝突**: Vault 内には同名別フォルダの画像が普通に存在する → `assets/<Vault相対パスのSHA1先頭8桁>-<basename>.<ext>` に正規化
- **`<basename>` は URL 安全な文字だけに畳む**（`assetFileName`）。ファイルシステム用の
  `sanitizeFileName` は別の問いに答えるもので、それを通った名前がここで使えるとは限らない。
  Obsidian 自身の貼り付け画像名は `Pasted image 20250101120000.png` と**空白を含む**し、日本語 Vault は
  添付を日本語で名づけ、`&` はどちらでも合法である。この名前は `src` と zip エントリと OPF の `href` の
  **3 箇所に同時に、未エンコードで入る**。前 2 つは仕様に忠実なリーダーが解決できない参照になり、
  3 つ目は package document を非整形式 XML にする —— 画像 1 枚ではなく本ごと開けなくなる。
  同一性は前置のハッシュが持っているので、名前は判読できれば足りる
- **`![[埋め込み]]` で作った `<img>` を、後段のパスで二度解決しない。** 埋め込みの解決と
  Markdown 画像の書き換えは同じプラグインの前後半で走る。前半が付ける `src` は書き出しでは
  `assets/…`（出力内のパス）であって Vault パスではないので、後半がもう一度 Vault に問い合わせると
  必ず見つからず、**`![[画像]]` が書き出しでは全て空になる**。プレビューでは前半の `src` が
  `http://…` なので後半が自分から飛ばしており、この経路だけが生きていた。
  workspace は自分が発行したパスを知っているので、それが「もう自分のもの」の判定になる
- **重複参照**: 同一 `TFile` は `Map` で dedupe し 1 回だけコピー
- **外部 URL**: プレビューはそのまま webview に取りに行かせる。書き出し時は既定でダウンロードして埋め込む（**EPUB 3 は画像のリモート参照を許さない**ため必須）。設定で OFF 可、失敗時は警告して欠落扱い
- **Vault 外の絶対パス**: 既定で禁止（設定で許可、その場合はコピー必須）

対応拡張子は vivliostyle-cli の既定（`png` `jpg` `jpeg` `svg` `gif` `webp` `apng` + フォント `ttf/otf/woff/woff2`）に、Obsidian が扱う `avif` `bmp` を加えた集合とする。ただし EPUB では → (7)。

#### (3) サイズ指定の変換

Obsidian の `![[fig.png|300]]` / `![[fig.png|300x200]]` / `![alt|300](fig.png)` の数値は **px**。
組版では 96dpi 基準の px をそのまま流すと紙面上の寸法が直感とずれるため、変換方針を frontmatter で選べるようにする。

**【決定】単位のない数値の既定は `px`。** Obsidian の編集画面での見た目と紙面が一致するのが最も直感的なため。

```yaml
# vivlio.yaml
imageWidthUnit: px      # px（既定）| percent（数値を版面幅に対する % と解釈）| mm（数値をそのまま mm と解釈）
```

**【決定】単位は画像ごとにも書ける。** `![[fig.png|60%]]` / `![[fig.png|80mm]]` / `![[fig.png|300px]]`
（Markdown 形式の `![alt|60%](fig.png)` も同じ）。書いてあればそれが `imageWidthUnit` より優先される。

本ごとの設定だけでは足りない。**「この図は版面の何割か」は図ごとに違う答えを持つ質問**で、
扉裏の全幅図と本文中の小さな図解に同じ数値を当てる意味がない。単位のない数値の意味は変えていないので、
既に書かれた原稿は動かない。

**【決定】数値はどれも「紙面での画像の幅」を指す（縦組みでも横組みでも）。**
`%` は版面の幅に対する割合。論理プロパティで言うと縦組みでは数値が画像の**高さ**になってしまい、
`px` を既定にした理由（Obsidian の編集画面と見た目が一致する）が縦組みで成り立っていなかった。

**【決定】箱はプラグインが計算する。CSS に任せない。**
置換要素は片方の軸に確定値が入ると比率が交渉不能になり、もう片方の max は**絵ではなく箱を切る**。
素の Chromium でも同じで、300×400 の枠に 1400×900 の絵を `inline-size: 100%` で入れると
箱は 300×400 のまま出た。結果として **`60%` の図と `100%` の図が同じ大きさで刷られ**、
変わるのは周りに確保される空きだけだった（`100%` で無駄 60%、`60%` で 14%・実測）。

intrinsic size があれば交渉するものは無い。**片方の軸だけを書き、もう片方は auto に残す。**

```
width: 53.55mm; height: auto     ← 60% を、版面幅 89.25mm に対して解決した結果
```

`width` を直に書いてよい。縦組みで問題を起こしていたのは **割合** のほうで、包含ブロックが
画像に合わせて縮むために解決先が意図とずれていた。ここで書くのは絶対長なので、その問題は無い。

- **収集より前に全画像の intrinsic size を読む**（`build/imageSizes.ts`）。サイズを決める変換は
  同期で、ファイルを読めない。`materializeAssets` は書き出し時にこれを読んでいるが
  **文書を組んだ後**に走るので間に合わず、プレビューでは走ってすらいなかった
- 対象の列挙は `metadataCache.resolvedLinks`（リンクも埋め込みも入る）。`![[ノート]]` が持ち込む
  図もあるので md は辿る。読んだ結果は `パス + mtime + サイズ` でキャッシュする ——
  プレビューは何度も組み直すので、毎回読み直すとビルドで一番重い処理になる
- **版面に収めるのもここでやる**: `min(要求幅, 版面幅, 版面高 × 比)`。CSS が切る場面が無くなる
- **書き出し先で単位を変える。** 紙は `mm`、EPUB は `rem`。EPUB には幅の分かるページが無く、
  ルートの文字サイズは意図的に読者に委ねてある（`epubStylesheet`）ので、`rem` なら
  読者が選んだ字の大きさに対して図の比率が保たれる
- 残るのは **intrinsic size が読めなかった場合**（未知の形式・読めないファイル）。そのときだけ
  CSS の backstop に落ちる。`max-width` / `max-height` を版面の実寸で置く ——
  **確定値を持たない max 2 本は比率を保つ**（1400×900 が 300×400 の枠で 300×193 に収まる・実測）

実効 dpi の警告（下記）に渡す表示幅は、この計算結果の mm をそのまま px に直したもの。
どの単位で書かれていても紙面上の幅が確定しているので、`%` の図も検査の対象になる。

実測（既定の文庫・40字×16行）: `100%` の 2:1 の図は箱 732×366・比 2.000・**無駄 0%**、
`60%` の 1.556:1 の図は箱 439×282・比 1.556・**無駄 0%**。どちらも箱＝絵になっている。

**`300x200` だけは例外**で、箱を名指しする指示なのでそのまま `width` / `height` に流す。
比率が崩れるとしてもそれは書き手が指定したことである。

**【決定】表紙だけはこの規則の外に置く。** 表紙は版面の中に組むものではなく、**紙そのもの**である。

```css
@page cover, cover-document { margin: 0; width: auto; height: auto; }
.cover { page: cover; block-size: 100%; inline-size: 100%; margin: 0; }
.cover img { inline-size: 100%; block-size: 100%;
             max-inline-size: none; max-block-size: none; max-width: none; max-height: none; }
```

3 つとも必要だった。順に:

1. **`page: cover` を自分で振る。** theme-base は `body:has([role='doc-cover'])` で
   `cover-document` を割り当てるが、`:has()` は組版側で効かず、`@page` に何を書いても
   表紙のページには届いていなかった
2. **`@page` の `width` / `height` は「版面」**であって紙ではない。theme-bunko と novel は
   これを文字グリッドから決め、残りを余白にする —— 本文のページには正しく、表紙には誤り。
   `auto` に戻して紙いっぱいにする
3. **`max-*: none` を論理・物理の両方で明示する。** (3) の backstop は max 制約で、**max は
   どれだけ詳細なセレクタが 100% を要求しても使用値を切り詰める**。表紙が版面の 85% で出て
   下に白が残っていたのはこれ。表紙は版面の中に組むものではないので、どの軸でも外に置く

表紙が紙いっぱいに出ているかは、`test/serve.ts` が表紙ページを組むので目視で確認できる。

#### (4) VFM の figure / figcaption 変換

VFM が担当する部分で、frontmatter の `vfm:` にそのまま流せる。

- 画像だけの段落 + `alt` あり → `<figure><img><figcaption>alt</figcaption></figure>`
- `captionlessImagePolicy`: `paragraph`(既定) / `figure` / `figure-with-figcaption` — `alt` が空の画像単独段落の出し方
- `imgFigcaptionOrder`: `img-figcaption`(既定) / `figcaption-img` — 書籍では図キャプションを上に置く流儀もある
- `assignIdToFigcaption`: ID を `img` でなく `figcaption` に振る（相互参照用）
- `parseFigcaptionAsInline`: キャプション内で強調やルビを効かせる

#### (5) 組版上の扱い（Vivliostyle 固有）

- `<figure>` は `break-inside: avoid` でページまたぎを回避（テーマ側で指定）
- **CSS Page Floats が使える**。`figure { float-reference: page; float: block-start; }` で天付き・地付きの回り込み図版になる。**これは Chromium 単体では出せない**（Vivliostyle 独自実装）
- **画像の読み込み完了前にページ分割が確定すると紙面が崩れる。** vivliostyle-cli は `waitForNetworkIdle()` → `readyState === 'complete'` の順で待っている。自前実装でも PDF 化の直前に全 `<img>` の `decode()` 完了を待つ:
  ```ts
  await Promise.all([...doc.images].map(img => img.decode().catch(() => {})));
  ```
  ローカル HTTP 配信なので実測では一瞬だが、外部 URL 画像があると効いてくる
- **intrinsic size は組版前に読んである**（`build/imageSizes.ts` → (3)）。**ただし `width` /
  `height` 属性はまだ埋めていない。** 属性が入ればアスペクト比が画像の到着前に確定し、
  レイアウトが 1 パスで決まる。読む処理はもうあるので、残っているのは属性を書くところだけ

#### (6) PDF での解像度 ★実務上いちばん重要

Chromium の PDF 出力は Blink → Skia PDF 経路。**JFIF JPEG は元のバイト列がそのまま埋め込まれ、それ以外は deflate 圧縮したピクセルデータが埋め込まれる。96dpi に再ラスタライズされるわけではなく、元画像のピクセル数がそのまま PDF に入る。**

したがって実効解像度は次で決まる:

```
実効 dpi = 画像のピクセル幅 ÷ 紙面上の物理幅(inch)
```

例: 紙面 100mm 幅に配置して 350dpi 相当を得るには `100 / 25.4 × 350 ≈ 1378px` が必要。

→ **書き出し前に「実効 dpi が閾値（既定 300dpi）を下回る画像」を一覧で警告する機能を入れる。** 同人誌の入稿で最も事故るポイントで、他のどの Obsidian プラグインも持っていない差別化要素になる。

- **SVG はベクタのまま PDF に入る**ので拡大しても劣化しない。図版は SVG 推奨
- CMYK 変換 / PDF/X が必要なら vivliostyle-cli の `--preflight press-ready` 経由（Phase 3・オプトイン）

#### (7) EPUB での扱い

- **EPUB 3 コアメディアタイプは GIF / JPEG / PNG / SVG / WebP。`avif` と `bmp` は非対応** → 書き出し時に PNG へ変換（`createImageBitmap` + `OffscreenCanvas` でレンダラ内で完結）、または警告してスキップ
- リモート画像は不可 → 必ずダウンロードして同梱（→ (2)）
- OPF の manifest に全画像を列挙。カバー画像は `properties="cover-image"`
- **紙用の寸法はリーダーに持ち込めない。** 幅は `rem` で届き（→ (3)）、紙の版面で置いた
  `max-width` / `max-height` の mm は EPUB 用 CSS が打ち消す:
  `img, svg { max-width: 100%; max-height: none; max-inline-size: 100%; block-size: auto; }`。
  読者の段が唯一意味のある上限で、`rem` なら読者が選んだ字の大きさに図の比率が追従する

#### (8) 非対応・要前処理のもの

| 対象 | 扱い |
|---|---|
| `![[drawing.excalidraw]]` | 実体は JSON。既定はプレースホルダ + 警告。Excalidraw プラグインが吐いた `.svg` / `.png` があればそちらを優先参照 |
| `![[board.canvas]]` | 同上。非対応 |
| mermaid コードブロック | `MarkdownRenderer.render()` で描画し、生成された SVG を抜き出して `<figure>` に差し替える（5.3 #2） |
| `![[doc.pdf]]` / `![[doc.pdf#page=3]]` | 非対応。リンクテキストに落とす |
| Dataview / Templater の動的ブロック | **`MarkdownRenderer.render()` で描画して埋め込む**（5.3 #2）。下記の注意あり |

**`MarkdownRenderer.render()` を使う際の注意**

- **非同期描画の完了待ちが必須。** `render()` の解決後も Dataview / mermaid は自前で後追い描画するため、
  オフスクリーンのコンテナに対して `MutationObserver` で変化が止まるのを待つ（`better-export-pdf` が
  `waitForDomChange(target, timeout, interval)` で同じことをしている）。タイムアウトは 5 秒程度
- 描画には `Component` インスタンスの受け渡しが要る。`onunload` で確実に `unload()` すること（リークするため）
- 生成 DOM には Obsidian のクラス名（`.dataview`, `.table-view-table` 等）が付く。
  テーマ CSS 側に紙面用の最小限のスタイルを用意し、Obsidian のスタイルには依存しない
- 対象プラグインが未インストール／無効なら描画は空になる。その場合はコードブロックのまま残し警告する
- `dataviewjs` / `templater` は任意コードを実行する。**Vault の所有者自身のノートのみを対象とする**前提で、
  外部から受け取ったノートを書き出す場合は設定で無効化できるようにする

### 5.9 表紙

#### 指定方法（3 通り）

| frontmatter | 挙動 |
|---|---|
| `coverPage: 表紙.md` | そのノートを表紙として組む。タイトル・著者・背景画像を自由にレイアウトできる。**`cover` より優先** |
| `cover: 装丁/表紙.png` | 画像 1 枚から表紙ページ HTML を自動生成する。`![[]]` と同じ解決規則（`metadataCache` 経由） |
| どちらも無し | 表紙なし。EPUB 書き出し時のみ「表紙が未指定です」と警告（→ EPUB の項） |

#### theme-base の cover 機構にそのまま乗る

`@vivliostyle/theme-base` は既に表紙の概念を持っている:

```css
.cover, section:has(> .cover:first-child) { page: cover; }
body:has([role='doc-cover'])              { page: cover-document; }
@page cover        { --vs-page--mbox-visibility: hidden; }  /* ノンブル・柱を消す */
@page cover-document { --vs-page--doc-counter-increment: vs-counter-doc 0; }
```

生成する HTML に `class="cover" role="doc-cover"` を付ければ、ノンブル・柱の抑止はテーマ側で処理される。

**【誤り・未解決】表紙はページ数に数えられている。** 上の `vs-counter-doc` は theme-base が
**ドキュメント数**を数えるためのカウンタで、CSS の `page` カウンタとは別物である。
表紙を通しページから外す効果はない。実測（表紙・扉・半扉・献辞の本）:

| 紙 | 中身 | ノンブル |
|---|---|---|
| 1 | 表紙 | i（非表示） |
| 2 | 扉 | ii（非表示） |
| 3 | 半扉 | iii（非表示） |
| 4 | 献辞 | **iv（表示）** |

表紙は本文用紙の一葉ではないので、和書でも洋書でもノンブルの勘定に入らない。
本来は扉が i で献辞が iii になるべきところ、**前付けのノンブルが全部 1 ずつ後ろにずれている。**
PDF のページラベル（`export/pdfPostprocess.ts`）は前付けの先頭を `St: 1` として書いているので、
**紙面とビューアのページ表示も食い違っている。**

**直す方法が見つかっていない。** 試して効かなかったもの（すべて実測）:

| 試したこと | 結果 |
|---|---|
| 表紙の要素に `counter-reset: page 0` | 変化なし。`42` にしても扉は ii のまま |
| `:root.vivlio-cover { --vs-document-first-page-counter-reset: page -1 }`（theme-base の `@page :nth(1)` フック） | 変化なし |
| `:root.vivlio-cover { --vs-first-page-counter-reset: page -1 }`（同じく `@page :first` フック） | 変化なし |
| `@page cover, cover-document { counter-reset: page -1 }` を直書き | 変化なし |
| `@page cover, cover-document { counter-increment: page 0 vs-counter-doc 0 }` | 変化なし |
| 扉（表紙の次の紙）の要素に `counter-reset: page 1` | **その紙だけ** i になり、続く半扉は iii のまま（i, iii, iv, v） |

最後の 1 つが手がかりになる。**要素に書いた `counter-reset: page` は、その要素が占めるページにしか効かない。**
本文の `.vivlio-page-reset` が効いて見えるのは、一章目の要素が本文の 19 ページ分を占めていて、
そこから先のドキュメントがその続きを引き継ぐからである
（実測: 羅生門 1・鼻 20・蜘蛛の糸 32 と連番になる）。扉は 1 ページしか占めないので、
リセットはその 1 ページで終わってしまう。なぜ本文からは引き継がれ、扉からは引き継がれないのかは
解明できていない。

Vivliostyle 側の挙動を突き止めるか、別の仕掛け（前付けだけ別カウンタで数えるなど）を考えること。

```html
<section class="cover" role="doc-cover">
  <img src="assets/3f2a91c4-cover.png" alt="">   <!-- 名前は URL 安全に畳む → 5.8(2) -->
</section>
```

```css
/* 全文と、3 つとも要る理由は 5.8(3)「表紙だけはこの規則の外に置く」 */
@page cover, cover-document { margin: 0; width: auto; height: auto; }   /* 裁ち落とし */
.cover { page: cover; block-size: 100%; inline-size: 100%; margin: 0; }
.cover img {
  inline-size: 100%; block-size: 100%;
  max-inline-size: none; max-block-size: none; max-width: none; max-height: none;
  object-fit: cover;                              /* coverFit: cover */
  /* coverFit: contain のときは object-fit: contain */
}
```

#### 注意点

- **`bleed` / `marks` はセレクタなしの `@page` でしか効かない**（Vivliostyle の仕様）。
  つまり**表紙だけ塗り足しやトンボを変えることはできず、本全体に一括で掛かる。**
- **【決定】トンボなしの塗り足しは、用紙そのもので持つ。** CSS の `bleed` は
  「crop marks が有効なときにしか効かない」（CSS Paged Media 3）。ところが日本の印刷会社には
  **「トンボなし・塗り足し3mm」**を入稿規定にしているところが多く、これは仕上がり寸法の紙に
  四方 3mm ずつ絵柄がはみ出した PDF のことである。CSS で直接は言えないので、
  `cropMarks: false` かつ `bleed` が指定されたときは**用紙を仕上がり＋塗り足し×2 に広げる**
  （`sheetSize`、`src/build/css.ts`）。余白は `auto` で四方に同じだけ足すので、
  版面は仕上がり位置のまま動かない。表紙のような裁ち落としの絵は広げた紙いっぱいに出る ——
  それが塗り足しそのものになる。トンボありのときは従来どおり、テーマに長さを渡して
  Vivliostyle に紙を広げさせトンボも描かせる。
  mm 以外の単位や、mm が割り出せない判型のときは何もしない（勝手に推測しない）
- **【未解決】塗り足しまで届くのは表紙だけ。** 表紙は `@page cover` が `margin: 0` で
  紙そのものを版面にし、`.cover img` が `100%` で広がるので、用紙が広がれば自動的に塗り足しの端まで
  埋まる（実測: A5＋3mm で 154×216mm の紙に画像が 0,0 から 154×216mm）。
  **本文には裁ち落としの仕組みが無い。** `imageBackstop` と `applySize` があらゆる画像を版面の内側に
  収めるので、断ち切りの挿絵は置けない。地色も同じで、プラグインもテーマもページ背景を塗らないうえ、
  本の `css` に `body { background: … }` と書いても body の箱は版面なので版面の内側しか塗られない
  （紙全体は `@page` に書く必要がある）。決めること:
  - 本文の画像を裁ち落としにする手段（`.vivlio-bleed` のようなクラスで版面の制限を外す）を持たせるか
  - `coverPage`（表紙用のノート）が裁ち落としになるかは**未確認**。`role="doc-cover"` は付くが
    `class="cover"` は付かず、theme-base が role から当てる `cover-document` に頼ることになる。
    その `body:has([role='doc-cover'])` は効かなかったという実測が `coverCss` のコメントに残っている
  同人誌入稿のように表紙を別入稿する運用では `coverInPdf: false` にして本文だけの PDF を出し、
  表紙は表紙だけの 1 ページとして別ビルドする（コマンドを分けるか、モーダルにチェックボックスを置く）
- **判型と画像の縦横比が違うと `coverFit: cover` では切れる。** 書き出し前に
  「表紙画像の縦横比が判型と N% ずれています（上下 M mm がトリミングされます）」と警告する
- 表紙は本の中で最も解像度が要る。**5.8(6) の実効 dpi 警告の対象**に必ず含める
- 見開き表示で表紙が右に来るか左に来るかは `page-progression-direction`（縦組み = rtl）で決まる。テーマ任せでよい
- `coverPage` を使う場合、そのノートは spine の先頭に置き、**章としてはカウントしない**（5.2 の並び順規則の例外）

#### EPUB での扱い

- 表紙画像を OPF の manifest に `properties="cover-image"` で登録する。**リーダーの本棚サムネイルに使われる**
- 表紙 XHTML を `nav` の landmarks に `epub:type="cover"` で登録する
- **EPUB では表紙指定が実質必須**（無いと本棚で真っ白になる）。未指定なら書き出し時に警告する
- `coverInPdf: false` にしていても EPUB には表紙を入れる（PDF と EPUB で意味が違うため、フラグは PDF にのみ効く）

### 5.10 フォント

#### 設定の入口はテーマの CSS 変数

`theme-base` はフォントを完全に CSS 変数で駆動している。frontmatter / 設定タブの指定は、
**すべてこの変数の上書きに落とす**（独自の仕組みを作らない）。

| 変数 | 対象 | frontmatter |
|---|---|---|
| `--vs-font-family` | 本文 | `fontFamily` |
| `--vs--heading-font-family` | 見出し | `headingFontFamily` |
| `--vs--monospace-font-family` | `code` / `pre` / `kbd` / `samp` | `monospaceFontFamily` |
| `--vs-page--mbox-font-family` | ノンブル・柱（ページマージンボックス） | `mboxFontFamily` |
| `--vs-font-feature-settings` | OpenType 機能 | `fontFeatureSettings` |
| `--vs--html-font-size` | 基準サイズ | `baseFontSize` |
| `--vs--rt-font-size` | ルビ | `rubyFontSize` |

#### フォントの供給元

**ユーザーが自分の PC のフォントを指定できる**ようにする。ただし方式が 3 つあり、意味が違う。

| # | 供給元 | 指定方法 | インストール要否 | 他の PC での再現性 |
|---|---|---|---|---|
| **A** | **PC にインストール済みのフォント** | `fontFamily: "游明朝"` のように**名前を書くだけ** | 不要（既にある） | ✗ そのフォントを持つ PC でのみ同じ組版になる |
| **B** | **Vault 内に置いたフォントファイル** | `embedFonts: [{ family, src: 装丁/fonts/xxx.otf }]` | **不要**（インストールしていなくても使える） | **◎ Vault ごと同期すればどの PC でも同じ組版**（推奨） |
| **C** | **PC 内の任意の場所にあるフォントファイル** | `embedFonts` の `src` に絶対パス（`C:/Users/.../MyFont.otf`） | 不要 | ✗ そのパスが存在する PC でのみ動く |
| — | プラグインへの同梱 | — | — | **やらない。** 日本語フォントは 1 ウェイト 5〜16MB あり、プラグインに入れるサイズではない |

- **A** が既定かつ最も手軽。**B** は同人誌などで「入稿まで確実に同じ字面にしたい」場合に使う
- **B** / **C** は `@font-face` を生成してローカル HTTP サーバから配信する。`ttf` / `otf` / `woff` / `woff2`
- **C** は Vault 外なので、EPUB 書き出し時は必ずコピーが要る（5.8(2) の Vault 外参照と同じ扱い）
- **B** / **C** で指定したフォントは、A と違って**インストールされていなくても PDF に埋め込まれる**
- どの方式でも、指定を解決できなかったら**書き出し前チェックで警告する**（下記）

#### フォントピッカー（設定タブ / 書き出しモーダル）

「游明朝」なのか「Yu Mincho」なのか「YuMincho」なのか、フォント名を手で打たせると必ず事故る。
**インストール済みフォントの一覧をドロップダウンで出す。**

`queryLocalFonts()`（Local Font Access API）で `FontData[]`（`family` / `fullName` / `postscriptName` / `style`）が取れる。
**Electron ではこの API が権限ハンドラを無視して常に許可される**（[electron#39140](https://github.com/electron/electron/issues/39140) で「ブロックが効かない」ことが問題として報告されている＝裏を返せば使える）ので、
Obsidian 上で権限プロンプトなしに一覧を取得できる。

- 設定タブでは本文 / 見出し / 等幅の 3 つをドロップダウンで選ばせ、内部的には CSS の font-family スタックとして保存する
- `family` 単位で重複排除し、和文フォントを上に寄せる（`family` に日本語が含まれる、または CJK グリフを持つものを優先表示）
- **フォールバック**: `queryLocalFonts` が使えない環境（将来 Electron 側が塞ぐ / ユーザーが拒否）では
  ドロップダウンを自由入力に落とし、下記の canvas 計測で存在検査だけ行う

#### OS 別フォールバックの補完

`theme-bunko` の既定は `'游明朝', 'YuMincho', serif` で、**macOS / Linux では汎用 serif に落ちる**。
プラグイン側で全 OS を並べた 1 本のスタックを既定値として上書き注入する。

| | 明朝 | ゴシック |
|---|---|---|
| Windows | 游明朝 / YuMincho / BIZ UDPMincho / MS 明朝 | 游ゴシック / Yu Gothic UI / メイリオ |
| macOS | ヒラギノ明朝 ProN / Hiragino Mincho ProN | ヒラギノ角ゴシック / Hiragino Sans |
| Linux | Noto Serif CJK JP / Noto Serif JP | Noto Sans CJK JP |

#### PDF での挙動 ★重要

- **Chromium は PDF 生成時に必ずフォントを埋め込み、使用したグリフだけにサブセット化する。**
  つまり OS のシステムフォントを指定しても、他の環境で開いて同じ字形になる PDF が出る（入稿可能）
- 同時に `/ToUnicode` CMap が生成されるので、**PDF 内のテキストは検索・コピーできる**
- ただし埋め込むフォントのライセンスが「PDF 埋め込み可」である必要がある。
  游明朝・ヒラギノなど OS 添付フォントは一般に可だが、**商業印刷に出す場合はユーザー側の確認事項**。
  設定タブに注意書きを出すに留め、プラグインは判定しない
- **指定フォントが無いと Chromium は黙って別のフォントに落ちる。** これが組版事故の温床

#### フォント存在検査（警告機能）

**指定フォントが無いと Chromium は黙って別のフォントに落ちる。** ピッカーから選んだ場合でも、
Vault を別の PC で開けば同じことが起きる（方式 A の弱点）。したがって検査は必ず行う。

1. **一次判定**: `queryLocalFonts()` の結果に指定ファミリが含まれるか
2. **二次判定（フォールバック）**: **canvas 計測法** — 指定ファミリと `monospace` で同じ文字列
   （`あ漢A0` など和欧混在）の幅を測り、一致したらフォールバックが起きたと判定する。
   方式 B / C の `@font-face` が読めているかの確認にはこちらを使う（`document.fonts.check()` でも可）

見つからなかったファミリ名は、プレビューのツールバーと書き出し前チェックの両方に出す。
「`游明朝` が見つかりません。`ヒラギノ明朝 ProN` で代替表示しています」のように、
**実際に何で描画されているかまで出す**（`document.fonts` から解決結果を引く）。

#### 自作テーマ【決定】: Vault の .css をそのままテーマにできる

`theme` には同梱テーマの名前のほか、**Vault 内の .css へのパス**を書ける。設定タブとプレビューの
テーマ選択にも Vault の .css が並ぶので、パスを手で書く必要はない。

**土台にできなければ「使える」とは言えない。** 同梱テーマはプラグインに埋め込まれていて Vault の
ファイルではないので、相対パスの `@import` では届かない。専用の綴りを 1 つ用意する:

```css
@import url("vivlio:novel");   /* base | bunko | novel | techbook | academic */
                               /* 5 つとも解決する。選択肢に出るのは novel だけ */

:root { --vs-novel--boten-font-size: 0.3rem; }
```

それ以外の `@import` は普通の相対パスとして Vault から読む。

**自作テーマは 1 枚に解決してからワークスペースに置く。** プレビューはその解決済みの写しを読み、
EPUB はそれを同梱する —— 両者が同じものを見るのはこのため。Vault のファイルを直接リンクすると、
EPUB 側は結局同梱できず（`@import` の連鎖が Vault の中にある）、紙面と読み上げが食い違う。

- 循環インポートは 1 度読んだファイルを覚えておいて止める
- `http(s):` の `@import` はそのまま残す。プレビューは取りに行けるし、EPUB には元より入れられない
- **自作テーマには既定グリッドがない**（下記）。字詰めで版面を作るテーマなら
  `charsPerLine` / `linesPerPage` を明示すること

#### 字詰め・行数の既定値【決定】: テーマの持つ値で埋める

`charsPerLine` / `linesPerPage` は 3 層のどこからでも指定できるが、**どこにも書かれていない場合がある。**
そのとき組み方向のテーマ（`novel` / `bunko`）は自分の既定値（40字×16行 / 39字×15行）で版面を組むのに、
プラグイン側は「両方揃っていない」として文字サイズを算出しない。結果、**16px のまま 40字×16行の版面が作られ、
文庫判の用紙からはみ出す**（実測: 用紙 397×559px に対し版面 513×640px）。
プリセット経由なら値が入るので表に出にくいが、素の既定値では確実に壊れる。

**テーマごとの既定グリッドを 1 箇所（`BUNDLED_THEME_GRIDS`）に持ち、書籍が指定しなければそれで埋める。**
埋めた値は `--vs-theme--num-of-character` / `--vs-theme--num-of-line` / `--vs-theme--num-of-column`
として書き出すので、テーマが組む版面と文字サイズの算出根拠が必ず一致する。

グリッドを持たないテーマ（`techbook` / `academic`）は表に載せない。
それらは余白から版面を作るので、**書籍が明示的にグリッドを指定したときだけ**文字サイズを算出する
（勝手に算出するとテーマ自身の設計を上書きしてしまう）。

#### 二段組【決定】: 段は字の軸を割る。行数は割らない

同人誌の B6・A5、そして新書は縦組みでも二段組が多い。`novel-2col` テーマがそれを組む
（`novel` に段数と段組向けのグリッドだけを足したもの）。

**CSS の段は inline 軸に並ぶ。** 縦組みの inline 軸は上から下なので、`column-count: 2` は
そのまま「上下 2 段、字は段の中を下へ流れ、行は左へ進み、上の段を使い切ると下の段の右上へ続く」
——日本語の二段組そのものになる。段の向きを指示する規則は要らない。

**字詰めと行数は 1 段あたりの数**（`charsPerLine` / `linesPerPage`）。両方の段は紙面の幅いっぱいを
使うので、行数は段で割られず、1 ページの行数は `linesPerPage × 段数` になる。したがって版面は

```
字の軸 = (段数 × 字詰め + (段数 − 1) × 段間) × 文字サイズ
行の軸 = 行数 × 行送り × 文字サイズ
```

で、`gridFontSize` もこの式で用紙から文字サイズを逆算する。段間はテーマの
`--vs-novel--column-gap`（2 文字）とプラグインの `COLUMN_GAP_CHARS` が一致していること。
`--vs-line-height` と `GRID_LINE_HEIGHT` が一致していなければならないのと同じ理由で、
片側だけ知っていると版面が段間の分だけ用紙からはみ出す。

**行送りは一段組と同じ 2 文字のまま。** 印刷の二段組はもっと詰めるが、ルビは本文の半分の大きさで、
行送り 2 が残す半行の空きにちょうど収まる。ここを詰めると 1 ページあたり数行増える代わりに、
すべてのルビが隣の行に食い込む。

**段組にするのは本文だけ**（`:root.vivlio-body body`）。表紙・扉・目次・奥付はページを満たすことで
成立する頁で、段に割れた奥付は奥付ではない。脚注（`gcpm`）は Vivliostyle が版面の地に
両段をまたいで置く（実測）。

段数は本の設定 `columns` からも指定できる。`novel` テーマもこのキーに従うので、
`theme: novel` に `columns: 2` でも二段組になる（行送りが一段組のままなので 1 段の行数は少なめ）。

#### 縦組み特有の考慮

- **縦組みでは `font-feature-settings: 'vert' 1, 'vrt2' 1` が必要な場合がある**（句読点・括弧・長音の字形が縦用に切り替わる）。
  `writing-mode: vertical-rl` なら Chromium が自動で `vert` を適用するが、フォントによっては明示が要る。
  `--vs-font-feature-settings` に入れる
- 縦中横（5.3 #5, #6）の数字に和文フォントの半角数字ではなく欧文フォントを当てたい場合があるため、
  独自変数 `--vs--tcy-font-family` を足して `.tcy` に適用する
- ルビのフォントは本文と同じでよい。サイズはテーマの `--vs--rt-font-size` に従う
- **前付け・後付けに専用のフォント設定は持たない。** 目次・扉・奥付は普通のドキュメントなので、
  見出し（目次の「目次」など）は `headingFontFamily`、それ以外の行（書名・著者名・奥付の各行）は
  `fontFamily` で組まれる。別の書体を当てたい場合は設定タブの「追加 CSS」で
  `.titlepage .title { font-family: … }` のように書く。
  キーを部位の数だけ増やすより、CSS を 1 行書くほうが自由度が高く、覚えることも少ない
- **傍点はルビより一段小さい。** ルビは読みで、傍点は印。同じ `--vs--rt-font-size`
  （既定 0.5rem）で組むと、傍点が本文の脇にもう一行あるように見える。
  `novel` テーマは `--vs-novel--boten-font-size`（既定 0.35rem）を別に持つ
- **`ruby` と `rt` の `line-height` は `1` に固定する。** ルビが行送りを崩さないのは、
  ルビ文字が行の持つ半行分の空き（half-leading）に収まる場合だけ。`--vs-line-height: 2` なら
  本文の上に半行の空きがあり、`--vs--rt-font-size: 0.5rem` のルビはちょうど収まる ——
  はずが、`rt` は行送り `2` を**継承する**ので、注記のボックスが 0.5rem × 2 = 1 行分の高さになり、
  半行の空きを溢れて行間を押し広げる。傍点（5.3 #3）は 1 文字ごとに `rt` を持つので特に目立つ

#### EPUB での扱い

- **既定ではフォントを埋め込まない。** 日本語フォントは 1 ウェイトで EPUB 全体より大きくなり実用に耐えない。
  多くのリーダーは自前のフォントで表示する
- `embedFonts` があり、かつ設定タブで「EPUB にフォントを埋め込む」を明示的に ON にした場合のみ、
  OPF の manifest に追加して同梱する。**フォントのライセンス確認はユーザーの責任**である旨をその設定項目に明記する
- `font-family` の指定自体は CSS に残すので、リーダー側に同名フォントがあれば使われる
- サブセット化は Phase 3 以降の課題（`harfbuzzjs` ベースの `subset-font` でレンダラ内でも可能だが CJK は重い）

### 5.11 前付け・後付け（扉・目次・奥付）

#### 指定方法【決定】: 部位ごとに `auto` / ノートパス / `off` を選ぶ

`sections` は入れ子なので **`vivlio.yaml` 専用**（5.4）。frontmatter からは指定できない。

```yaml
# vivlio.yaml
sections:
  # ── 前付け ──
  halfTitle: off          # 半扉      auto | <ノートパス> | off
  titlePage: auto         # 扉（本扉）
  dedication: 献辞.md     # 献辞
  epigraph: off           # 題辞
  toc: auto               # 目次ページ
  preface: まえがき.md     # まえがき
  # ── 本文（5.2 の並び順規則で決まる） ──
  # ── 後付け ──
  afterword: あとがき.md   # あとがき
  appendix: 付録.md        # 付録
  bibliography: off        # 参考文献
  acknowledgments: off     # 謝辞
  colophon: auto           # 奥付
pageNumbering: roman-then-arabic   # roman-then-arabic（既定）| continuous | none
```

- **順序は上記の正準順で固定**。YAML の記述順ではなく、この決まった順に並べる（挙動が読めるように）
- 値が**ノートパス**ならそのノートを該当部位として組む。frontmatter は不要（プラグインが `role` を付ける）
- **`auto` にできるのは 4 部位だけ。** 他は中身を機械生成できないのでノートパス指定のみ（`auto` を書いたら警告）
- **部位に指定したノートは本文の章にしない。** ノートパス指定の部位は本のフォルダの中を指すのが普通で、
  そこは本文の章を集める場所でもある。除かなければ「まえがき」が前付けと本文の一章に二度出る
  （`coverPage` も同じ）

| 部位 | `auto` の中身 |
|---|---|
| `halfTitle` | `title` のみを組んだ半扉 |
| `titlePage` | 作品を名乗る側（`series` / `title` / `subtitle`）と人を名乗る側（`author` / `translator` / `publisher`）を組んだ扉（下記） |
| `toc` | 各章の見出しから `<nav role="doc-toc">` を生成（下記） |
| `colophon` | 書名と発行の情報を組んだ奥付（下記） |

#### 扉【決定】: 訳者がいるときだけ役割を書く

**名前が 1 つなら、それが著者であることは書かない。** 日本語の扉は名前だけを置き、
それが著者であることは書かないのが普通で、わざわざ「著」と断るのはかえって説明的になる。

**訳者が入った瞬間に、それは成り立たない。** 名前が 2 つ並んでいて片方にも印が無ければ、
どちらがどちらか読み手には決められない。**そのときだけ両方に役割を付ける**（`著` / `訳`）——
訳者にだけ付けると、残った名前が「役割の無い人」に見えてしまう。

```html
<div class="imprint">
  <div class="byline">
    <p class="author">野中 信人<span class="role">著</span></p>
    <p class="translator">山田 花子<span class="role">訳</span></p>
  </div>
  <p class="publisher">架空書房</p>
</div>
```

- 役割は名前の**注釈**なので、一回り小さく、色を落とし、太らせない
- 役割の前の空きは **インライン軸**（`margin-inline-start`）。縦組みではインライン軸が
  上下なので、これが名前と役割のあいだに入る。`margin-block-start` では役割が横にずれる
- **人（`byline`）と版元（`publisher`）は別のまとまり。** 著者と訳者は 1 行空き、版元は
  3 行空きで離す。3 つを等間隔に置くと、無関係な名前が 3 つ並んでいるように読める

#### 奥付【決定】: 「書名の柱」と「項目行」の 2 部構成

表組み（`<table>`）をやめる。縦組みの表は行と列の向きが直感と逆になり、
そもそも奥付は表ではなく**箇条**である。

```
シリーズ名                        ← あれば
書名                              ← 大きく、下に罫
──────────
二〇二六年九月二日　初版発行      ← ラベルを持たない一文
                                  ← group 間の空き
著　　　者  野中 信人
訳　　　者  山田 花子

発　行　所  架空書房
            〒100-0000 …          ← 発行所にぶら下げる
            https://…
印　　　刷  架空印刷株式会社

装　　　丁  佐藤 次郎
校　　　正  鈴木 三郎
```

**【決定】項目は 4 つのまとまりに分けて、あいだを空ける。**
いつ・誰が・どこから・誰の手で —— 奥付が答えているのは 4 つの別々の問いで、
それを 1 本の梯子に並べると表に見える。**全部の欄が同じ高さから始まって同じ長さで終わる**のが
「奥付が表に見える」の正体だった。

**【決定】発行日と版は 1 行にする。** 「初版発行」はひと続きの文であって、
`発行日` と `版` の 2 項目ではない。ラベルを持たない `.colophon-line` として組む。

**【決定】連絡先と WEB は発行所にぶら下げる。** 住所も URL も「その発行所への行き方」で、
本に関わった別の相手ではない。それぞれにラベルを与えると、**ラベルの列が答えの列より長くなる**。
**ラベル幅＋ラベルと値のあいだの空き**ぶん字下げした `.colophon-detail` として、発行所の下に置く
（同じ 0.9em で数えるので、ぶら下げた行の頭が値の頭と 1px も違わずに揃う）。

**【決定】書名の下に罫を引く。** 罫が無いと、書名は「同じ行から始まる 11 本の柱の 1 本目」に
見える。罫は書名の宣言をそこで閉じる。

**【決定】奥付は版面の「隅」に置く。** 従来はブロック軸（縦組みでは左）にだけ寄せていて、
インライン軸では版面の天から始まっていた。結果、**空いたページの上に項目の帯が浮いて**見え、
書名の下の罫も紙の高さいっぱいに伸びて、その大半には隣に何も無かった。
交差軸を `align-items: safe flex-end` にすると、箱が内容の高さまで縮み、地に落ちる。

- `safe` は、奥付がページより長いときに**天**（書名のある側）が切れるのを防ぐ。
  はみ出すときは start 揃えに戻る
- **縦組みのときだけ**（`.vivlio-vertical`）。インライン軸の終端は、行が縦に流れるならページの地、
  横に流れるなら小口側であって、横組みの奥付は手前側の地に置きたい ——
  1 つの論理プロパティでは両方を言えない。生成する文書の `<html>` に
  `vivlio-vertical` / `vivlio-horizontal` を付けて、テーマ側で選ぶ

- 前半（`.colophon-series` / `.colophon-title`）は**ラベルを持たない**。書名に「書名」と
  断る必要はない
- 後半は `<dl>`。1 行を `<div class="colophon-row"><dt>ラベル</dt><dd>値</dd></div>` で包む
  （HTML5 が `dl` 直下の `div` を許すのはまさにこの用途）
- **ラベルは 5em に均等割りする**（`dt { inline-size: 5em; text-align-last: justify }`）。
  「発　行　所」のように字を配るのは日本語の奥付の作法で、2 字でも 4 字でも値の開始位置が揃う。
  **均等割りは最後の字を 5em の端に押しつけるので、値との間は `margin-inline-end` で空ける** ——
  幅の中に余白を取ろうとしても、割り付けがそれを食べてしまい「発　行　所架空書房」になる。
  空きはラベル自身の em で測ることに注意（ラベルは 0.9em なので、見た目は数字より狭く出る）
- 奥付の箱は扉の imprint と同じ仕掛け（`block-size: var(--vs-novel--block-extent)` +
  `margin-block-start: auto`）で**版面の端**に着ける。縦組みでは左寄り
- **値のない項目は行そのものを出さない。** 訳者のいない小説に空の「訳者」行は要らない

#### 奥付の項目【決定】

| キー | 出るところ | 備考 |
|---|---|---|
| `series` | 前半 | シリーズ名。あれば |
| `title` | 前半 | 書名 |
| `author` | 2 群目 | 著者 |
| `translator` | 2 群目 | 訳者。あれば |
| `date` | 1 群目 | 発行日。**縦組みでは漢数字**（下記）。`version` と 1 行にまとめ、ラベルは付けない |
| `version` | 1 群目 | 版。`date` と同じ行に入る |
| `publisher` | 3 群目 | 発行所。あれば |
| `printer` | 3 群目 | 印刷。あれば |
| `contact` | 3 群目 | 連絡先（住所・メール）。**発行所にぶら下げる**（ラベル無し） |
| `website` | 3 群目 | WEB サイト。**発行所にぶら下げる**（ラベル無し） |
| `colophonExtra` | 4 群目 | **著者が決める任意の項目**（下記） |

#### 任意の項目は「本が自分でラベルを決める」

装丁・校正・組版・写真 —— 奥付が名前を挙げたい相手に決まった一覧はない。
固定キーを増やし続ける代わりに、**ラベルごと本に書かせる。**

```yaml
# vivlio.yaml — 2 通りのどちらでもよい
colophonExtra:
  装丁: 佐藤 次郎
  校正: 鈴木 三郎

colophonExtra:
  - { label: 装丁, value: 佐藤 次郎 }   # 同じラベルを 2 度使うならこちら
```

マッピング形式は短く書けて順序も保たれる（YAML のマッピングは順序つきのオブジェクトとして届く）。
リスト形式は順序と重複を明示できる。値が空の項目は落とす。

#### 縦組みの日付は漢数字

`2026-09-02` → `二〇二六年九月二日`。縦組みの行の中の算用数字は横倒しになり、
奥付はそれを縦中横にも組まない。**年は位取りせず一字ずつ**（二〇二六）、
**月日は数として数える**（九月・二十一日）のが日本語の書き方。

対応するのは `YYYY-M-D` / `YYYY/M/D` / `YYYY年M月D日` と、年だけ・年月だけの形。
**それ以外は一切触らない。** `date` は自由記述の欄で、「令和八年」「第三刷」と書く本はそう書きたいのである。

#### 扉は「作品を名乗る側」と「人を名乗る側」に分かれる

前半は作品の名 —— 叢書名（`series`）・書名（`title`）・副題（`subtitle`）。
後半は人の名 —— 著者（`author`）・訳者（`translator`）・発行所（`publisher`）。
奥付（下記）と同じ分け方で、後半を版面の端に寄せられるのはこの分割があるため。

**frontmatter からはフラットな `vivlio-*` キーで指定する**（5.4）。`subtitle:` とだけ書いても
拾わない —— 素の `title:` だけが Obsidian のノート名と兼ねる特例である。

#### 扉の著者名は「余白で突き放す」のではなく「版面の端に寄せる」

`author` / `translator` / `publisher` は `<div class="imprint">` にまとめて出す。
扉自体を**縦方向の flex コンテナ**にし、`imprint` に `margin-block-start: auto` を与えると、
書名の長さや副題の有無にかかわらず**必ず版面の端**（縦組みなら左端）に着く。`text-align: end` でさらに地に寄せ、
縦組みでは「左下」— 日本語の扉が著者名を置く位置になる。

書名からの固定マージン（`margin-block-start: 8rem` 等）で突き放すと、書名が 2 行になった途端に位置が動く。

**【実装時の修正】`block-size: 100%` は解決しない。**
Vivliostyle は `html` / `body` に相当するボックスを内容の高さに合わせるので、
そこに対する百分率には拠りどころがない（実測: 版面 513px に対し `.titlepage` が 166px になる）。
`novel` テーマは版面のブロック方向の寸法を `--vs-novel--block-extent` として持ち
（縦組みでは `--vs-page--width`）、扉と奥付はこれを `block-size` に取る。

自動マージンを使うのは、はみ出したときの壊れ方が穏やかだから。
flexbox の自動マージンは**空きが負なら 0 として扱われる**ので、長い奥付は紙面の外に出るのではなく
単に上端から始まる。`justify-content: flex-end` にはこの保証がない。

**扉・奥付の `<p>` は本文の段落ではない。** theme-base は `p` に `text-indent` と
`text-align: justify` を当てるので、そのままでは書名が 1 字下がり、著者名は `text-align: end` を
無視する（`p` への直接指定が継承に勝つため）。前付け側で両方を打ち消す。

#### theme-base の named page にそのまま乗る

`theme-base` は DPUB-ARIA の role に応じた named page を既に持っている。
**生成する要素に `role="doc-*"` を付けるだけで、テーマ側が正しい紙面設計を当てる。**

実装済みの role: `doc-cover` `doc-toc` `doc-preface` `doc-foreword` `doc-prologue` `doc-introduction`
`doc-dedication` `doc-epigraph` `doc-afterword` `doc-conclusion` `doc-epilogue` `doc-appendix`
`doc-bibliography` `doc-glossary` `doc-index` `doc-acknowledgments` `doc-credits` `doc-errata` `doc-colophon`

例外: **扉・半扉には対応する DPUB role が存在しない。** `class="titlepage"` / `class="halftitle"` +
`epub:type="titlepage"`（EPUB の landmarks 用）を付け、named page は本プラグインの CSS で定義する。

#### 目次ページは theme-base が完成品を持っている

`css/partial/toc.css` が既にリーダー罫とページ番号を実装している:

```css
:is(#toc, [role='doc-toc']) li > a::after {
  content: leader('.') ' ' target-counter(attr(href), page, decimal);
}
```

`target-counter()`（CSS GCPM）を Vivliostyle が解決するので、**組版結果の実ページ番号が目次に入る。**
本プラグインがやることは `<nav role="doc-toc"><ol><li><a href="ch01.html#sec-1">第一章</a></li>…</ol></nav>`
という素の入れ子リストを吐くだけでよい。

- 拾う見出しレベルは `tocDepth`（既定 2 = h1, h2）で設定可能
- 目次ページ自体は目次に載せない

#### 目次に載せるもの【決定】: 目次より後ろにあるものだけ

**目次は、その先にあるものを案内する紙面である。** 目次より前に置かれた部位 ——
半扉・扉・献辞・題辞 —— は、読者がもう通り過ぎた葉であり、そこを指す行は引く先がない。
和書でも洋書でも、目次は まえがき か第一章から始まる。

したがって除外する集合は `SECTION_SLOTS`（**部位の組付け順**そのもの）から導く。
`toc` より前にある部位は、目次に着いた時点で読者の背後にある。
固定のリストを書かずに順序から導くのは、あとから前付けに部位を足したときに
**黙って目次に現れないようにする**ため。

例外が 2 つある。

- **奥付**は目次より後ろにあるが載せない。本が作り手を名乗る紙面であって、誰かが引く場所ではない
- **表紙**は部位ではなく `role="doc-cover"` で判定する

献辞と題辞を載せていたことが、目次が `iii, iv, vi, 1, 20 …` と数えるように見えた原因の半分だった
（もう半分は下記のページ番号の書式）。

**【今後の検討】ノートごとに目次から外す指定。** いまは載る・載らないが部位の組付け順で決まり、
本文の章はすべて載る。「この章だけ目次に出さない」——幕間・扉ページ代わりの短い章・
シリーズの前口上など——を書き手が選ぶ手段がない。フロントマターのキー
（`vivlio-toc-entry: false` のような）で外せるようにするかを決めること。決めるべきこと:

- 印刷の目次だけを外すのか、EPUB の `nav` からも外すのか。
  `nav` はファイル内を移動する唯一の手段なので、**そちらからは外すべきでない**（`TocAudience` の分岐と同じ理由）
- 部位（`sections`）にも同じ指定が要るか。いまの `off` は「その部位を作らない」であって
  「作るが目次に出さない」ではない
- 見出し単位まで要るか（章は載せるが節は載せない、は `tocDepth` で足りるか）

**ただし縦組みでは、テーマの完成品に手を入れる。** いずれも `novel` テーマ側の決定:

| 直すもの | 理由と手当て |
|---|---|
| ページ番号の向き | 縦組みの行の中で数字が横倒しになる。`a::after` に `text-combine-upright: all` を当てて**縦中横**にする |
| リーダー罫が行の中心に来ない | `.` はラテン文字なので縦組みでは寝かされ、点が行の片側に寄る。`leader('・')` にする（中黒は em ボックスの中央にあり、どちらの組み方向でも中心） |
| 変な位置での改ページ | theme-base は `li` を `break-inside: avoid` にする。章の `li` は**その章の節を全部含む**ので、入りきらない章が丸ごと次ページへ飛び、残りが空白になる。章の `li` だけ `break-inside: auto` に戻し、`> a` に `break-after: avoid`（章と最初の節だけは離さない） |
| 目次ページ自身のノンブル | 目次はページ番号を刷る紙面なので、そこに自分のノンブルがあると読者は誤った番号を引く。目次ドキュメントの `<html>` に `vivlio-toc` を付け、`:root.vivlio-toc { --vs-page--mbox-visibility: hidden }` で消す |
| 前付けの項目のページ番号 | 下記「目次のページ番号は紙面の刷り方に従う」 |

**【決定】目次より前の紙面はノンブルを刷らない。** 目次に載らない紙面（半扉・扉・献辞・題辞）は
読者が引く先ではないので、番号を刷る意味がない。和書はそこに柱もノンブルも置かない。
`sectionCss` が `@page titlepage, halftitle, dedication, epigraph, colophon` にまとめて
`--vs-page--mbox-visibility: hidden` を当てる（献辞・題辞の名前付きページは theme-base が
DPUB role から与えているので、名前を並べるだけでよい）。奥付が同じ扱いなのは前からで、理由も同じ。

階層は字送りではなく**字下げ 1 字と太さ**で示す。段階的に級を落とすと、目次の行が本文の行送りの
グリッドから外れて章と節の縦位置が揃わなくなる。

**【実装時の修正】罫と番号は 1 つの `a::after` から出したままにする。**
番号だけを別の要素に出せば `text-combine-upright` を番号に限定できる、と考えるのは誤り。
Vivliostyle のリーダーは**同じ疑似要素の中にある後続内容**を測って伸び幅を決めるので、
番号を外に出すと罫が行いっぱいに伸び、番号が次の行に落ちる（実測）。
`text-combine-upright` が罫を巻き込む心配は要らない ——
Vivliostyle の UA スタイルシートが、罫を包む span に `text-combine-upright: none` を当てている。

**【実装時の修正】`@page toc-document` は使えない。**
theme-base は `body:has([role='doc-toc'])` でこの名前付きページを当てるが、これは効かなかった（実測）。
ルート要素のクラスから `:root.vivlio-toc` で指定する。
なお `@page` の中の宣言はルートから継承した変数に優先するので、
`@page titlepage` のようにプラグインが名前付きページに書く指定はそのまま効く。

#### 目次のページ番号は紙面の刷り方に従う【決定】

theme-base は目次のページ番号を `target-counter(attr(href), page, var(--vs-toc--page-counter-style))`
で出す。この変数は `:root` に 1 つあるだけなので、**前付けの行まで算用数字で刷られる。**
`roman-then-arabic` では前付けの紙面には `iii` と刷ってあるのに目次は `3` と載り、
献辞・題辞・まえがきを入れた本の目次が `3, 4, 6, 1, 20, …` と数えるように見える（実測）。

カウンタは前付けも本文も同じ `page` で、**違うのは書式だけ**なので、行ごとに書式を決める。
`buildTocEntries` が各項目に前付けかどうかを持たせ、`renderList` が前付けの `li` に
`vivlio-toc-front` を付け、生成 CSS が

```css
:is(#toc, [role='doc-toc']) li.vivlio-toc-front > a {
  --vs-toc--page-counter-style: lower-roman;
}
```

を書く。**`li` ではなく `> a` に当てる。** 本文の見出しは直前の部位の `li` の中に入れ子になる
（`nest()` はレベルだけを見る）ので、`li` に当てるとカスタムプロパティが継承して
本文全体がまえがきの書式を引き継ぐ。

`none` のときは紙面にノンブルがない。指す先のない番号を目次だけが載せても引けないので、
`li > a::after { content: none }` で罫ごと消す。`continuous` は前付けも本文も同じ書式なので何もしない。

#### ノンブル（ページ番号）

`pageNumbering` で選ぶ。既定は商業出版の慣習に合わせた `roman-then-arabic`。`vivlio.yaml` / frontmatter の両方から指定できる。

| 値 | 挙動 |
|---|---|
| **`roman-then-arabic`（既定）** | 前付けは `i, ii, iii…`、本文先頭で `1` にリセット |
| `continuous` | 最初から通しのアラビア数字 |
| `none` | ノンブルを出さない（`--vs-page--mbox-visibility: hidden`）。目次もページ番号を載せない |

- **表紙は数えないのが本来だが、いまは数えられている**（5.9 の【誤り・未解決】）。
  前付けのノンブルが 1 つずつ後ろにずれ、PDF のページラベルとも食い違う
- 前付けのローマ数字は `@page` の名前付きページに `counter(page, lower-roman)` を当て、
  本文先頭の章に **`counter-reset: page 1`** を置く。
  **【実装時の修正】** vivliostyle-cli の `startPage` は「`counter-reset: page [値 - 1]`」と等価だと
  説明されるが、要素に直接書く場合は挙動が違う。Vivliostyle はページのカウンタを増やした**後**に
  要素の `counter-reset` を適用するため、`0` と書くと本文 1 ページ目のノンブルが 0 になる（実測）
- **PDF のページラベルも合わせる。** ビューアのページ番号表示が `i, ii, iii, 1, 2…` になるよう、
  `pdf-lib` で `/PageLabels` を書き込む（vivliostyle-cli の `pdf-postprocess.ts` と同じ処理）

**【未実装】`startPage` はどこからも読まれていない。** 本文のノンブルを何番から始めるかの設定で、
型（`BookConfig.startPage`）・スキーマ・数値への強制・設定ウィザードの入力欄・
`vivlio.yaml` のコメント・マニュアル・README のすべてに載っているが、
**値を使うコードが一行も無い。**
`build/pipeline.ts` が章に持たせる `startPage` は `config.startPage` ではなく
「一章目か、かつ `roman-then-arabic` か」という真偽値相当の 1 で、
`pageNumberingCss` が書く `counter-reset` も定数 `1` である。
`startPage: 5` と書いても本文は 1 から始まる。実装のない設定はそれ自体が誤解なので、
**使うか消すかを決めること。** 使う場合に決めるべきこと:

- `continuous` / `none` のときにも効かせるか（いまは `continuous` にも page-reset が出ている）
- PDF のページラベル（`export/pdfPostprocess.ts`）の開始番号を合わせる
- `counter-reset` は**ページのカウンタを増やした後**に適用されるので、書く値がそのまま刷られる番号になる
  （上の実装時の修正と同じ理由。`0` と書くと 1 ページ目が 0 になるのとは逆に、`5` と書けば 5 が刷られる）

#### ノンブルと柱の位置（`novel` テーマ）

**ノンブルは小口側の地に置く。** 右ページの小口は右、左ページの小口は左なので、
`@page :right` は `@bottom-right`、`@page :left` は `@bottom-left` に出す。
名前付きマージンボックスが左右で変わるため、**書式は `--vivlio-folio` という 1 つの変数に持たせ、
`@page` 側はその変数を読むだけにする。** 前付けのローマ数字はこの変数を差し替えて実現する。

ノンブルの位置はテーマの決定なので、プラグイン側にテーマ名を書かない。
**テーマは「自分でノンブルを置いた」ことを `--vivlio-folio-own-box: none` で申告し**、
プラグインは `--vs-page--mbox-content-bottom-center: var(--vivlio-folio-own-box, counter(page, lower-roman))`
と書く。申告のないテーマ（`bunko` 等）では従来どおり地の中央にローマ数字が出て、
`novel` では中央には出ない（さもないと前付けのノンブルが 2 か所に刷られる）。

**柱は左右で中身が違う。** 右ページに書名、左ページに章題。開いた本が「何の本か」と
「どこを読んでいるか」の両方に一度に答える、日本語の小説でよくある配り方。

- 章題は**ドキュメントが章に使っている見出しレベル**から取る。
  どのレベルかは原稿による: 1 章 1 ノートのフォルダ本は h1 で章を開き、
  1 ノートで書かれた本は h1 を書名に使い（それは書名なので落とされる）章は h2 で走る。
  **残った見出しのうち最も浅いレベル**がどちらでも章を名乗っている。
  プラグインがそのレベルの見出しに `.vivlio-chapter-title` を付け、テーマがそれを拾う。
  全レベルを拾ってはいけない —— 節のある章では**最後に組まれた節の見出し**が柱に出てしまう
- **見出しをひとつも残さない章のために、ドキュメントに自分の名前を名乗らせる。**
  地の文で始まるノートは見出しから取れず、**左ページの柱だけが消える。**
  プラグインは**そういうドキュメントに限って**最外の `<section>` に
  `data-vivlio-chapter="章題"` を付け、テーマが
  `[data-vivlio-chapter] { string-set: vivlio-chapter attr(data-vivlio-chapter); }` で拾う。
  見出しのある章には付けない —— 付けると `string()` が既定で「ページ開始時の値」を取るため、
  章の先頭ページだけ見出しではなくドキュメント名が柱に出る
- **書名は `string()` では取れない**（本文中にそう名乗る要素がない）。
  プラグインが `--vivlio-book-title` として CSS 変数で渡す（`bookStylesheet`）
- **柱は本文だけに出す。** 前付け・奥付・表紙に出すと、直前に設定された章題が残って
  無関係な柱が刷られる。本文のドキュメントには `<html class="vivlio-body">` を付け、
  `:root.vivlio-body` でだけ柱の中身を定義する
- **章の始まりのページも柱を出す。** `string(…, first-except)` は章題を組んだページの柱を
  落とすが、そうすると本文 1 ページ目だけ柱がない紙面になる

#### EPUB での扱い

- 各部位を `nav` の landmarks に `epub:type`（`titlepage` / `toc` / `preface` / `colophon` 等）で登録する
- **副題・叢書名・訳者は OPF のメタデータにも入れる。** 副題は `title-type: subtitle` で修飾した
  2 つ目の `dc:title`、叢書名は `belongs-to-collection`、訳者は MARC の役割コード `trl` を付けた
  `dc:contributor` —— EPUB がそれぞれを言うための言い方である
- **目次ページ（`auto` 生成分）はそのまま `<nav epub:type="toc">` として EPUB の目次に流用できる。**
  ただし EPUB はリフロー型でページ番号を持たないので、`target-counter()` による番号は EPUB 用 CSS で消す
- **`nav.xhtml` は目次ページと同じエントリから作り、`tocDepth` までの見出しを入れ子で並べる。**
  章ドキュメントの一覧にしてはいけない。単一ノートを書き出すと本全体が 1 ドキュメントになるため、
  それでは目次が 1 行だけになりリーダーから本文を辿れなくなる
- **見出しの余白がテーマ側で 0 の場合、EPUB 用 CSS で補う。**
  `theme-bunko` は `--vs-spacing-rlh: 0` として余白を消し、行取り（`--vs--h3-line-height` 等）で
  見出しを表現する。これは紙面の設計であり、リフローすると行取りが効かず切れ目が消える。
  `--vs--h*-margin-block` を補うのは**テーマが余白を 0 にしている場合だけ**とし、
  `techbook` の行送りや `academic` の明示指定は触らない

**【実装時の修正】EPUB に同梱するテーマは、プレビューと同じ引き方で探す。**
テーマ名から `@vivliostyle/theme-<名前>/theme.css` を組み立てて探していたため、
プラグイン自身の `novel`（`vivlio/novel.css` にある）は**必ず見つからず `bunko` に落ちていた。**
テーマが持つ規則 —— 奥付の版面、傍点のサイズ、目次のリーダー —— がまるごと EPUB から欠ける。
`bundledThemePath()`（`themeUrlFor` と同じ関数）で引くこと。

**紙面のための指定は EPUB 用 CSS で戻す。** リフロー型のリーダーには紙がないので、
紙前提の値はそのままでは害になる:

| 戻すもの | 理由 |
|---|---|
| ルートの `font-size` 宣言を**消す** | 本文サイズは用紙から逆算した mm 値（5.10）。リーダーでは**読者が決めるもの**である。**値を上書きするだけでは足りない** —— カスケードでは作者スタイルシートが読者スタイルシートに優先するので、`html { font-size: … }` が残っているかぎりリーダーの文字サイズ設定は効かない（実測）。宣言そのものを消し、ルートにはリーダーが与えたサイズを持たせる。テーマの `rem` は全部それに追随する |
| 扉・奥付の `display` / `block-size` | どちらも「1 ページを満たす」ための指定（`block-size: var(--vs-novel--block-extent)` + flex の自動マージン）。リーダーの段では**隅の小さな箱**になる。`display: block` / `block-size: auto` に戻し、自動マージンの代わりに実寸の余白を与える |
| `p.vivlio-no-indent` を再掲 | 字下げしない段落（5.3 #16）。リーダーは独自の段落スタイルを足しがちなので、EPUB 用 CSS の最後にもう一度書いて確実に後ろに置く |

### 5.12 ローカル HTTP サーバのセキュリティとライフサイクル

プレビューのために **Vault の中身を `127.0.0.1` で HTTP 配信する**（3.2、5.8(2)）。
これは事実上「Vault をローカルネットワークに露出する」ことなので、防御を仕様として明記する。

#### 脅威

- 同じ PC 上の**任意のプロセス**が `127.0.0.1:<port>` を総当たりして Vault を読み出せる
- ブラウザで開いている**任意の Web ページ**が `fetch('http://127.0.0.1:PORT/...')` を投げられる
  （レスポンスは CORS で読めないが、DNS リバインディングで同一オリジンに偽装されると読める）

#### 対策【決定】

1. **`127.0.0.1` にのみバインドする**（`0.0.0.0` にしない）。ポートは OS 任せのエフェメラルポート
2. **セッションごとのランダムトークン（32 hex）を URL パスの先頭に必須とする。**
   `http://127.0.0.1:PORT/s/<token>/...`。トークンが違えば即 404（403 にしない＝存在を漏らさない）
3. **`Host` ヘッダが `127.0.0.1:<port>` であることを検証する**（DNS リバインディング対策）
4. **CORS ヘッダを一切返さない。** `Access-Control-Allow-Origin` を付けない
5. **配信ルートのホワイトリスト**を持ち、正規化後の絶対パスがその配下にあることを検証する
   （`..` / シンボリックリンク / Windows の `\\?\` 表記を潰してから比較）。ルートは
   Vault ルートと `embedFonts` で明示された Vault 外の絶対パスのみ
   （**【実装時の修正】** ワークスペースはディスク上に存在しないのでルートに含めない → 下記）
6. **GET / HEAD 以外は 405**
7. トークンはログにも書かない

#### 原稿の中のスクリプト【決定】: 二重に止める

VFM は `rehype-raw` を通すので、ノートに書かれた HTML はテキストではなく**本物の要素**として
ツリーに入る。インラインの `<span>` が効くのはそのためであり、`<script>` が入ってくるのも
同じ経路である。

そして Vivliostyle は、**組版対象の文書に含まれるスクリプトを既定で実行する**
（`allowScripts` の既定値が `true`）。プレビューの iframe も PDF 書き出しの webview も
同じビューアなので、放っておくと「ノートに `<script>` と書けば動く」ことになる。
Obsidian 自身の読み取りビューは script を落とすから、**組版経路のほうが緩い**という
逆転が起きていた。

対策は 2 段構えとする。どちらか一方では足りない。

1. **ビューアに `allowScripts=false` を渡す**（`server/static.ts` の `bookViewerUrl`）。
   ビューア側の鍵で、プレビューと書き出しの両方に効く
2. **組版ツリーから実行される部分を落とす**（`build/hast/sanitize.ts`）。
   `script` / `iframe` / `object` / `embed` の各要素、`on*` 属性、
   `javascript:` `vbscript:` `data:text/html` の URL、`srcdoc`。
   落としたことは警告として書き手に返す

2 が本命である。**EPUB はこの家を出ていく**からで、それを開くリーダーが何を実行するかは
こちらの決められることではない。1 はこちらの手元にある間だけの鍵にすぎない。

スキームの比較は、空白と制御文字を取り除いてから行う。ブラウザがそう読むためで、
`java&#9;script:` はリンクを解決する側にとっては 1 語である。

さらに **3 段目として、埋め込む前のビューアそのものから該当コードを外す**
（`esbuild/viewer-patch.mjs`）。対象は 2 か所で、どちらもここでは到達しない。

1. 同梱 Knockout のタスクスケジューラの **IE 用ブランチ**。
   `MutationObserver` があれば最初の枝が選ばれるので、Chromium では一度も通らない
2. **公開物のスクリプト実行器**。`allowScripts=false` によって関数の 1 行目で戻るため、
   その先は実行されない

動作は変わらない。変わるのは、**バンドルを読む者（人でもスキャナでも）に見えるもの**と、
「設定で戻せる無効化」が「そもそも無い機能」になることである。パターンは literal 一致で、
見つからなければ**ビルドを失敗させる**。ビューアを上げたときに、無言で元のコードを
出荷し直すのが唯一避けたい失敗だからである。パッチ後は `vm.Script` で構文検査もする。

AGPL-3.0 の著作物への改変にあたるので、NOTICE に改変した旨を明記する。

**副作用はない。** 数式は VFM が Temml で MathML に落とすので静的であり、MathJax は使っていない。
`server/keepPage.ts` が差し込むスクリプトはビューア自身の HTML に入るもので、
`allowScripts` の管轄（組版対象の文書）の外にある。

#### ライフサイクル

- サーバは**プレビューが開いている間、または書き出しが走っている間だけ**起動する。
  最後のプレビューペインが閉じ、書き出しも走っていなければ停止する
- `onunload` で確実に `server.close()` + 全接続の destroy（Obsidian のプラグイン無効化・再読み込みで残らないように）
- **【実装時の修正】ワークスペースはディスクではなくメモリに置く。**
  `<plugin>/.cache/build/<セッションID>/` に作る案は、生成物（HTML・CSS・publication.json）が
  高々数十 KB でしかないのに、書き込み・掃除・クラッシュ時の残骸という後始末を丸ごと抱え込む。
  生成物は `Map<パス, 内容>` に持ってサーバから直接返し、画像・フォントは Vault から
  ストリーム配信する（→ 5.8(2)）。**古いセッションの掃除処理は不要になる**
- サーバの起動・停止は**利用者数の参照カウント**で決める。
  再ビルドのたびに数えると停止しなくなるので、プレビューペインが持つ参照は 1 つに固定する
- 同時に複数のプレビューを開いた場合は**サーバは 1 つ、ワークスペースは本ごと**に分ける
  （URL の `/w/<ワークスペースID>/` で分離する）
- 書き出し中の再ビルド要求はキューイングせず、**後勝ちで前のビルドを `AbortSignal` で中断する**
- 長い本のビルド・PDF 生成は `Notice` に進捗を出し、**キャンセルできるようにする**（`AbortController`）

#### エラーハンドリング

| 失敗 | 挙動 |
|---|---|
| ノートの解決失敗（リンク切れ・画像なし） | 該当箇所にプレースホルダを置いて**ビルドは続行**し、書き出し前チェックに一覧で出す |
| VFM のパースエラー | 該当章のみエラーページに差し替えてビルド続行。プレビューにファイル名と行番号を出す |
| `printToPDF` の失敗・タイムアウト | `Notice` にエラー、webview を破棄して再試行可能な状態に戻す。既定タイムアウト 120 秒 |
| ポート取得失敗 | 3 回リトライして諦め、プレビューを開かずエラー表示 |
| 書き出し先が書き込み不可 | 保存前に検査し、保存ダイアログにフォールバック |

---

## 6. 実装フェーズと工数目安

| Phase | 内容 | 目安 |
|---|---|---|
| **0. PoC** | ローカル HTTP サーバ + iframe に `@vivliostyle/viewer` を載せ、VFM 出力の単一ノートを `bunko` で縦組み表示。非表示 webview から `printToPDF` して同じ紙面の PDF が出ることまで確認 | 0.5〜1 日 |
| **1. MVP** | プレビュー ItemView（自動更新）、テーマ 4種、**3 層の設定解決 + `vivlio.yaml` + 設定ウィザード（5.4）**、設定タブ、**単一ノート + フォルダ本 / 目次ノートからの複数章**、章間リンク解決、アセット収集、**OS 横断フォントスタック（5.10）**、PDF 書き出し | 8〜10 日 |
| **2. 記法・造本・EPUB** | 5.3 の前処理一式（傍点・ルビ・縦中横・ハイライト 4 モード・callout・チェックボックス）、`MarkdownRenderer` 連携（Dataview / mermaid）、**表紙（5.9）**、**前付け・後付け・目次ページ・ノンブル（5.11）**、**`embedFonts` の `@font-face`（5.10）**、EPUB 出力（リフロー型・表紙付き） | 7〜9 日 |
| **3. 仕上げ** | PDF 栞・メタデータ・**ページラベル（`/PageLabels`）**、トンボ / 塗り足し、**書き出し前チェック（画像 dpi・フォント存在・表紙の縦横比）**、i18n（日英）、CLI 併用（press-ready / CMYK） | 3〜5 日 |

合計 **18〜24 日**（実働）。**Phase 0 が通れば残りは定型作業**なので、まず PoC を最優先で作る。

Phase 1 にフォルダ本を含めた判断により、Phase 1 の時点で以下が必要になる:
`metadataCache` によるリンク解決、章間の相互リンク書き換え、`publication.json` 生成、
目次ノートからの spine 構築、章をまたぐページ番号の通し。ここが Phase 1 のリスク集中点。

---

## 7. Phase 0 の受け入れ条件

1. Obsidian のペイン内に、`theme-bunko` で縦組みされた本文がページ単位で表示される
2. ページ送りができ、行末の句読点ぶら下げ・和欧文間アキが効いている（= Chromium 単体では出ない組版になっている）
3. ルビ `{漢字|かんじ}` が縦組みで正しく振られる
4. 非表示 webview からの `printToPDF({preferCSSPageSize:true})` で、
   画面と同じページ分割・同じ紙面サイズの PDF が保存できる
5. Vault 内の画像 `![[fig.png]]` がプレビュー・PDF 双方に出る

---

## 8. 決定事項一覧

| # | 項目 | 決定 | 参照 |
|---|---|---|---|
| 1 | ライセンス | **AGPL-3.0 で公開**。core / viewer を同梱する | 3.1 |
| 2 | EPUB | **Phase 2 でリフロー型のみ**。固定レイアウトは作らない | 3.3 |
| 3 | ビューア UI | **`@vivliostyle/viewer` の prebuilt を同梱**（自前 UI は作らない） | 5.2 |
| 4 | MVP スコープ | **フォルダ本・複数章まで Phase 1 に含める** | 6 |
| 5 | 章の順序 | **目次ノートの `[[リンク]]` 順を優先、無ければファイル名の自然順** | 5.2 |
| 6 | ルビ記法 | **VFM 標準 `{漢字\|かんじ}` + 青空文庫 / カクヨム式の両対応。** カクヨム式は `｜` 有りと**無し（`漢字《かんじ》`）の両方**を拾う —— 原稿はほぼ後者で書かれる | 5.3 #4 |
| 7 | 傍点 | **カクヨム式 `《《テキスト》》` に対応**。青空文庫ルビより先にパースする。**`text-emphasis` ではなくルビとして書く**（行送りを崩さないため） | 5.3 #3 |
| 8 | 縦中横 | **独自記法 `^^10^^` + 2 桁数字の自動適用**（自動は設定で OFF 可） | 5.3 #5, #6 |
| 9 | `==ハイライト==` | **4 モード選択（`boten` / `strong` / `mark` / `off`）、既定は `boten`（傍点）** | 5.3 |
| 10 | callout | **枠付きで残す**（`<aside class="callout">`） | 5.3 #10 |
| 11 | チェックボックス | **残す**（`☐` / `☑` の記号付きリスト） | 5.3 #11 |
| 12 | `#タグ` | 削除（設定で保持可） | 5.3 #12 |
| 13 | 本に含まれない `[[リンク]]` | **プレーンテキスト化** | 5.3 #9 |
| 14 | 既定テーマ | **`novel`（縦組み・文庫判、決定 37）**。内容による自動判定はしない | 5.4 |
| 15 | 脚注 | **設定タブに既定値を置く（工場出荷値 `gcpm` = ページ下）。frontmatter があれば優先** | 5.4 |
| 16 | 出力先 | **frontmatter の `output` が最優先、無ければ Vault 内の固定フォルダ（既定 `_output/`）** | 5.4 |
| 17 | 画像の幅指定 | **`![[fig.png\|300]]` の 300 は px として扱う** | 5.8(3) |
| 18 | 動的ブロック | **`MarkdownRenderer.render()` で描画して埋め込む**（Dataview / Templater / mermaid） | 5.8(8) |
| 19 | プレビュー更新 | **自動更新（デバウンス 600ms）。設定で OFF 可** | 5.5 |
| 20 | UI 言語 | **日英両対応**。自前の i18n 辞書、フォールバックは英語 | 5.5 |
| 21 | プラグイン | **id: `vivlio` / 表示名: `Vivlio`** | 5.1 |
| 22 | 表紙 | **`coverPage`（ノート）> `cover`（画像）> なし。theme-base の `role="doc-cover"` 機構に乗る** | 5.9 |
| 23 | フォント | **同梱しない。PC のインストール済みフォント（名前指定）+ フォントファイル（`@font-face`）の両対応。テーマの CSS 変数を上書きする形で指定** | 5.10 |
| 24 | フォント選択 UI | **`queryLocalFonts()` でインストール済みフォントのドロップダウンを出す**（Electron では権限プロンプトなしで使える）。手入力は事故るため | 5.10 |
| 25 | 前処理の実装方式 | **文字列正規表現置換をせず、木に対する変換として書く。** `editPlugins` に載せる方針は変えないが、**`replace` オプションは使わない**（既定 ignore に `code` / `pre` が無く、コードブロックを汚すため）。同等の置換パスを自前で持ち、ignore を広げる | 5.3 |
| 26 | サーバのセキュリティ | **127.0.0.1 バインド + セッショントークン必須 + Host 検証 + 配信ルートのホワイトリスト。** プレビュー / 書き出し中のみ起動 | 5.12 |
| 27 | 前付け・後付け | **部位ごとに `auto` / ノートパス / `off` を選ぶ。** 順序は正準順で固定。`auto` 可能なのは半扉・扉・目次・奥付の 4 部位のみ。**部位に指定したノートは本文の章から外す** | 5.11 |
| 28 | 設定の置き場所 | **3 層（設定タブ / `vivlio.yaml` / frontmatter）。frontmatter はフラットな `vivlio-*` キーのみ**（Obsidian の Properties UI が入れ子 YAML を編集できないため） | 5.4 |
| 29 | 設定の生成 | **手書きさせない。** ウィザード（`vivlio.yaml` 生成）/ スニペット挿入 / 全キー版リファレンス出力 の 3 入口。ウィザードは**全キーを書くが、既定値のままのキーはコメント行**にする | 5.4 |
| 30 | ノンブル | **`pageNumbering` で選択。既定 `roman-then-arabic`**（前付けはローマ数字、本文で 1 に戻す） | 5.11 |
| 31 | 前処理の実行順 | **`mdast → リンク・画像（H）→ 文字装飾（R）`。** 5.3 の表の番号順ではない（自動縦中横が `[[02]]` を壊すため） | 5.3 |
| 32 | ワークスペース | **ディスクではなくメモリに持つ。** 生成物はサーバから直接返し、画像は Vault からストリーム配信する。書き出し時もコピーしない | 5.8(2), 5.12 |
| 33 | print メディア | **CDP アタッチ（`Emulation.setEmulatedMedia`）で行う。** 失敗しても書き出しは続行し、「画面用スタイルが混じる可能性がある」と警告する | 3.5 |
| 34 | 字下げ | **`paragraphIndent` を設定キーとして持つ**（3 層すべてから指定可）。見出しの余白のような好みの調整は設定タブの「追加 CSS」に寄せ、キーを際限なく増やさない | 5.4, 5.10 |
| 35 | ビューアの URL | **`#src=` に渡す URL をパーセントエンコードしない。** ビューアは `src` をデコードせず相対パスとして解決するため、エンコードすると `viewer/` 配下を探して 404 になり、`readyState` が `loading` のまま止まる。URL の組み立ては `PreviewServer.bookViewerUrl()` の 1 箇所に集約する | 5.2 |
| 36 | 本文サイズ | **判型と字詰めが揃っているときは本文サイズを用紙から算出する**（版面が用紙の 85%）。テーマの `--vs-page--width/height` は用紙ではなく版面なので触らない | 5.10 |
| 37 | テーマ | **`theme-base` の上に独自テーマ `novel` を作り、既定にする。** `theme-bunko` は「ノンブルと柱を天に置き柱に書名を出す」「見出しを行取りだけで表現する」「行頭を版面外にぶら下げる」など、日本語の本づくりで最も細かく決めたい部分を固定している。変数の上書きで打ち消し続けると、プラグインが「テーマの決定を取り消す規則」の山を抱え、別テーマを選んだ利用者には別の結果が出る | 5.10 |
| 38 | 柱とノンブル | **柱は右ページに書名・左ページに章題、ノンブルは小口側の地**（右ページは右下、左ページは左下）。書名は `string()` では取れないので CSS 変数で渡し、章題は見出しから取る（見出しのない章はドキュメントに名乗らせる）。柱は本文だけに出す | 5.11 |
| 39 | 奥付 | **表組みをやめ、「シリーズ名・書名」＋ラベル付き項目行の 2 部構成にする。** 項目は `series` / `title` / `author` / `translator` / `date` / `version` / `publisher` / `printer` / `contact` / `website`、**値のない項目は行ごと出さない**。ラベルは 5em に均等割りする | 5.11 |
| 40 | 奥付の任意項目 | **ラベルごと本に書かせる**（`colophonExtra`）。装丁・校正・組版など、奥付が名前を挙げたい相手に決まった一覧はないので、固定キーを増やし続けない | 5.11 |
| 41 | 縦組みの日付 | **奥付の発行日は漢数字**（`二〇二六年九月二日`）。年は位取りせず一字ずつ、月日は数として数える。認識できない書式には触らない（`date` は自由記述） | 5.11 |
| 42 | 字下げ | **どの段落を下げるかは、まず原稿に訊く。** 全角スペースで始まる段落が 1 つでもあれば、その原稿は自分で決めているとみなして従う。1 つもなければ始め括弧の段落だけ外す。`paragraphIndentMode` で直接指定もできる | 5.3 #16 |
| 43 | 字詰め・行数の既定値 | **書籍が指定しなければテーマの既定グリッドで埋める**（`novel` = 40字×16行）。テーマは自分の既定値で版面を組むので、プラグインだけが「未指定」として本文サイズを算出しないと版面が用紙からはみ出す。グリッドを持たないテーマは対象外 | 5.10 |
| 44 | EPUB のテーマ | **プレビューと同じ引き方で書籍のテーマを同梱する。** そのうえで紙前提の指定（ルートの `font-size`、扉と奥付の固定寸法）を EPUB 用 CSS で戻す。**文字サイズは値の上書きでは足りず、宣言を消す**（作者スタイルが読者スタイルに優先するため） | 5.11 |
| 45 | 強制改ページ | **`［＃改ページ］`**（青空文庫式）と **`===`**（でんでんマークダウン式。前に空行が要る）。改ページ用の空要素は置かず、**直後のブロックにクラスを付ける** —— 高さ 0 のブロックはページを消費しないので、そこに改ページを持たせると組版が終わらない | 5.3 #17 |
| 46 | 自作テーマ | **Vault の .css をテーマにできる。** 同梱テーマを土台にするための綴り `@import url("vivlio:novel")` を用意し、**使う前に 1 枚へ解決してワークスペースに置く**（プレビューと EPUB が同じものを読むため） | 5.10 |
| 47 | 連続する空行 | **3 行で 1 行アキ**（`n` 行 → `n - 2` 行）。パーサの行番号から数え、**マージンで空ける**（空要素は #17 と同じ理由で使えない） | 5.3 #18 |
| 48 | 柱の章題 | **ドキュメントが章に使っている見出しレベル**（残った見出しのうち最も浅いもの）から取る。h1 固定では、書名を h1 に使い章を h2 で走る 1 ノートの本で書名が左ページの柱に出る | 5.11 |

## 9. 残っている穴

**着手前に決めるべきものは残っていない。** 以下は実装しながら決めればよい。

- [x] `emulateMediaType('print')` 相当 → **CDP アタッチで実装**（決定 33）。
      `@media print` の書き換え注入は、消したいのが `@media screen` 側のルールなので効かない
- [x] テスト方針 → **変換パイプライン・設定解決・章順・ローカルサーバを、Obsidian API のスタブを噛ませて
      Node 上で実行する**（`test/`）。PDF / EPUB / プレビューは Electron と DOM に依存するため実機確認に回す
- [ ] 脚注番号を章ごとにリセットするか通しにするか（`gcpm` ならページ下なので章ごとが自然）
- [ ] 大きな本でのプレビュー再組版の粒度（章単位の差分更新をどこまでやるか）
- [ ] 設定スキーマのバージョニングとマイグレーション方針
- [ ] **ノートごとに目次から外す指定**（5.11）。いまは部位の組付け順だけで決まり、本文の章は必ず載る。
      フロントマターのキーで外せるようにするか、外すのは印刷の目次だけにするか
- [ ] 章ごとに 1 ドキュメントを生成しているため、**章をまたぐ脚注番号・相互参照の通し**は Vivliostyle の
      publication 単位の解決に委ねている。長い本での挙動は実機で確認が必要

---

## 10. 実装状況（0.4.0）

### 実装済み

Phase 0〜2 の全項目と、Phase 3 のうち PDF の栞・メタデータ・ページラベル、トンボ / 塗り足し、
書き出し前チェック、i18n（日英）。

0.1.0 以降に入ったもの:

| 版 | 入ったもの |
|---|---|
| 0.1.1〜0.1.3 | コミュニティプラグイン審査への対応（同梱ビューアから script を組み立てる経路を削り、原稿がコードを走らせないようにし、審査の指摘どおりの API に載せ替えた）。VFM の推移的依存 3 つを勧告済みの版へ |
| 0.2.0 | **`manual` テーマ**（横組み・マニュアル / 技術書）と、そのプリセット。日本語マニュアル（`manual/`）。連続する空行が段落間のアキを置き換えず、上乗せされるように。横組みの奥付の日付 |
| 0.3.0 | 設定ウィザードが**本の設定の全キー**を尋ね、既定のままのキーもコメント行として書き出すように |
| 0.4.0 | `=` だけの行を改ページとして読む記法。**B6 / 四六判 / A5 の縦組みプリセット** |
| （未リリース） | **`novel-2col` テーマ**（縦組み二段組）と新書 / B6 / A5 のプリセット、`columns` キー。**目次のページ番号が紙面の刷り方に従うように**（前付けはローマ数字、`none` では番号を載せない） |

### 未実装

- **Phase 3 の CLI 併用（`--preflight press-ready` / CMYK 変換）。**
  かつて設定タブに「`vivliostyle` CLI のパス」の項目だけ置いてあったが、`child_process` の呼び出しは
  一行も書かれておらず、入力しても何も起きない欄だった。実装のない設定はそれ自体が誤解なので外した。
  実際に呼ぶときに、そのとき必要な形で足す
- **上流の同梱テーマ。** `bunko` / `techbook` / `academic` / `base` は埋め込みも名前の解決も
  生きているが、プラグインの版面・ノンブル・見出しアキを突き合わせてあるのは
  このプラグイン自身の `novel` / `novel-2col` / `manual` だけなので、上流の 4 つは選択肢に出さない
  （`SELECTABLE_THEMES`）。同じ理由で技術同人誌 / 論文のプリセットも外してある
  （文言だけは `preset.techbook` / `preset.academic` として i18n に残っている）
- **フォントフォルダの走査。** 設定タブの「フォントフォルダ」（初期値 `fonts`）は
  `@font-face` を自動生成すると説明しているが、`fontFolder` を読むコードは設定タブ以外に無い。
  実際に `@font-face` を作るのは `vivlio.yaml` の `embedFonts:` に明示列挙した分だけ
  （`build/fonts.ts`）。既定値を Vault 内の普通のフォルダに変えるところまでは済んでいる
  （`.obsidian/` 配下はドットフォルダなので Vault の索引に載らず、`vault.getFiles()` で見つからない）。
  残っているのは:
  - 指定フォルダの `.woff2` / `.otf` / `.ttf` を拾って `@font-face` を組み立てる
  - **フォントファイルもファイルエクスプローラーに表示する。** `vivlio.yaml` と同じ問題で、
    拾う対象が書き手に見えなければ、フォルダに入れた・入れていないの確認ができない。
    `claimExtensions()` がいま名乗っているのは `yaml` / `yml` / `css` / `epub` なので、
    ここに `woff2` / `otf` / `ttf` を足し、ビューは
    書体見本（その書体で組んだ数行）と外部アプリで開くボタンにする
- **画像の `width` / `height` 属性**（5.8(5)）。intrinsic size は組版前に読んであるので
  （`build/imageSizes.ts`）、残っているのは属性を書くところだけ。入れば画像の到着前に
  アスペクト比が確定し、レイアウトが 1 パスで決まる
- **EPUB のフォントサブセット化**（3.3 / 5.10 のとおり Phase 3 以降の課題）
- **表紙が通しページに数えられている**（5.9）。前付けのノンブルが 1 つずつ後ろにずれ、
  PDF のページラベルとも食い違う。`counter-reset: page` を効かせる方法が 5 通り試して見つかっていない。
  **目次より前の紙面がノンブルを刷らなくなった（下記）ので、いま目に見えるずれは
  「まえがき」以降の前付けだけ**になったが、直ってはいない
- **本文の裁ち落とし**（5.9 の【未解決】）。塗り足しを指定しても、紙の端まで届くのは表紙だけで、
  本文の画像も地色も版面の内側で止まる
- **段組を組めるのは `novel` 系のテーマだけ。** `columns` は本の設定として 3 層すべてを通るが、
  それを読むのは `novel` / `novel-2col` だけで、`manual` や余白組みの自作テーマでは何も起きない。
  グリッドを持たないテーマに段組の版面を組ませる筋道が要る
- **`startPage`（本文のノンブルの開始番号）。** 設定としては 3 層すべてに通っていて、
  ウィザードの入力欄もマニュアルの記載もあるのに、**値を読むコードが無い**（5.11）。
  `startPage: 5` と書いても本文は 1 から始まる。実装のない設定は
  「`vivliostyle` CLI のパス」の欄と同じたぐいの誤解なので、使うか消すかを決めること
- **プレビューの位置復元を、遅延組版でも正確にする。** 再ビルドはフレームの `src` を差し替える
  ので、ビューアは先頭から始まる。ページを覚えて戻す仕組みは入っている（`server/keepPage.ts`）が、
  正確なのは全ページ組版のときだけ。`renderAllPages` が無効だと、ビューアは位置を
  「まだ組まれていない本に対する推定値の小数」として返し（8 ページ目に対して 6.91）、
  その推定値は組版が進むと動く。同じ数値が再ビルドの前後で 8 ページ目と 10 ページ目を指した（実測）。
  - 全ページ組版を強制すれば正確になるが、それは `renderAllPages` という設定が答えるべき問いで、
    この経路が勝手に決めてよいことではない
  - ページ番号ではなく本文中の位置で戻すほうが、そもそも意味として正しい。編集で行が増えれば
    ページ番号は動くが、読んでいた文章は動かない。`nav` の payload は CFI を返しており
    （`epubcfi(/8!/4/2[vivlio-start]/10/6)`）、`navigateToPosition({spineIndex, offsetInItem})` もある。
    ただし **CFI を受け取る公開 API が無く**、`nav` が返す情報から `offsetInItem` を導く道も
    見つかっていない。ここが解ければ全ページ組版は要らなくなる
  - 決めること: 遅延組版のときに「近似で戻す」「戻さない」「設定で選ばせる」のどれにするか

### 検証の範囲

`npm test` が Node 上で確認しているもの（Obsidian API はスタブ）:

| 対象 | 内容 |
|---|---|
| 変換パイプライン | 5.3 の記法一式が期待どおりの HTML になること。**コードブロックが無傷であること** |
| 生成 CSS | テーマの `@import`、書字方向・判型・傍点スタイルの変数 |
| 版面の逆算 | 字詰め・行数・**段数**から出した本文サイズが用紙に収まること。テーマの既定グリッドで埋まること。グリッドを持たないテーマには手を出さないこと |
| 前付け・後付け | 扉の imprint の入れ子、奥付の日付（漢数字 / 和暦）、目次の入れ子と `tocDepth`、2 つの読み手（印刷 / EPUB nav）の出し分け |
| ノンブルと目次 | 前付けの行がローマ数字で刷られること、その指定が入れ子の本文に漏れないこと、`none` では目次も番号を載せないこと |
| EPUB | 梱包した CSS が紙面用の指定を落としていること、JSZip が読める zip を作ること |
| 設定 3 層 | 優先順位、フラット `vivlio-*` キーの読み取り、型強制、未知キー警告、`auto` 誤用の検出 |
| 章順 | ファイル名の自然順、目次ノートの登場順、`vivlio-order` の差し込み |
| ローカルサーバ | トークン不一致 404 / Host 検証 / 405 / パス脱出の拒否 / CORS ヘッダ無し / 停止後に応答しないこと |

いまのところ `npm test` は 201 件を通す（`convert` / `config` / `server` の 3 ファイル）。

**実機（Obsidian 上）でしか確認できないもの:**
プレビューの iframe 表示、`printToPDF`、EPUB の XHTML 化（`DOMParser` / `XMLSerializer` 依存）、
`MarkdownRenderer` 連携、`queryLocalFonts()`、CDP アタッチによる print メディア切り替え。

**紙面そのものは `test/serve.ts` で見る。** 1 冊分を組んでローカルサーバで配り、
ビューア用と EPUB 用の両方の URL を出すので、Obsidian を立ち上げずに
ブラウザで紙面を確認できる。同梱ビューアとローカルサーバと `publication.json` が
噛み合っているかを見られるのはここだけで、二段組の版面も目次のページ番号もここで実測した。

→ 7. の受け入れ条件は通っている。次の一手は
**community.obsidian.md への登録**（Obsidian アカウントが要るのでユーザ自身の手による）。

---

## 参考

- Vivliostyle CLI: https://github.com/vivliostyle/vivliostyle-cli
- VFM 仕様（日本語）: https://github.com/vivliostyle/vfm/blob/main/docs/ja/vfm.md
- Vivliostyle 公式（日本語）: https://vivliostyle.org/ja/
- Electron `webContents.printToPDF`: https://www.electronjs.org/docs/latest/api/web-contents
- 先行実装の参考（Electron 印刷まわり）: https://github.com/l1xnan/obsidian-better-export-pdf
