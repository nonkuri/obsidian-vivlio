# マニュアル・操作ガイドのサンプル

「小さな資料を、一冊に」は、原稿の準備から配布前の確認までを説明する日本語の操作ガイドです。4原稿、模式図2点、設定表、36行のチェックリストを含みます。図はこのサンプル用のオリジナルSVGで、実際のアプリ画面ではありません。

[配布ZIP](https://github.com/nonkuri/obsidian-vivlio/releases/download/0.15.0/vivlio-sample-manual-0.15.0.zip)には `manual/` の原稿・設定・図と、`manual.pdf`、`manual.epub`、この説明書を収録しています。原稿と図は本リポジトリと同じ AGPL-3.0-or-later ライセンスです。

## 開き方

1. Vivlio 0.15.0以降をインストールします。[リリース](https://github.com/nonkuri/obsidian-vivlio/releases/tag/0.15.0)の `main.js`、`manifest.json`、`styles.css` を `VaultFolder/.obsidian/plugins/vivlio/` に配置し、Obsidianを再読み込みしてください。
2. `manual` フォルダ全体をVault内へコピーします。
3. `manual/vivlio.yaml` を右クリックしてVivlioのプレビューを開きます。

標準テーマだけで組版します。追加CSS、ネットワーク画像、別途インストールするフォントは不要です。A4で比較するときは `size: A4` に変更します。

## 改善した内容

- 本文を字下げなしにし、見出し・手順・本文の左端を揃えました。`paragraphIndent: 1em` で字下げを戻せます。
- 注意は二重罫線、ヒントは破線、補足は実線で区別します。コードは明るい背景と濃い文字にし、長い行を折り返します。
- 操作手順と長い注意書きはページをまたげます。図とキャプションは同じページに保ち、掲載順を変えません。
- キャプション付き図表を本文の原稿順に通し採番し、別原稿への参照とEPUBにも反映します。
- 短い表を一緒に配置し、長表では表題・列見出しを繰り返します。継続ページは「続き」を表示します。
- 扉と奥付の余白を見直し、奥付の長い住所・URLを折り返します。

## 自動検証と出力

Node.js、プロジェクトの依存関係、Playwright、jsdom、ローカルのChromeが必要です。検証用ライブラリは通常のプラグイン利用には不要です。

```powershell
# 別の場所にあるパッケージを使う場合だけ指定します。
$env:VIVLIO_PLAYWRIGHT = 'C:/path/to/node_modules/playwright'
$env:VIVLIO_JSDOM = 'C:/path/to/node_modules/jsdom'
$env:VIVLIO_MANUAL_OUTPUT = "$PWD/output/manual"
node test/run.mjs test/manual.check.ts
node test/package-manual.mjs
```

`output/manual/manual.pdf`、`manual.epub`、A5・A4の各ページPNGと検証用JSONを生成します。テストは配布する原稿を直接読み、実際のビルダーとVivliostyleを通します。

パッケージコマンドは確認済みの出力と原稿・説明書・ライセンスを `sample/vivlio-sample-manual-<バージョン>.zip` にまとめます。

2026-09-23の検証では、A5は16ページ、A4は12ページ。図とキャプションの同居、図表参照、長表36行の欠落・重複がないこと、列見出しの反復、長い注意書きとコードの末尾、ページ外へのはみ出しがないことを確認しました。EPUBはSVG2点、参照ラベル、表の最終行を検査しています。紙面はフォントや閲覧環境で変わります。Obsidian実機からのPDF出力と外部EPUBリーダーでの見た目は、この自動検証には含みません。

扉の次と奥付の前の白紙は、右ページの目次と左ページの奥付へ揃えるために入ります。
