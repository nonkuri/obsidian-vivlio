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
  "minAppVersion": "1.7.0",
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
| `Vivlio: このノートに設定を追加` | フラットな `vivlio-*` frontmatter を挿入（5.4） |
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
リンク・画像の記法（#8〜#12）を先に消費し、文字装飾（#3〜#7, #13, #14）はその後に適用する。
こうするとリンクの表示名の中でもルビや傍点が効くという副次的な利点もある。
表の番号は「同じ層の中での適用順」を示すものと読むこと。

| # | 層 | 入力 | 変換 | 既定 |
|---|---|---|---|---|
| 1 | M | `![[Note]]` / `![[Note#見出し]]` | ノート本文の mdast をその場に差し込む（再帰は深さ 3 まで、循環検出あり）。**非同期 transformer** | ON |
| 2 | M | ` ```dataview ` / ` ```dataviewjs ` / ` ```mermaid ` 等 | `MarkdownRenderer.render()` で描画し、生成 DOM を raw HTML ノードとして差し込む → 5.8(8)。**非同期 transformer** | ON |
| 3 | R | **`《《テキスト》》`（カクヨム式傍点）** | `<span class="boten">テキスト</span>`。**ルビより前に置く**（`《《` が `《` にマッチして壊れるため） | ON |
| 4 | R | `｜漢字《かんじ》` / `\|漢字《かんじ》`（青空文庫・カクヨム式ルビ） | `<ruby>漢字<rt>かんじ</rt></ruby>` | ON |
| 5 | R | `^^10^^`（独自・縦中横） | `<span class="tcy">10</span>` | ON |
| 6 | R | 2 桁の半角数字（縦組み時のみ） | 自動で `<span class="tcy">` を付与 | ON（設定で OFF） |
| 7 | R | `==ハイライト==` | **4 モードから選択（既定: 傍点）** → 下記 | 傍点 |
| 8 | H | `![[image.png]]` / `![[image.png\|300]]` | → 5.8 | ON |
| 9 | H | `[[Note]]` / `[[Note\|表示名]]` | 本に含まれる → `<a href="ch03.html#...">`／**含まれない → プレーンテキスト化**（表示名があればそれ、なければノート名） | ON |
| 10 | H | `> [!note] タイトル`（callout） | `<aside class="callout callout-note"><p class="callout-title">…</p>…</aside>` + テーマ CSS | ON |
| 11 | H | `- [ ]` / `- [x]`（チェックボックス） | `<ul class="task-list"><li class="task-list-item" data-checked="false">`。CSS で `☐` / `☑` を出す（`list-style: none` だとマーカーボックスが生成されず `::marker` が効かないため、実装では `::before` を使う）。`<input type="checkbox">` は除去し、PDF にフォーム部品を残さない | ON |
| 12 | H | `#タグ` | 削除（設定で `<span class="tag">` 保持） | 削除 |
| 13 | R | `%%コメント%%` | 削除 | 削除 |
| 14 | R | `^ブロックID` | 削除 | 削除 |
| 15 | — | frontmatter | Vivlio 用キー（5.4）を抜き、残りを VFM の `vfm:` に委譲 | — |

VFM 標準のルビ `{漢字|かんじ}` は VFM 自身が処理するので、本プラグインは何もしない（#4 は別記法の追加分）。

#### `==ハイライト==` の 4 モード

Obsidian のハイライトは「電子の蛍光ペン」で、紙面にそのまま黄色の地を出すと本として成立しない。
用途が人によって割れるため設定で選ばせる。

| モード | 出力 | 用途 |
|---|---|---|
| **`boten`（既定）** | `<span class="boten">` = 傍点（`text-emphasis: filled sesame`） | 小説・文芸。日本語の紙面で「強調」を表す最も自然な形 |
| `strong` | `<strong>` = 太字 | 実用書・技術書 |
| `mark` | `<mark>` のまま | 参考書・問題集など、地色を意図して使う場合 |
| `off` | 記号を外して地の文に | 読書メモの `==` を本文に持ち込みたくない場合 |

`boten` と #6 のカクヨム式傍点は**同じ `.boten` クラスに合流する**ので、テーマ側の指定は 1 箇所で済む。

```css
.boten {
  text-emphasis: filled sesame;
  text-emphasis-position: over right; /* 縦組みでは字の右、横組みでは字の上 */
}
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
author: 夏目漱石
publisher: 個人出版
date: 2026-09-01
lang: ja

# 組版
theme: bunko              # bunko | techbook | academic | base | <vault内のcssパス>
writingMode: vertical-rl  # vertical-rl | horizontal-tb
size: 文庫                # A4 | A5 | B5 | JIS-B6 | 文庫 | "128mm 188mm"
charsPerLine: 39
linesPerPage: 15
baseFontSize: 9pt
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
vivlio-theme: bunko
vivlio-size: 文庫
vivlio-footnote: gcpm
vivlio-cover: 装丁/表紙.png
vivlio-output: 原稿/出力/猫.pdf
vivlio-start-page: 1
---
```

