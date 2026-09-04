/**
 * Conversion smoke test.
 *
 * Runs the real VFM pipeline - notation rules, links, Obsidian block syntax -
 * against a note that exercises every stage of SPEC 5.3, and checks the
 * output. Runs outside Obsidian against the stub in obsidian-stub.ts.
 */
import { TFile } from "obsidian";
import { convertChapter } from "../src/build/vfm";
import { bookStylesheet, themeUrlFor } from "../src/build/css";
import { resolveVaultTheme, themeChoices, THEME_STYLESHEET } from "../src/build/theme";
import { BOOK_STYLESHEET } from "../src/build/vfm";
import { buildTocEntries, tocDocument } from "../src/build/toc";
import { colophonDocument, titlePageDocument } from "../src/build/sections";
import { kanjiDate } from "../src/util/kanji";
import { epubStylesheet } from "../src/export/epub";
import type { BuildContext, Chapter } from "../src/build/context";
import { Workspace } from "../src/build/workspace";
import { baseBookConfig, DEFAULT_SETTINGS } from "../src/config/defaults";
import { setLanguage } from "../src/i18n";

function makeFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.name = path.split("/").pop() ?? path;
  file.basename = file.name.replace(/\.md$/, "");
  file.extension = path.split(".").pop() ?? "md";
  return file;
}

const chapterOne = makeFile("book/01.md");
const chapterTwo = makeFile("book/02.md");
const picture = makeFile("book/fig.png");
// Obsidian's own name for a pasted image. Every character of it has to
// survive into a URL, a zip entry and an EPUB package document.
const pasted = makeFile("book/Pasted image 20250101120000.png");
const outsider = makeFile("elsewhere/Other.md");

const files: Record<string, TFile> = {
  "01": chapterOne,
  "02": chapterTwo,
  "fig.png": picture,
  "Pasted image 20250101120000.png": pasted,
  Other: outsider,
  "第二章": chapterTwo,
};

function makeContext(overrides: Partial<BuildContext> = {}): BuildContext {
  const config = baseBookConfig();
  const workspace = new Workspace("test");

  const chapters: Chapter[] = [
    {
      docName: "ch01.html",
      file: chapterOne,
      title: "第一章",
      role: null,
      slot: null,
      isBody: true,
      isFrontMatter: false,
    },
    {
      docName: "ch02.html",
      file: chapterTwo,
      title: "第二章",
      role: null,
      slot: null,
      isBody: true,
      isFrontMatter: false,
    },
  ];

  const context: BuildContext = {
    app: {
      metadataCache: {
        getFirstLinkpathDest: (linkpath: string) => files[linkpath] ?? null,
        getFileCache: () => ({ frontmatter: undefined, headings: [] }),
      },
      vault: {
        cachedRead: async () => "",
        getFileByPath: (path: string) =>
          Object.values(files).find((file) => file.path === path) ?? null,
      },
    } as unknown as BuildContext["app"],
    settings: { ...DEFAULT_SETTINGS },
    config,
    workspace,
    mode: "preview",
    bookRoot: "book",
    chapters,
    chapterByPath: new Map(chapters.map((chapter) => [chapter.file!.path, chapter])),
    // Obsidian supplies these from its metadata cache; the pipeline reads them
    // to decide whether a document has a heading to name itself by.
    // Sizing a picture needs its shape (SPEC 5.8(3)); the real build reads it
    // off the file, and here it is stated outright.
    imageSizes: new Map([
      ["book/fig.png", { width: 1400, height: 900 }],
      ["book/Pasted image 20250101120000.png", { width: 1400, height: 900 }],
    ]),
    headings: new Map([
      ["book/01.md", [{ level: 1, text: "第一章", slug: "第一章" }]],
      ["book/02.md", [{ level: 1, text: "第二章", slug: "第二章" }]],
    ]),
    warnings: [],
    component: {} as BuildContext["component"],
    workspaceBase: "http://127.0.0.1:1/s/t/w/test/",
    vaultBase: "http://127.0.0.1:1/s/t/vault/",
    themeBase: "http://127.0.0.1:1/s/t/themes/",
    ...overrides,
  };
  return context;
}

