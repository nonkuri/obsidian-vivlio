# このマニュアルについて

このマニュアルは **Vivlio 0.17.0**（デスクトップ版 Obsidian 1.8.7 以降）を対象にしています。Vivlio は、Obsidian の Markdown ノートを Vivliostyle で組版し、PDF または EPUB 3 として書き出すプラグインです。ライブプレビューも可能となっているので、仕上がりを確認しながら修正できます。


![Obsidian のノートと Vivlio プレビュー](images/obsidian.png)

![組版例](images/spread.png)


## はじめに読むページ

1. [Vivlio プラグインの概要](01-overview.md)
2. [まずは一冊作ってみる](02-first-book.md)
3. [Vivlio プラグインの設定](03-settings.md)

## 目的別リファレンス

- [本ごとの設定 — vivlio.yaml とフロントマター](04-book-configuration.md)
- [原稿の書き方と本の組み立て方](05-writing-and-structure.md)
- [テーマ別の原稿の書き方](05a-theme-writing.md)
- [自分でテーマを作ってみる](06-custom-theme.md)
- [書き出し・点検・トラブルシューティング](07-export-and-troubleshooting.md)

## 完成サンプル

- [句集・歌集（Vivlio 0.17.0）](https://raw.githubusercontent.com/nonkuri/obsidian-vivlio/0.17.0/sample/downloads/vivlio-sample-verse-0.17.0.zip) — 原稿・設定、1・2・3作品／頁のPDFとEPUB。[原稿の書き方](../sample/verse-README.md)。

入力原稿と PDF / EPUB をダウンロードできます。

- [マニュアル・操作ガイド（Vivlio 0.15.0）](https://github.com/nonkuri/obsidian-vivlio/releases/download/0.15.0/vivlio-sample-manual-0.15.0.zip) — 原稿4ファイル、模式図2点、設定表と36行のチェックリスト、16ページのPDF・EPUB。図表の通し採番と原稿間参照、手順・注意書き・長表の改ページを確認できる例

- [論文・レポート（Vivlio 0.14.0）](https://github.com/nonkuri/obsidian-vivlio/releases/download/0.14.0/vivlio-sample-paper-0.14.0.zip) — 原稿7ファイル、図5点、表6点、再現用データ・コード、実機確認済み15ページのPDF。通し採番と図のページフロート、長表の分割を確認できる例

- [芥川龍之介短編集（Vivlio 0.10.1）](https://github.com/nonkuri/obsidian-vivlio/releases/download/0.10.1/vivlio-sample-akutagawa-0.10.1.zip) — 同じ Markdown 原稿と複数の YAML から A5 縦二段組、トンボ・塗り足し付き入稿用、四六判、文庫版、EPUB を作り分けた例
- [The Adventures of Sherlock Holmes](https://github.com/nonkuri/obsidian-vivlio/releases/download/0.8.0/vivlio-sample-sherlock-holmes-0.8.0.zip) — Vault 内の独自 CSS で英語小説を組版した例

ZIP 内の README に導入方法があります。入力原稿のフォルダ名は `vivlio.yaml` から参照されているため、最初は名前を変えずに Vault のルートへ展開してください。

## 最短コース

急いで試す場合は、次の順で進めてください。

1. 原稿となるノートを入れるフォルダを Vault に作る。
2. そのフォルダに `01-第一章.md` などの原稿を置く。
3. 原稿を開き、コマンドパレットから **Vivlio: 本の設定を作成** を実行する。
4. フォルダを右クリックし、**Vivlio: 本としてプレビュー** を選ぶ。
5. プレビュー上部の **PDF** または **EPUB** を押して書き出す。

詳しい手順は [まずは一冊作ってみる](02-first-book.md) を参照してください。

## 表記について

- **Vault 相対パス**は Vault のルートを基準にしたパスです。例: `本/猫/表紙.jpg`
- 設定名は、日本語 UI に表示される名称を太字で記します。
- YAML のインデントにはタブではなく半角スペースを使ってください。
- Vivlio 固有の操作と、一般的な Vivliostyle / CSS の操作は区別して説明します。