- 対応するのは**入れ子が不要なキーのみ**。`sections` / `embedFonts` / `css` は `vivlio.yaml` 専用
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
| 1. プリセット | 文庫本（縦組み）／技術同人誌（A5 横組み）／論文（A4）／Web 小説の書籍化／カスタム |
| 2. 書誌情報 | タイトル・副題・著者・発行者・発行日（Vault 名やフォルダ名から初期値を埋める） |
| 3. 造本 | 判型・字詰め・行数・書字方向（プリセットの値を初期表示） |
| 4. 前付け・後付け | 各部位のチェックボックス。`auto` にできない部位はノート選択に切り替わる（5.11） |
| 5. 表紙 | Vault 内の画像をサジェスト付きで選択 |
| 6. フォント | `queryLocalFonts()` のドロップダウン（5.10） |

**出力は「既定値と違うキーだけ」に絞る。** 全キーを既定値のまま書き出すと、
プラグインの既定が変わっても追従しなくなり、差分も読めなくなる。

**(2) スニペット挿入 — `Vivlio: このノートに設定を追加`**

単一ノート書き出し用。カーソル位置のノートに**フラットな `vivlio-*` frontmatter** を挿入する。
挿入する項目は「最小（テーマと判型だけ）」「標準」から選ぶ。

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
| `theme` | **`bunko`（縦組み・文庫判）**。指定がなければ縦組みで組む。ノート内容による自動判定はしない（挙動が読めなくなるため） |
| `footnote` | **設定タブに既定値を置く（工場出荷値 `gcpm` = ページ下の脚注）。** 上位層の指定があればそれを優先 |
| `output` | **指定があれば最優先。** なければ設定タブの「Vault 内の固定出力フォルダ」（既定 `_output/`）に `<本のタイトル>.pdf` で書き出す。Vault 相対 / 絶対パスの両方を受ける |
| `highlight` | **`boten`** |
| `imageWidthUnit` | **`px`**（Obsidian の編集画面と見た目が一致する） |
| `paragraphIndent` | **空（テーマ任せ）。** カクヨム・青空文庫由来の原稿は段落頭に全角スペースが入っており、`theme-bunko` の `--vs--p-text-indent: 1em` と二重になる。その場合は `0` を指定する |

### 5.5 設定タブ

- **既定のプリセット**: 新規に本の設定を作るときの初期値（文庫本 / 技術同人誌 / 論文 / Web 小説の書籍化）
- **組版**: 既定テーマ（初期値 `bunko`）／既定用紙サイズ／既定書字方向／**既定の脚注モード（初期値 `gcpm` = ページ下）**／追加 CSS のパス（Vault 内）
- **フォント**: 本文／見出し／等幅を**インストール済みフォントのドロップダウンから選択**（初期値は 5.10 の OS 横断スタック）。Vault 内フォントフォルダのパス（`@font-face` を自動生成、初期値 `.obsidian/fonts`）。**指定フォントが見つからない場合に警告する ON/OFF**（初期値 ON）。EPUB にフォントを埋め込む ON/OFF（初期値 OFF、ライセンス注意書き付き）
- **出力先**: Vault 内の固定フォルダ（初期値 `_output/`）。frontmatter の `output` が優先（5.4）。書き出し後に開く ON/OFF
- **記法**: 5.3 の 15 段それぞれのトグル。`==ハイライト==` の 4 モード選択。`autoTcy` の ON/OFF
- **造本**: 前付け・後付けの各部位の既定モード（`auto` / `off`）、既定の `pageNumbering`、`tocDepth`（初期値 2）
- **プレビュー**: **自動更新 ON（初期値）／OFF**、デバウンス ms（初期値 600）、全ページ描画 ON/OFF
- **PDF**: タグ付き PDF・栞生成・メタデータ埋め込み・**画像の実効 dpi 警告の閾値**（初期値 300、0 で無効）・表紙を PDF に含める ON/OFF（初期値 ON）
- **言語**: 日本語 / English / Obsidian の設定に従う（初期値）
- **詳細**: ポート番号固定、ログレベル、`vivliostyle` CLI 併用パス（Phase 3）

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
  config/presets.ts         文庫本 / 技術同人誌 / 論文 / Web小説 のプリセット
  config/yaml.ts          ＋ vivlio.yaml の生成（ウィザード出力 / 全キーリファレンス / 相互変換）
  view/PreviewView.ts       ItemView + iframe + ビューア
  view/ExportModal.ts       出力設定モーダル + 書き出し前チェックの提示
  view/SetupWizard.ts       vivlio.yaml 生成ウィザード（5.4）
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
  build/hast/assets.ts      画像パスの書き換えと収集（rehype）
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
  util/                   ＋ tree（木の走査と置換）/ paths / async / imageSize / electron / log
  vendor/assets.ts        ＋ 埋め込みアセットへの入口（下記）
