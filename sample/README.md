# Release sample packages

This directory is the local staging area for the sample packages linked from the project README and manual. New ZIP packages are versioned under downloads/ and linked from the repository. Never upload sample ZIPs to plugin releases. Older historical links remain where no migration has been made; the 0.16.0 essay package has moved to downloads/. See ../docs/RELEASING.md.

Published asset names:

- [vivlio-sample-essay-0.16.0.zip](https://raw.githubusercontent.com/nonkuri/obsidian-vivlio/0.17.0/sample/downloads/vivlio-sample-essay-0.16.0.zip) — two humorous Japanese essays, cover and diagram, YAML configuration, a verified 16-page PDF and an EPUB. Requires Vivlio 0.16.0 or later.

- `vivlio-sample-manual-0.15.0.zip` — four Japanese manuscript notes, two schematic SVG figures, settings, a 36-row checklist, a verified 16-page A5 PDF and an EPUB. Includes setup instructions and source licensing.
  - SHA-256: `ff21f5385defb1cc7f3a84bb55c87307994d887fc6f4891b3b18a78af526ae2d`

- `vivlio-sample-paper-0.14.0.zip` — seven manuscript notes, figures, synthetic data, reproduction scripts, and a verified PDF exported from Obsidian. Setup instructions are in the archive's `README.md` and `paper/index.md`.
  - SHA-256: `0e13821a9840966d14c04b3edfe0db5429dea63d1ad480282c859f1ede8fd58d`

- `vivlio-sample-akutagawa-0.10.1.zip`
  - SHA-256: `a582e330fcb77b5cde8ed4037408b2dde27084bf051800eed7e9fb055003ca68`
- `vivlio-sample-sherlock-holmes-0.8.0.zip`
  - SHA-256: `8682e0f4d9d18ded900ef714ac039fa8e9306f0fd759ecbb0829a10d65a273f9`

The source archives deliberately retain the top-level folder names `A5二段組` and `English Novel Sample`. Their `vivlio.yaml` files contain vault-relative paths beginning with those names. Repackage without renaming any existing entry, and use UTF-8 ZIP entry names.

The package-specific README source files in this directory are added to the corresponding outer ZIP before upload.

## 句集・歌集（0.17.0以降）

[haiku/](haiku/index.md) と [tanka/](tanka/index.md) は各8作品のサンプルです。作品記法と `versePerPage` による1・2・3作品／頁の比較、詞書・作者・改行を含みます。[利用・検証方法](verse-README.md)を参照してください。Vivlio 0.17.0以降が必要です。[配布ZIP](https://raw.githubusercontent.com/nonkuri/obsidian-vivlio/0.17.0/sample/downloads/vivlio-sample-verse-0.17.0.zip)。

## 一般書・エッセイ

一般書・エッセイ用のソースサンプルは [essay/](essay/index.md) にあります。[利用・検証方法](essay-README.md)を参照してください。

## マニュアル・操作ガイド

[manual/](manual/index.md) は、4原稿、模式図2点、図表の通し採番と参照、注意書き・設定表・長表を含むサンプルです。[利用・検証方法](manual-README.md)を参照してください。Vivlio 0.15.0以降で利用できます。[配布ZIP](https://github.com/nonkuri/obsidian-vivlio/releases/download/0.15.0/vivlio-sample-manual-0.15.0.zip)には原稿・PDF・EPUBを収録しています。

## 論文・レポート

[paper/](paper/index.md) は「連続欠測を含む周期時系列の補間法比較」を題材にした、A4・横組みの模擬論文です。原稿7ファイル、図5点、表6点、数式・脚注・文献・48行の付録表を含みます。合成信号に対する計算を実行して本文と図表の数値を揃え、CSVと再生成コードも収録しています。

Vivlio 0.14.0以降で、フォルダ全体を Vault にコピーし、`vivlio.yaml` からプレビューしてください。図は生成済みで、組版にPythonは不要です。配置先パスの書き換えは不要です。使い方と受け入れ条件は `index.md`、自動検査と実機PDFの確認結果は `reproduce/verification.md` に記載しています。配布ZIPには、2026-09-22に実機出力して全ページ確認した15ページの `paper.pdf` を収録します。
