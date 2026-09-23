# リリース手順

プラグインのリリース資産は **main.js、manifest.json、styles.css の3ファイルのみ**とする。ZIP、PDF、EPUB、サンプル原稿、単独のテーマCSSを追加してはいけない。GitHubが自動生成するSource codeは手動添付資産とは別である。

[Obsidian公式の配布手順](https://docs.obsidian.md/plugins/releasing/submit-plugin)を参照。0.16.0でサンプルZIPを同じリリースに添付し、非対応資産の警告が出た。サンプルを任意ダウンロードと説明しても解消しないため、この配布方法を再使用しない。

1. README（日英）、マニュアル、サンプル手順を現在の仕様へ更新する。内蔵テーマはプラグインに組み込まれ、利用者がテーマCSSを別途置く必要はない。
2. `npm version <version> --no-git-tag-version --ignore-scripts` と `node version-bump.mjs` で package.json、package-lock.json、manifest.json、versions.json を更新する。
3. `npm test` と `npm run build` を実行する。組版変更は実ブラウザでも確認する。`docs/releases/<version>.md` に変更点・制限・検証結果を記す。
4. サンプルの原稿は sample/ 配下、原稿と出力のZIPは sample/downloads/ 配下で管理する。必要なものだけをコミットし、バージョンタグを固定したraw.githubusercontent.comへのリンクで案内する。プラグインのリリースへアップロードしない。
5. 変更をコミットしてmainへpushする。CI成功後、同じコミットへmanifestのversionと同じタグ（v接頭辞なし）を付けてpushする。Releaseワークフローがビルド・証明・公開を行う。
6. ワークフロー成功と公開タグのコミットを確認する。`gh release view <version> --json assets` で資産名が3点だけであることを確認する。公開manifestのversionと公開ファイルの内容も確認する。

過去の余分な資産を整理する場合は、先に移設先のZIPのハッシュ一致と公開を確認し、リリース説明のリンクを更新してから旧資産を削除する。過去のプラグイン本体・タグ・バージョン番号は差し替えない。