test/                     ＋ Obsidian API のスタブと、Node 上で走る検証
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
- **重複参照**: 同一 `TFile` は `Map` で dedupe し 1 回だけコピー
- **外部 URL**: プレビューはそのまま webview に取りに行かせる。書き出し時は既定でダウンロードして埋め込む（**EPUB 3 は画像のリモート参照を許さない**ため必須）。設定で OFF 可、失敗時は警告して欠落扱い
- **Vault 外の絶対パス**: 既定で禁止（設定で許可、その場合はコピー必須）

対応拡張子は vivliostyle-cli の既定（`png` `jpg` `jpeg` `svg` `gif` `webp` `apng` + フォント `ttf/otf/woff/woff2`）に、Obsidian が扱う `avif` `bmp` を加えた集合とする。ただし EPUB では → (7)。

#### (3) サイズ指定の変換

Obsidian の `![[fig.png|300]]` / `![[fig.png|300x200]]` / `![alt|300](fig.png)` の数値は **px**。
組版では 96dpi 基準の px をそのまま流すと紙面上の寸法が直感とずれるため、変換方針を frontmatter で選べるようにする。

**【決定】既定は `px`。** Obsidian の編集画面での見た目と紙面が一致するのが最も直感的なため。

```yaml
# vivlio.yaml
imageWidthUnit: px      # px（既定）| percent（数値を版面幅に対する % と解釈）| mm（数値をそのまま mm と解釈）
```

出力は `style="inline-size: min(<n>px, 100%)"`。**縦組みでは `width` ではなく論理プロパティ（`inline-size`）を使う**こと。`width` 直書きは縦組みで意図とずれる。

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
- リフロー防止として、収集時に画像ヘッダから intrinsic size を読み `width` / `height` 属性を埋めておく（アスペクト比が確定し、レイアウトが 1 パスで決まる）

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
- px 固定幅はリーダーで破綻しやすい → EPUB 用 CSS で `img { max-inline-size: 100%; block-size: auto; }` を強制上書き

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
@page cover-document { --vs-page--doc-counter-increment: vs-counter-doc 0; } /* 通しページ数に数えない */
```

したがって**生成する HTML に `class="cover" role="doc-cover"` を付けるだけで、
ノンブル・柱の抑止とページカウンタの除外がテーマ側で正しく処理される。** 独自 CSS を足す必要はない。

```html
<section class="cover" role="doc-cover">
  <img src="assets/3f2a91c4-表紙.png" alt="">
