/**
 * Conversion smoke test.
 *
 * Runs the real VFM pipeline - notation rules, links, Obsidian block syntax -
 * against a note that exercises every stage of SPEC 5.3, and checks the
 * output. Runs outside Obsidian against the stub in obsidian-stub.ts.
 */
import { TFile } from "obsidian";
import { convertChapter } from "../src/build/vfm";
import { bookStylesheet } from "../src/build/css";
import { buildTocEntries } from "../src/build/toc";
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
const outsider = makeFile("elsewhere/Other.md");

const files: Record<string, TFile> = {
  "01": chapterOne,
  "02": chapterTwo,
  "fig.png": picture,
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
    headings: new Map([
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

《《ここは傍点》》になり、｜漢字《かんじ》にルビが付く。^^10^^ 年と 42 冊。

==ハイライト== は傍点になる。%%この注記は消える%%

> [!note] おぼえがき
> ここは callout の本文。

- [ ] まだ
- [x] おわった

#タグ は消える。 [[02]] は章間リンク、[[Other|よそのノート]] はただの文字列になる。

![[fig.png|300]]

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
    check("explicit tate-chu-yoko", html.includes('<span class="tcy">10</span>')),
    check("automatic tate-chu-yoko", html.includes('<span class="tcy">42</span>')),
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
    check("image width is logical", html.includes("inline-size: min(300px, 100%)")),
    check("stylesheet linked", html.includes('href="vivlio.css"')),
    check("plugin frontmatter is not a meta tag", !html.includes('name="vivlio-theme"')),
  ];

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
