# Vivlio プロモーション動画・初稿

Gitには生成スクリプトと `source/` の元画像を保存します。以下の動画・音声・確認画像は生成物として除外しています。

- `vivlio-promo-ja-30s.mp4` — 1920 × 1080、30fps、30秒、H.264、音声なし。日本語テロップ焼き込み。
- `vivlio-promo-ja-30s-bgm.mp4` — 同じ映像にオリジナルのピアノ風BGMを追加。AACステレオ。
- `vivlio-original-bgm.wav` — 合成音によるオリジナル伴奏。既存楽曲やサンプル音源は不使用。72 BPM、30秒、末尾3秒フェードアウト。
- `poster.png` — 最終シーンの静止画。
- `storyboard.jpg` — 全6シーンの一覧。
- `render.py` — 再生成用スクリプト。Windowsの游明朝・游ゴシック、Python + Pillow、PATH上のFFmpegを使用。

リポジトリのルートで `python promo/render.py` を実行すると再生成できます。
その後 `python promo/add_music.py` でBGM付き動画を再生成できます（NumPyが必要）。

## 構成

| 秒 | 内容 |
|---|---|
| 0–5 | 書いた言葉を、本のかたちに。 |
| 5–10 | 原稿の隣に、仕上がりを。実際の画面画像 |
| 10–15 | 日本語を、美しく組む。縦書き・ルビ・傍点 |
| 15–21 | 小説・縦書き雑誌・横書き雑誌の本文ページを比較 |
| 21–26 | PDF / EPUB 書き出しの紹介 |
| 26–30 | Vivlioの名称、キャッチコピー、検索案内、GitHub URL |

操作の収録ではなく、既存スクリーンショットと組版サンプルの移動・クロスフェードによる構成です。

使用画像: `promo/source/Obsidian画面.png`（5–10秒）、`promo/source/杜子春.png`（10–15秒）、`docs/images/spread.png`、`sample/css/vertical-magazine/preview.png`、`sample/css/horizontal-magazine/preview.png`。

## 用途紹介バージョン

`vivlio-showcase-ja-30s-bgm.mp4` は文学・研究・実用・雑誌・印刷の用途を見せる別構成です。フルHD・30fps・30秒、既存のオリジナルBGM付き。無音版は `vivlio-showcase-ja-30s.mp4`、シーン一覧は `showcase-storyboard.jpg`。

`python promo/render_showcase.py` で再生成できます。既存の `vivlio-original-bgm.wav` が必要です。元の動画は上書きしません。

新しく取得した環境では、PythonにPillowとNumPyを用意し、FFmpegをPATHに追加したうえで、リポジトリのルートから順に実行します。フォントにはWindowsの游明朝・游ゴシックを使います。

```powershell
python promo/render.py
python promo/add_music.py
python promo/render_showcase.py
```

| 秒 | 内容 |
|---|---|
| 0–3 | 物語も、知識も、一冊に。用途の一覧 |
| 3–7 | Obsidianの原稿とプレビュー |
| 7–12 | 日本語小説・欧文小説・短歌 |
| 12–17 | 図表のある論文・コード枠のあるマニュアル |
| 17–22 | 縦書き・横書きマガジンの本文 |
| 22–26 | トンボ付きの片側ページと角の拡大、PDF・EPUB |
| 26–30 | Vivlioの検索案内 |

追加素材は `source/English.png`、`source/短歌見開き.png`、`source/論文.png`、`source/manual.png`、`source/トンボ入り見開き.png`。短歌とトンボ付き原稿は右側ページを切り出し、トンボ付き原稿では周囲のトンボを保持しています。切り出し座標は `render_showcase.py` に記録しています。