</section>
```

```css
@page cover { margin: 0; }                       /* 裁ち落とし */
.cover { block-size: 100%; }
.cover img {
  inline-size: 100%; block-size: 100%;
  object-fit: cover;                              /* coverFit: cover */
  /* coverFit: contain のときは object-fit: contain */
}
```

#### 注意点

- **`bleed` / `marks` はセレクタなしの `@page` でしか効かない**（Vivliostyle の仕様）。
  つまり**表紙だけ塗り足しやトンボを変えることはできず、本全体に一括で掛かる。**
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

#### 縦組み特有の考慮

- **縦組みでは `font-feature-settings: 'vert' 1, 'vrt2' 1` が必要な場合がある**（句読点・括弧・長音の字形が縦用に切り替わる）。
  `writing-mode: vertical-rl` なら Chromium が自動で `vert` を適用するが、フォントによっては明示が要る。
  `--vs-font-feature-settings` に入れる
- 縦中横（5.3 #5, #6）の数字に和文フォントの半角数字ではなく欧文フォントを当てたい場合があるため、
  独自変数 `--vs--tcy-font-family` を足して `.tcy` に適用する
- ルビのフォントは本文と同じでよい。サイズはテーマの `--vs--rt-font-size` に従う

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

| 部位 | `auto` の中身 |
|---|---|
| `halfTitle` | `title` のみを組んだ半扉 |
| `titlePage` | `title` / `subtitle` / `author` / `publisher` を組んだ扉 |
| `toc` | 各章の見出しから `<nav role="doc-toc">` を生成（下記） |
| `colophon` | `title` / `author` / `publisher` / `date` / `version` を表組みにした奥付 |

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
- 縦組みではリーダー罫が縦になるが、これもテーマ側が論理プロパティで処理済み
- 目次ページ自体は目次に載せない

#### ノンブル（ページ番号）

`pageNumbering` で選ぶ。既定は商業出版の慣習に合わせた `roman-then-arabic`。`vivlio.yaml` / frontmatter の両方から指定できる。

| 値 | 挙動 |
|---|---|
| **`roman-then-arabic`（既定）** | 前付けは `i, ii, iii…`、本文先頭で `1` にリセット。表紙は数えない |
| `continuous` | 表紙を除き最初から通しのアラビア数字 |
| `none` | ノンブルを出さない（`--vs-page--mbox-visibility: hidden`） |

- 表紙は `@page cover-document` が既にカウンタを増やさない（5.9）
- 前付けのローマ数字は `@page` の名前付きページに `counter(page, lower-roman)` を当て、
  本文先頭の章に **`counter-reset: page 1`** を置く。
  **【実装時の修正】** vivliostyle-cli の `startPage` は「`counter-reset: page [値 - 1]`」と等価だと
  説明されるが、要素に直接書く場合は挙動が違う。Vivliostyle はページのカウンタを増やした**後**に
  要素の `counter-reset` を適用するため、`0` と書くと本文 1 ページ目のノンブルが 0 になる（実測）
- **PDF のページラベルも合わせる。** ビューアのページ番号表示が `i, ii, iii, 1, 2…` になるよう、
  `pdf-lib` で `/PageLabels` を書き込む（vivliostyle-cli の `pdf-postprocess.ts` と同じ処理）

#### EPUB での扱い

- 各部位を `nav` の landmarks に `epub:type`（`titlepage` / `toc` / `preface` / `colophon` 等）で登録する
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
| **2. 記法・造本・EPUB** | 5.3 の前処理 15 段一式（傍点・ルビ・縦中横・ハイライト 4 モード・callout・チェックボックス）、`MarkdownRenderer` 連携（Dataview / mermaid）、**表紙（5.9）**、**前付け・後付け・目次ページ・ノンブル（5.11）**、**`embedFonts` の `@font-face`（5.10）**、EPUB 出力（リフロー型・表紙付き） | 7〜9 日 |
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
| 6 | ルビ記法 | **VFM 標準 `{漢字\|かんじ}` + 青空文庫 / カクヨム式 `｜漢字《かんじ》` の両対応** | 5.3 #4 |
| 7 | 傍点 | **カクヨム式 `《《テキスト》》` に対応**。青空文庫ルビより先にパースする | 5.3 #9 |
| 8 | 縦中横 | **独自記法 `^^10^^` + 2 桁数字の自動適用**（自動は設定で OFF 可） | 5.3 #5, #6 |
| 9 | `==ハイライト==` | **4 モード選択（`boten` / `strong` / `mark` / `off`）、既定は `boten`（傍点）** | 5.3 |
| 10 | callout | **枠付きで残す**（`<aside class="callout">`） | 5.3 #10 |
| 11 | チェックボックス | **残す**（`☐` / `☑` の記号付きリスト） | 5.3 #11 |
| 12 | `#タグ` | 削除（設定で保持可） | 5.3 #12 |
| 13 | 本に含まれない `[[リンク]]` | **プレーンテキスト化** | 5.3 #9 |
| 14 | 既定テーマ | **`bunko`（縦組み・文庫判）**。内容による自動判定はしない | 5.4 |
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
| 27 | 前付け・後付け | **部位ごとに `auto` / ノートパス / `off` を選ぶ。** 順序は正準順で固定。`auto` 可能なのは半扉・扉・目次・奥付の 4 部位のみ | 5.11 |
| 28 | 設定の置き場所 | **3 層（設定タブ / `vivlio.yaml` / frontmatter）。frontmatter はフラットな `vivlio-*` キーのみ**（Obsidian の Properties UI が入れ子 YAML を編集できないため） | 5.4 |
| 29 | 設定の生成 | **手書きさせない。** ウィザード（`vivlio.yaml` 生成）/ スニペット挿入 / 全キー版リファレンス出力 の 3 入口。生成物は**既定値と違うキーだけ**に絞る | 5.4 |
| 30 | ノンブル | **`pageNumbering` で選択。既定 `roman-then-arabic`**（前付けはローマ数字、本文で 1 に戻す） | 5.11 |
| 31 | 前処理の実行順 | **`mdast → リンク・画像（H）→ 文字装飾（R）`。** 5.3 の表の番号順ではない（自動縦中横が `[[02]]` を壊すため） | 5.3 |
| 32 | ワークスペース | **ディスクではなくメモリに持つ。** 生成物はサーバから直接返し、画像は Vault からストリーム配信する。書き出し時もコピーしない | 5.8(2), 5.12 |
| 33 | print メディア | **CDP アタッチ（`Emulation.setEmulatedMedia`）で行う。** 失敗しても書き出しは続行し、「画面用スタイルが混じる可能性がある」と警告する | 3.5 |
| 34 | 字下げ | **`paragraphIndent` を設定キーとして持つ**（3 層すべてから指定可）。見出しの余白のような好みの調整は設定タブの「追加 CSS」に寄せ、キーを際限なく増やさない | 5.4, 5.10 |
| 35 | ビューアの URL | **`#src=` に渡す URL をパーセントエンコードしない。** ビューアは `src` をデコードせず相対パスとして解決するため、エンコードすると `viewer/` 配下を探して 404 になり、`readyState` が `loading` のまま止まる。URL の組み立ては `PreviewServer.bookViewerUrl()` の 1 箇所に集約する | 5.2 |

