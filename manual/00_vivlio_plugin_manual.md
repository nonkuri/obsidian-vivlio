# このマニュアルについて

このマニュアルは **Vivlio 0.1.3**（デスクトップ版 Obsidian 1.8.7 以降）を対象にしています。Vivlio は、Obsidian の Markdown ノートを Vivliostyle で組版し PDF / EPUB 3 に書き出すプラグインです。ライブプレビューも可能となっているので、仕上がりを確認しながら修正できます。


![Obsidian のノートと Vivlio プレビュー](images/obsidian.png)

![組版例](images/spread.png)


## はじめに読むページ

1. [Vivlio プラグインの概要](01-overview.md)
2. [まずは一冊作ってみる](02-first-book.md)
3. [Vivlio プラグインの設定](03-settings.md)

## 目的別リファレンス

- [本ごとの設定 — vivlio.yaml とフロントマター](04-book-configuration.md)
- [原稿の書き方と本の組み立て方](05-writing-and-structure.md)
- [自分でテーマを作ってみる](06-custom-theme.md)
- [書き出し・点検・トラブルシューティング](07-export-and-troubleshooting.md)

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