const SAMPLE = `---
title: 第一章
vivlio-theme: bunko
---

# 第一章

《《ここは傍点》》になり、｜漢字《かんじ》にルビが付く。標無《しるしなし》にも付く。^^10^^ 年と 42 冊、3 歳、2024 年。

==ハイライト== は傍点になる。%%この注記は消える%%

「この行は字下げされない」と彼は言った。

> [!note] おぼえがき
> ここは callout の本文。

- [ ] まだ
- [x] おわった

［＃改ページ］

#タグ は消える。 [[02]] は章間リンク、[[Other|よそのノート]] はただの文字列になる。

![[fig.png|300]]

![[fig.png|60%]]

![[fig.png|80mm]]

![[Pasted image 20250101120000.png]]

\`\`\`js
const x = 42; // 42 must stay a plain number inside code
\`\`\`

^block-id
`;

interface Check {
  label: string;
  ok: boolean;
  detail?: string;
}

function check(label: string, ok: boolean, detail?: string): Check {
  return { label, ok, detail };
}

async function main(): Promise<void> {
  setLanguage("ja");
  const context = makeContext();
  const chapter = context.chapters[0];
  const html = await convertChapter(context, chapter, chapterOne, SAMPLE);

  const checks: Check[] = [
    // Emphasis dots are ruby: one sesame dot per character, so every line
    // keeps the same measure (see notationRules).
    check("emphasis dots", /<ruby class="boten">こ<rp>\(<\/rp><rt>﹅<\/rt>/.test(html), html.slice(html.indexOf("boten") - 20, html.indexOf("boten") + 120)),
    check("ruby", /<ruby>漢字<rp>\(<\/rp><rt>かんじ<\/rt>/.test(html)),
    // Kakuyomu writes ruby without the marker nearly everywhere: a reading
    // after a run of kanji is ruby for that run.
    check(
      "ruby without the marker",
      /<ruby>標無<rp>\(<\/rp><rt>しるしなし<\/rt>/.test(html),
      html.slice(html.indexOf("しるしなし") - 90, html.indexOf("しるしなし") + 30),
    ),
    // A chapter carries the writing-mode class too. It did not, so a theme
    // keyed on `.vivlio-vertical` matched every generated part and no body.
    check(
      "a chapter says how the book is set",
      /<html[^>]*class="[^"]*vivlio-vertical/.test(html),
      html.slice(html.indexOf("<html"), html.indexOf(">", html.indexOf("<html")) + 1),
    ),
    check("explicit tate-chu-yoko", html.includes('<span class="tcy">10</span>')),
    check("automatic tate-chu-yoko", html.includes('<span class="tcy">42</span>')),
    // A lone digit is set upright too: left to `text-orientation: mixed` it
    // would lie on its side in the middle of vertical text.
    check("a single digit stands upright", html.includes('<span class="tcy">3</span>')),
    // Three digits and more do not fit the em a combine gives them.
    check("four digits are left alone", !html.includes('<span class="tcy">2024</span>')),
    check("highlight becomes emphasis dots", (html.match(/<ruby class="boten">/g) ?? []).length === 2),
    check("comment stripped", !html.includes("この注記は消える")),
    check("block id stripped", !html.includes("block-id")),
    check("callout", html.includes('class="callout callout-note"')),
    check("callout title", html.includes("おぼえがき")),
    check("task list", html.includes('data-checked="false"') && html.includes('data-checked="true"')),
    check("no checkbox input", !html.includes('type="checkbox"')),
    check("tag stripped", !html.includes("タグ は")),
    check("in-book wikilink", html.includes('href="ch02.html"')),
    check("out-of-book wikilink flattened", html.includes("よそのノート") && !html.includes('href="Other')),
    check("image resolved to the vault route", html.includes("/vault/book/fig.png")),
    // Sizes are worked out here, against the printed text block, and written
    // as one definite axis with the other left automatic - so the ratio is
    // never in contention and the box is the picture (SPEC 5.8(3)).
    //
    // The block is 40 characters by 16 lines on 105x148mm: 89.25mm across,
    // 111.6mm down. A picture is 1400x900.
    check("a pixel width becomes its printed width", html.includes("width: 79.38mm"), html),
    check(
      "a percentage is a share of the text block",
      html.includes("width: 53.55mm"),
      html,
    ),
    check("a millimetre width is taken as given", html.includes("width: 80.00mm"), html),
    check(
      "a picture nobody sized is brought inside the block",
      html.includes("width: 89.25mm"),
      html,
    ),
    check(
      "the other axis is always left to follow",
      (html.match(/height: auto/g) ?? []).length === 4,
      html,
    ),
    check(
      "and nothing is sized logically any more",
      !html.includes("inline-size:"),
      html,
    ),
    check("stylesheet linked", html.includes('href="vivlio.css"')),
    check("plugin frontmatter is not a meta tag", !html.includes('name="vivlio-theme"')),
    check("a body chapter is marked as body", /<html[^>]*class="[^"]*vivlio-body/.test(html)),
    check(
      "a paragraph opening with a bracket takes no indent",
      html.includes('<p class="vivlio-no-indent">「この行は字下げされない」'),
      html.slice(html.indexOf("この行は") - 60, html.indexOf("この行は") + 40),
    ),
    check(
      "an ordinary paragraph keeps the indent",
      !/<p class="vivlio-no-indent">[^「]/.test(html),
    ),
    // The mark goes away and the block after it carries the break, because a
    // box with no height in the flow never finishes composing (liftPageBreaks).
    check(
      "a forced page break lands on the next block",
      /<(aside|p|h\d)[^>]*class="[^"]*vivlio-page-break/.test(html),
      html.slice(html.indexOf("page-break") - 90, html.indexOf("page-break") + 60),
    ),
    check("and the mark itself is gone", !html.includes("改ページ")),
  ];

  // Exporting rewrites every image to a path the output carries itself, and
  // that path lands unencoded in three places at once: an `src`, a zip entry
  // and the EPUB package document. A vault name is not safe in any of them -
  // Obsidian's own pasted-image name has spaces in it (SPEC 5.8).
  const exported = makeContext({ mode: "epub" });
  const exportedHtml = await convertChapter(
    exported,
    exported.chapters[0],
    chapterOne,
    "![[Pasted image 20250101120000.png]]\n\n![[fig.png|300]]",
  );
  const assetPaths = [...exported.workspace.assets.values()].map((asset) => asset.publicPath);
  checks.push(
    check(
      "an exported asset path is safe in a URL",
      assetPaths.every((path) => /^assets\/[A-Za-z0-9._-]+$/.test(path)),
      assetPaths.join(", "),
    ),
    check(
      "and the document points at exactly that path",
      assetPaths.every((path) => exportedHtml.includes(`src="${path}"`)),
      `${(exportedHtml.match(/<img[^>]*>/g) ?? []).join(" | ")}`,
    ),
    check(
      "an embedded image is not blanked by the second pass",
      !exportedHtml.includes("vivlio-missing"),
      exportedHtml,
    ),
    check(
      "a reflowable reader is given rem, not millimetres",
      /width: [\d.]+rem/.test(exportedHtml) && !exportedHtml.includes("mm"),
      (exportedHtml.match(/<img[^>]*>/g) ?? []).join(" | "),
    ),
    check(
      "a name of its own is still recognisable",
      assetPaths.some((path) => path.endsWith("-fig.png")),
      assetPaths.join(", "),
    ),
  );

  // The bare ruby form reaches for the kanji in front of it, so the two things
  // that also use 《》 have to stay clear of it.
  const rubyEdges = await convertChapter(
    makeContext(),
    context.chapters[0],
    chapterOne,
    ["　本文《《強調》》です。", "　これは《引用》です。"].join("\n\n"),
  );
  checks.push(
    check(
      "emphasis dots after kanji stay emphasis dots",
      rubyEdges.includes('<ruby class="boten">強'),
      rubyEdges,
    ),
    check(
      "and kana takes no ruby without the marker",
      rubyEdges.includes("これは《引用》です。"),
      rubyEdges,
    ),
  );

  // Blank lines the manuscript left (SPEC 5.3 #18). Markdown throws them away;
  // the count comes back off the source positions.
  const spaced = await convertChapter(
    makeContext(),
    context.chapters[0],
    chapterOne,
    // One blank line between the first two, three between the last two.
    ["　ひとつめ。", "", "　ふたつめ。", "", "", "", "　みっつめ。"].join("\n"),
  );
  checks.push(
    check(
      "three blank lines open one",
      /<p class="vivlio-blank-lines" style="--vivlio-blank-lines: 1">みっつめ。/.test(spaced),
      spaced.slice(spaced.indexOf("<p>"), spaced.indexOf("</section>")),
    ),
    check(
      "and a single blank line opens none",
      (spaced.match(/vivlio-blank-lines/g) ?? []).length === 2,
      spaced,
    ),
  );

  // The running head takes the chapter from whichever level the note uses.
  const asOneNote = makeContext();
  asOneNote.config.title = "第一章";
  asOneNote.headings.set("book/01.md", [
    { level: 1, text: "第一章", slug: "h1" },
    { level: 2, text: "節のみだし", slug: "h2" },
  ]);
  const oneNote = await convertChapter(
    asOneNote,
    asOneNote.chapters[0],
    chapterOne,
    ["# 第一章", "## 節のみだし", "　本文。"].join("\n\n"),
  );
  checks.push(
    check(
      "an h1 that repeats the title leaves the head to h2",
      /<h2[^>]*class="[^"]*vivlio-chapter-title/.test(oneNote),
      oneNote.slice(oneNote.indexOf("<h2"), oneNote.indexOf("<h2") + 120),
    ),
    check(
      "and the document does not name itself as well",
      !oneNote.includes("data-vivlio-chapter"),
    ),
    check(
      "an h1 of its own still names the chapter",
      /<h1[^>]*class="[^"]*vivlio-chapter-title/.test(html),
      html.slice(html.indexOf("<h1"), html.indexOf("<h1") + 120),
    ),
  );

  // The title page names the work and then the people (SPEC 5.11).
  const titled2 = makeContext();
  titled2.config.title = "書名";
  titled2.config.series = "叢書";
  titled2.config.subtitle = "副題";
  titled2.config.author = "著者";
  titled2.config.translator = "訳者";
  const titlePage2 = titlePageDocument(titled2);
  checks.push(
    check(
      "the title page carries the series and the subtitle",
      titlePage2.includes('<p class="series">叢書</p>') &&
        titlePage2.includes('<p class="subtitle">副題</p>'),
      titlePage2,
    ),
    // A single name is the author and needs no saying so; a second name makes
    // an unmarked pair a question, so both take their role (SPEC 5.11).
    check(
      "a translated book credits both roles",
      titlePage2.includes('<p class="translator">訳者<span class="role">訳</span></p>') &&
        titlePage2.includes('<p class="author">著者<span class="role">著</span></p>'),
      titlePage2,
    ),
  );

  // The writer can settle the question outright instead of leaving it to the
  // manuscript (SPEC 5.3 #16).
  const dialogue = ["　地の文です。", "「会話です」"].join("\n\n");
  const modes = await Promise.all(
    (["auto", "manuscript", "brackets", "all"] as const).map(async (mode) => {
      const withMode = makeContext();
      withMode.config.paragraphIndentMode = mode;
      const out = await convertChapter(withMode, withMode.chapters[0], chapterOne, dialogue);
      return [mode, (out.match(/vivlio-no-indent/g) ?? []).length] as const;
    }),
  );
  const flushCount = new Map(modes);
  checks.push(
    check("auto follows the manuscript", flushCount.get("auto") === 1, JSON.stringify(modes)),
    check("manuscript does too", flushCount.get("manuscript") === 1),
    check("brackets picks the bracket rule", flushCount.get("brackets") === 1),
    check("all indents everything", flushCount.get("all") === 0),
  );

  // A manuscript that indents itself has already said which paragraphs are
  // which, and its answer wins over any rule of ours: here the dialogue is
  // flush *and* the narration that opens with a bracketed aside is indented,
  // which the bracket rule alone would get backwards.
  const selfIndented = await convertChapter(
    makeContext(),
    context.chapters[0],
    chapterOne,
    [
      "　地の文です。",
      "「会話です」",
      "　「引用から始まる地の文です」と彼は言った。",
    ].join("\n\n"),
  );
  checks.push(
    check(
      "the manuscript's own indent is kept",
      selfIndented.includes("<p>地の文です。</p>"),
      selfIndented,
    ),
    check(
      "and a paragraph it left flush stays flush",
      selfIndented.includes('<p class="vivlio-no-indent">「会話です」</p>'),
      selfIndented,
    ),
    check(
      "even where it opens with a bracket",
      selfIndented.includes("<p>「引用から始まる地の文です」と彼は言った。</p>"),
      selfIndented,
    ),
  );

  // The point of running notations as a tree pass rather than on the source:
  // a code block must come out untouched.
  const code = html.slice(html.indexOf("<pre"), html.indexOf("</pre>"));
  checks.push(check("code block untouched", !code.includes('class="tcy"'), code.trim().slice(0, 200)));

  const css = bookStylesheet(context, "http://example.invalid/theme.css");
  checks.push(
    check("stylesheet imports the theme", css.startsWith('@import url("http://example.invalid/theme.css");')),
    check("writing mode variable", css.includes("--vs-writing-mode: vertical-rl;")),
    check("page size variable", css.includes("--vs-page--size: 105mm 148mm;")),
    check("emphasis dot style", css.includes("ruby.boten > rt")),
    // The theme's indent must stay untouched unless asked for: a manuscript
    // that does not self-indent still wants theme-bunko's 1em.
    check("no paragraph indent override by default", !css.includes("--vs--p-text-indent")),
    // A picture is held inside the text block on the axis that has no
    // percentage to cap it (SPEC 5.8); the cover is the one page that is not
    // set inside the text block at all, and a max constraint clamps whatever
    // asked for 100% however specific it was.
    check(
      "the backstop is physical and measured in millimetres",
      /img,\s*svg \{\s*max-width: [\d.]+mm;\s*max-height: [\d.]+mm;/.test(css),
      css.slice(css.indexOf("max-width"), css.indexOf("max-width") + 120),
    ),
    check(
      "the cover names its own page",
      /\.cover\s*\{[^}]*page: cover;/.test(css),
      css.slice(css.indexOf(".cover {"), css.indexOf(".cover {") + 200),
    ),
    check(
      "and the cover page is the whole sheet",
      /@page cover, cover-document \{[^}]*margin: 0;[^}]*width: auto;[^}]*height: auto;/.test(css),
      css.slice(css.indexOf("@page cover"), css.indexOf("@page cover") + 160),
    ),
    check(
      "so the cover image is free of the cap",
      /\.cover img \{[\s\S]*?max-width: none;/.test(css),
      css.slice(css.indexOf(".cover img"), css.indexOf(".cover img") + 260),
    ),
  );

  // The text block is sized from the type, so a grid that does not fit the
  // sheet collapses every margin to zero: the size has to come from the paper.
  const grid = makeContext();
  grid.config.charsPerLine = 39;
  grid.config.linesPerPage = 15;
  const gridCss = bookStylesheet(grid, "x.css");
  const derived = Number(gridCss.match(/--vs--html-font-size: ([\d.]+)mm;/)?.[1] ?? 0);
  checks.push(
    check("body size derived from the paper", derived > 2 && derived < 4, String(derived)),
    check(
      "text block fits the sheet height",
      derived * 39 < 148,
      `${(derived * 39).toFixed(1)}mm of 148mm`,
    ),
    check(
      "text block fits the sheet width",
      derived * 15 * 2 < 105,
      `${(derived * 30).toFixed(1)}mm of 105mm`,
    ),
    // The theme computes these from the grid; overriding them makes the block
    // fill the sheet and the running head print over the text.
    check("page width is left to the theme", !gridCss.includes("--vs-page--width")),
  );

  const indented = makeContext();
  indented.config.paragraphIndent = "0";
  checks.push(
    check(
      "paragraph indent can be zeroed",
      bookStylesheet(indented, "x.css").includes("--vs--p-text-indent: 0;"),
    ),
  );

  // The table of contents feeds both the printed page and the EPUB nav, so
  // the depth has to reach the headings, not just the documents.
  const tocContext = makeContext();
  tocContext.headings.set("book/01.md", [
    { level: 1, text: "第一章", slug: "ch1" },
    { level: 2, text: "一節", slug: "s1" },
    { level: 3, text: "細目", slug: "d1" },
  ]);
  const shallow = buildTocEntries({ ...tocContext, config: { ...tocContext.config, tocDepth: 2 } }, tocContext.chapters);
  const deep = buildTocEntries({ ...tocContext, config: { ...tocContext.config, tocDepth: 3 } }, tocContext.chapters);

  checks.push(
    check("toc nests headings", shallow[0]?.children.length === 1, JSON.stringify(shallow)),
    check("tocDepth 2 stops at h2", shallow[0]?.children[0]?.children.length === 0),
    check("tocDepth 3 reaches h3", deep[0]?.children[0]?.children.length === 1, JSON.stringify(deep)),
    check("toc entries link to anchors", shallow[0]?.children[0]?.href === "ch01.html#s1"),
  );

  // Vivliostyle sizes a leader by measuring what follows it inside the same
  // pseudo-element, so the label must stay bare: the leader and the page
  // number both come from theme-base's own `a::after`.
  const tocHtml = tocDocument(tocContext, tocContext.chapters);
  checks.push(
    check(
      "toc entries are a plain nested list",
      tocHtml.includes('<li><a href="ch01.html#ch1">第一章</a>'),
      tocHtml,
    ),
  );

  // The title page groups author and publisher, so the stylesheet has one box
  // to push to the foot of the page.
  const titled = makeContext();
  titled.config.title = "テスト本";
  titled.config.author = "著者名";
  titled.config.publisher = "版元";
  const titlePage = titlePageDocument(titled);
  checks.push(
    check(
      "title page groups the imprint",
      /<div class="imprint">\s*<div class="byline">\s*<p class="author">著者名<\/p>\s*<\/div>\s*<p class="publisher">/.test(
        titlePage,
      ),
      titlePage,
    ),
    check(
      "the running head has the book title to print",
      bookStylesheet(titled, "x.css").includes('--vivlio-book-title: "テスト本";'),
    ),
  );

  // The colophon: a head naming the book, then only the lines the book has.
  const colophon = makeContext();
  colophon.config.title = "テスト本";
  colophon.config.series = "テスト叢書";
  colophon.config.author = "著者名";
  colophon.config.date = "2026-09-02";
  colophon.config.website = "https://example.invalid/";
  colophon.config.colophonExtra = [{ label: "装丁", value: "佐藤 次郎" }];
  const colophonHtml = colophonDocument(colophon);
  checks.push(
    check("colophon names the series and the book", colophonHtml.includes(
      '<p class="colophon-series">テスト叢書</p>',
    ), colophonHtml),
    check(
      "a vertical colophon writes the date in kanji",
      colophonHtml.includes("二〇二六年九月二日"),
      colophonHtml,
    ),
    check("the book adds its own colophon lines", colophonHtml.includes("装丁")),
    check("an absent part gets no line", !colophonHtml.includes("訳者")),
  );

  const horizontal = makeContext();
  horizontal.config.writingMode = "horizontal-tb";
  horizontal.config.date = "2026-09-02";
  checks.push(
    check(
      "a horizontal colophon leaves the date alone",
      colophonDocument(horizontal).includes("2026-09-02"),
    ),
  );

  checks.push(
    check("a year alone", kanjiDate("2026") === "二〇二六年", kanjiDate("2026")),
    check("slashes too", kanjiDate("2026/9/2") === "二〇二六年九月二日"),
    check("the tens are counted", kanjiDate("2026-10-21") === "二〇二六年十月二十一日", kanjiDate("2026-10-21")),
    // `date` is free text; a book that writes something else there means it.
    check("anything else is left alone", kanjiDate("令和八年 第三刷") === "令和八年 第三刷"),
  );

  // The running head needs a chapter title even when the manuscript has no
  // heading to take one from (see documentShapePlugin) - and must keep taking
  // it from the heading when there is one.
  const headless = makeContext();
  headless.headings.set("book/01.md", []);
  const headlessHtml = await convertChapter(
    headless,
    headless.chapters[0],
    chapterOne,
    "　見出しのない本文。\n",
  );
  checks.push(
    check(
      "a chapter with no heading names itself for the running head",
      headlessHtml.includes('data-vivlio-chapter="第一章"'),
      headlessHtml.slice(headlessHtml.indexOf("<section"), headlessHtml.indexOf("<section") + 160),
    ),
    check(
      "a chapter with a heading leaves the head to it",
      !html.includes("data-vivlio-chapter"),
      html.slice(html.indexOf("<section"), html.indexOf("<section") + 160),
    ),
  );

  // The character grid is the theme's when the book gives none: the theme
  // composes its text block from those numbers either way, so the body size
  // has to be derived from the same pair or the block outgrows the sheet.
  const bare = makeContext();
  bare.config.charsPerLine = null;
  bare.config.linesPerPage = null;
  const bareCss = bookStylesheet(bare, "x.css");
  const bareSize = Number(bareCss.match(/--vs--html-font-size: ([\d.]+)mm;/)?.[1] ?? 0);
  checks.push(
    check("the theme's own grid fills in", bareCss.includes("--vs-theme--num-of-character: 40;"), bareCss),
    check(
      "and the text block still fits the sheet",
      bareSize > 0 && bareSize * 40 < 148 && bareSize * 16 * 2 < 105,
      `${bareSize}mm x 40 = ${(bareSize * 40).toFixed(1)}mm of 148mm`,
    ),
  );

  // A theme that lays out from margins keeps its own body size.
  const margins = makeContext();
  margins.config.theme = "techbook";
  margins.config.charsPerLine = null;
  margins.config.linesPerPage = null;
  checks.push(
    check(
      "a theme without a grid is left alone",
      !bookStylesheet(margins, "x.css").includes("--vs--html-font-size"),
    ),
  );

  // The EPUB has to ship the theme the book was written against.
  const packed = epubStylesheet(context);
  checks.push(
    check("the epub ships the book's own theme", packed.includes("--vs-novel--boten-font-size"), packed.slice(0, 200)),
    // The root must carry no font size at all: an author declaration outranks
    // the reader's own stylesheet, so overriding the value would still pin it.
    check(
      "the epub leaves the body size to the reader",
      !packed.includes("font-size: var(--vs--html-font-size)"),
    ),
    // The gap has to be a margin, because justifying the label across its 5em
    // pushes the last character hard against the end of it (SPEC 5.11). How
    // wide is a design decision; that there is one is not.
    check(
      "and the colophon label does not touch its value",
      /margin-inline-end: (?!0)[\d.]+em/.test(packed),
      packed.slice(packed.indexOf("margin-inline-end"), packed.indexOf("margin-inline-end") + 60),
    ),
  );

  // A theme of the writer's own (SPEC 5.10): resolved into one stylesheet, so
  // the preview and the EPUB are set in the same thing, and able to start from
  // a bundled theme, which a relative path cannot reach.
  const sources: Record<string, string> = {
    "themes/mine.css": [
      '@import url("vivlio:novel");',
      '@import url("./tweaks.css");',
      "p { color: rebeccapurple; }",
    ].join("\n"),
    "themes/tweaks.css": "h1 { letter-spacing: 0.2em; }",
  };
  const own = makeContext({
    app: {
      metadataCache: { getFirstLinkpathDest: () => null, getFileCache: () => ({}) },
      vault: {
        cachedRead: async (file: TFile) => sources[file.path] ?? "",
        getFileByPath: (path: string) => (sources[path] ? makeFile(path) : null),
        getFiles: () => Object.keys(sources).map(makeFile),
      },
    } as unknown as BuildContext["app"],
  });
  own.config.theme = "themes/mine.css";

  const resolvedTheme = await resolveVaultTheme(own);
  own.workspace.putText(THEME_STYLESHEET, resolvedTheme ?? "");
  own.workspace.putText(BOOK_STYLESHEET, bookStylesheet(own, themeUrlFor(own)));

  checks.push(
    check(
      "a vault theme can start from a bundled one",
      (resolvedTheme ?? "").includes("--vs-novel--boten-font-size"),
      (resolvedTheme ?? "").slice(0, 200),
    ),
    check(
      "and pull in its own neighbours",
      (resolvedTheme ?? "").includes("letter-spacing: 0.2em"),
    ),
    check("its own rules survive", (resolvedTheme ?? "").includes("rebeccapurple")),
    check(
      "the preview links the resolved copy",
      themeUrlFor(own) === `${own.workspaceBase}${THEME_STYLESHEET}`,
      themeUrlFor(own),
    ),
    check("and the epub packs it", epubStylesheet(own).includes("rebeccapurple")),
    check(
      "vault stylesheets are offered as themes",
      themeChoices(own.app, "").some((choice) => choice.value === "themes/mine.css"),
    ),
  );

  let failed = 0;
  for (const result of checks) {
    if (!result.ok) failed += 1;
    console.log(`${result.ok ? "ok  " : "FAIL"} ${result.label}${result.detail && !result.ok ? `\n     ${result.detail}` : ""}`);
  }

  if (context.warnings.length > 0) {
    console.log("\nwarnings:");
    for (const warning of context.warnings) console.log(`  - ${warning.kind}: ${warning.message}`);
  }

  if (failed > 0 || process.env.VIVLIO_DUMP) {
    console.log(`\n--- html ---\n${html}`);
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks passed");
}

void main();