## 9. 残っている穴

**着手前に決めるべきものは残っていない。** 以下は実装しながら決めればよい。

- [x] `emulateMediaType('print')` 相当 → **CDP アタッチで実装**（決定 33）。
      `@media print` の書き換え注入は、消したいのが `@media screen` 側のルールなので効かない
- [x] テスト方針 → **変換パイプライン・設定解決・章順・ローカルサーバを、Obsidian API のスタブを噛ませて
      Node 上で実行する**（`test/`）。PDF / EPUB / プレビューは Electron と DOM に依存するため実機確認に回す
- [ ] 脚注番号を章ごとにリセットするか通しにするか（`gcpm` ならページ下なので章ごとが自然）
- [ ] 大きな本でのプレビュー再組版の粒度（章単位の差分更新をどこまでやるか）
- [ ] 設定スキーマのバージョニングとマイグレーション方針
- [ ] 章ごとに 1 ドキュメントを生成しているため、**章をまたぐ脚注番号・相互参照の通し**は Vivliostyle の
      publication 単位の解決に委ねている。長い本での挙動は実機で確認が必要

---

## 10. 実装状況（0.1.0）

### 実装済み

Phase 0〜2 の全項目と、Phase 3 のうち PDF の栞・メタデータ・ページラベル、トンボ / 塗り足し、
書き出し前チェック、i18n（日英）。

### 未実装

- **Phase 3 の CLI 併用（`--preflight press-ready` / CMYK 変換）。**
  設定タブに「`vivliostyle` CLI のパス」の項目だけ用意してあり、`child_process` の呼び出しは書いていない
- **EPUB のフォントサブセット化**（3.3 / 5.10 のとおり Phase 3 以降の課題）

### 検証の範囲

`npm test` が Node 上で確認しているもの（Obsidian API はスタブ）:

| 対象 | 内容 |
|---|---|
| 変換パイプライン | 5.3 の記法一式が期待どおりの HTML になること。**コードブロックが無傷であること** |
| 生成 CSS | テーマの `@import`、書字方向・判型・傍点スタイルの変数 |
| 設定 3 層 | 優先順位、フラット `vivlio-*` キーの読み取り、型強制、未知キー警告、`auto` 誤用の検出 |
| 章順 | ファイル名の自然順、目次ノートの登場順、`vivlio-order` の差し込み |
| ローカルサーバ | トークン不一致 404 / Host 検証 / 405 / パス脱出の拒否 / CORS ヘッダ無し / 停止後に応答しないこと |

**実機（Obsidian 上）でしか確認できないもの:**
プレビューの iframe 表示、`printToPDF`、EPUB の XHTML 化（`DOMParser` / `XMLSerializer` 依存）、
`MarkdownRenderer` 連携、`queryLocalFonts()`、CDP アタッチによる print メディア切り替え。
→ 次の一手は **7. の受け入れ条件を実機で通すこと**。

---

## 参考

- Vivliostyle CLI: https://github.com/vivliostyle/vivliostyle-cli
- VFM 仕様（日本語）: https://github.com/vivliostyle/vfm/blob/main/docs/ja/vfm.md
- Vivliostyle 公式（日本語）: https://vivliostyle.org/ja/
- Electron `webContents.printToPDF`: https://www.electronjs.org/docs/latest/api/web-contents
- 先行実装の参考（Electron 印刷まわり）: https://github.com/l1xnan/obsidian-better-export-pdf
