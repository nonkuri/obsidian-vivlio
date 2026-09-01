# Vivlio

Typeset Obsidian notes with [Vivliostyle](https://vivliostyle.org/) — CSS paged
media, Japanese vertical writing, ruby and emphasis dots — with a live preview,
and export to PDF and EPUB.

Desktop only (`isDesktopOnly: true`). Nothing is downloaded on first run: the
typesetting engine ships in the plugin and the PDF is printed by the Chromium
Obsidian already runs.

Implements [docs/SPEC.md](docs/SPEC.md).

## What it does

| | |
|---|---|
| **Preview** | A pane showing the real page composition — the same engine and stylesheet the PDF will use. Vertical writing, hanging punctuation and Japanese/Latin spacing included, none of which Obsidian's own PDF export can produce. |
| **Books, not just notes** | A single note, a whole folder, or the `[[links]]` of a table-of-contents note, in that order. |
| **Obsidian syntax** | Embeds, wikilinks, callouts, task lists, tags, highlights, plus Aozora/Kakuyomu ruby, emphasis dots and tate-chu-yoko. |
| **PDF** | Tagged, searchable, with bookmarks, metadata and `i, ii, iii, 1, 2 …` page labels. Fonts are embedded and subset by Chromium, so the file is printable elsewhere. |
| **EPUB 3** | Reflowable, with the theme's CSS, a cover and landmarks. |
| **Pre-export checks** | Images that will print below 300 dpi, fonts this machine does not have, a cover whose aspect ratio does not match the page. |

## Commands

| Command | What it does |
|---|---|
| `Vivlio: Open preview` | Typeset the active note in a side pane |
| `Vivlio: Export to PDF` / `to EPUB` | Export dialog, checks, then the file |
| `Vivlio: Export this folder as a book` | Every `.md` in the folder, in order |
| `Vivlio: Build a book from this note's links` | The note's `[[links]]` become the spine |
| `Vivlio: Create book configuration` | Wizard that writes `vivlio.yaml` |
| `Vivlio: Add configuration to this note` | Inserts flat `vivlio-*` frontmatter |
| `Vivlio: Write configuration reference` | Every key, with defaults and comments |

The file explorer's context menu offers preview and export as well.

## Configuring a book

Three layers; a lower one overrides the one above it.

1. **Settings tab** — vault-wide defaults.
2. **`vivlio.yaml`** next to the book — the real place for a book's settings.
   Nesting and comments allowed.
3. **A note's frontmatter** — flat `vivlio-*` keys only, so Obsidian's property
   editor can edit them (it cannot edit nested YAML).

```yaml
# vivlio.yaml
title: 吾輩は猫である
author: 夏目漱石

theme: bunko              # bunko | techbook | academic | base | a CSS path in the vault
writingMode: vertical-rl
size: 文庫
charsPerLine: 39
linesPerPage: 15
footnote: gcpm            # bottom of the page

cover: 装丁/表紙.png
sections:
  titlePage: auto
  toc: auto
  preface: まえがき.md
  colophon: auto
pageNumbering: roman-then-arabic
output: 原稿/出力/猫.pdf
```

```yaml
---
title: 第一章 猫である
vivlio-theme: bunko
vivlio-size: 文庫
---
```

Run `Vivlio: Write configuration reference` for a `vivlio.yaml` listing every
key with its default and a comment.

## Chapter order

1. A table-of-contents note (`index.md`, a note named after the folder, or one
   with `vivlio-toc: true`) — its `[[links]]` in the order they appear.
2. Otherwise the natural order of file names, so `2.md` comes before `10.md`.
3. `vivlio-order: 3` pins a note to a position either way.

The table-of-contents note itself stays out of the book unless
`includeToc: true`.

## Notation

| You write | You get |
|---|---|
| `《《テキスト》》` | emphasis dots (Kakuyomu style) |
| `｜漢字《かんじ》` | ruby (Aozora / Kakuyomu style) |
| `{漢字\|かんじ}` | ruby (VFM's own syntax) |
| `^^10^^` | tate-chu-yoko |
| `42` in vertical writing | tate-chu-yoko, automatically |
| `==highlight==` | emphasis dots, bold, `<mark>` or plain text — your choice |
| `> [!note]` | a framed callout |
| `- [ ]` | ☐ / ☑, drawn as text rather than as a form control |
| `#tag`, `%%comment%%`, `^block-id` | removed |

Every stage can be switched off in the settings tab, and none of them can reach
inside a code block: the conversions run over the document tree, not over the
Markdown source.

## Building

```bash
npm install
npm run build
```

`main.js`, `manifest.json` and `styles.css` are what a release ships. The
prebuilt Vivliostyle viewer and the four CC0 themes are embedded in the bundle,
so there is nothing else to copy.

```bash
npm test
```

The tests run the real conversion pipeline, the configuration layers and the
local server outside Obsidian, against a small stub of the app's API.

## How it works

```
note(s) ──▶ VFM (+ this plugin's hooks) ──▶ HTML + generated CSS
                                                │
                                    127.0.0.1 (token-scoped)
                                                │
                            ┌───────────────────┴───────────────────┐
                            ▼                                       ▼
                   iframe + Vivliostyle viewer          hidden webview → printToPDF
                          (preview)                       → pdf-lib (bookmarks,
                                                             metadata, page labels)
```

Vivliostyle fetches the document and its assets over XHR, which rules out
`file://`, so the plugin serves the build over loopback while a preview or an
export is open. That server binds `127.0.0.1` only, requires a per-session
token in every URL, checks the `Host` header, answers only GET and HEAD, sends
no CORS headers, and refuses any path outside the vault unless a font was
explicitly configured from elsewhere.

## Licence

AGPL-3.0-or-later. `@vivliostyle/core` and `@vivliostyle/viewer` are AGPL-3.0
and are bundled into `main.js`, so the plugin as a whole is AGPL-3.0. See
[LICENSE](LICENSE) and [NOTICE](NOTICE) — VFM is Apache-2.0 and the themes are
CC0-1.0.

Fonts are never bundled. Checking that a font's licence allows embedding it in
a PDF or an EPUB is up to you.
