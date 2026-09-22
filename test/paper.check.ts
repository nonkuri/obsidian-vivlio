/** Real Vivliostyle pagination: node test/run.mjs test/paper.check.ts.
 * Requires Playwright and jsdom. VIVLIO_PLAYWRIGHT / VIVLIO_JSDOM select
 * their local packages; VIVLIO_BROWSER selects the installed browser.
 * VIVLIO_PAPER_SCREENSHOT optionally names a directory for page PNGs.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { readFile, readdir, mkdir, stat, writeFile } from "node:fs/promises";
import { load as loadYaml } from "js-yaml";
import { TFile, TFolder, Component, type App } from "obsidian";
import { buildBook } from "../src/build/pipeline";
import { DEFAULT_SETTINGS } from "../src/config/defaults";
import { findPreset } from "../src/config/presets";
import { PreviewServer } from "../src/server/static";
import { epubStylesheet, buildEpub } from "../src/export/epub";
import { materializeAssets } from "../src/build/materialize";
import JSZip from "jszip";
import { assemblePaper } from "../src/build/paper";
import { Workspace } from "../src/build/workspace";
import type { BuildContext, Chapter } from "../src/build/context";

interface Page {
  pdf(options: { path: string; printBackground: boolean; preferCSSPageSize: boolean; margin: { top: number; bottom: number; left: number; right: number } }): Promise<unknown>;
  emulateMedia(options: { media: string }): Promise<void>;
  goto(url: string): Promise<void>;
  waitForFunction(callback: () => boolean, arg: undefined, options: { timeout: number }): Promise<void>;
  evaluate<T>(callback: () => T): Promise<T>;
  locator(selector: string): { nth(index: number): { screenshot(options: { path: string }): Promise<unknown> } };
}
const requirePackage = createRequire(`${process.cwd()}/package.json`);
const { JSDOM } = requirePackage(process.env.VIVLIO_JSDOM || "jsdom") as {
  JSDOM: new () => { window: { DOMParser: typeof DOMParser; XMLSerializer: typeof XMLSerializer } };
};
const dom = new JSDOM();
// Node-only harness: there is no Obsidian window in this process.
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;
const { chromium } = requirePackage(process.env.VIVLIO_PLAYWRIGHT || "playwright") as {
  chromium: { launch(options: { channel: string; headless: boolean }): Promise<{
    newPage(options: { viewport: { width: number; height: number } }): Promise<Page>; close(): Promise<void>;
  }> };
};

async function main() {
  checkPaperAssembly();
  const server = new PreviewServer();
  await server.start({ vaultRoot: process.cwd() });
  const browser = await chromium.launch({ channel: process.env.VIVLIO_BROWSER || "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    await page.emulateMedia({ media: "print" });
    const folder = Object.assign(new TFolder(), { path: "", name: "fixture" });
    const note = Object.assign(new TFile(), { path: "01.md", name: "01.md", basename: "01", extension: "md", parent: folder });
    folder.children.push(note);
    const manuscript = `# 調査報告

## 方法

これは論文テーマの組版を確認する本文です。図表と節番号、脚注を含みます。注記です[^note]。

### 対象

調査対象の説明です。

## 結果

### 集計

<figure class="fig" id="fig-result"><figcaption>調査の概要</figcaption><p>図の内容</p></figure>

図への参照：<a href="#fig-result" data-ref="fig"></a>。

<figure class="tbl" id="tbl-result"><figcaption>集計結果</figcaption>
<table><thead><tr><th>項目</th><th>結果</th></tr></thead>
<tbody><tr><td>対象数</td><td>120</td></tr><tr><td>平均値</td><td>4.5</td></tr></tbody></table></figure>

表への参照：<a href="#tbl-result" data-ref="tbl"></a>。

[^note]: 脚注の内容です。
`;
    const app = {
      vault: { getFileByPath: () => null, cachedRead: async () => manuscript },
      metadataCache: { getFirstLinkpathDest: () => null, getFileCache: () => ({}) },
    } as unknown as App;
    for (const numbering of ["continuous", "roman-then-arabic", "none"] as const) {
      const build = await buildBook({
        app, settings: DEFAULT_SETTINGS, server, component: new Component(),
        target: { kind: "folder", folder }, mode: "preview",
        overrides: {
          ...findPreset("paper")!.values,
          title: "調査報告", author: "著者名", publisher: "研究室",
          pageNumbering: numbering,
          sections: { titlePage: "auto", toc: "auto", colophon: "auto" },
        },
      });
      await page.goto(server.bookViewerUrl(build.publicationUrl));
      await page.waitForFunction(() => (window as unknown as { coreViewer?: { readyState: string } }).coreViewer?.readyState === "complete", undefined, { timeout: 30000 });
      const pages = await page.evaluate(() => Array.from(document.querySelectorAll("[data-vivliostyle-page-container]")).map((p) => ({
        text: p.textContent ?? "",
        title: !!p.querySelector(".titlepage"),
        toc: !!p.querySelector("#toc"),
        colophon: !!p.querySelector(".colophon"),
        headings: Array.from(p.querySelectorAll("h2, h3")).map(h => h.textContent),
        width: p.getBoundingClientRect().width,
        furniture: Array.from(p.querySelectorAll("[data-vivliostyle-page-margin-box]")).map(el => ({ name: el.getAttribute("data-vivliostyle-page-margin-box"), text: el.textContent, visible: getComputedStyle(el).visibility })),
      })));
      assert.equal(pages.length, 4, "short paper has no extra blank pages");
      assert.ok(pages.every(p => Math.abs(p.width - 210 * 96 / 25.4) < 1), "preset produces A4 pages");
      assert.ok(pages.some(p => p.title), "title page is laid out");
      assert.ok(pages.some(p => p.toc), "contents is laid out");
      assert.ok(pages.some(p => p.colophon && p.text.includes("研究室")), "generated colophon is laid out");
      const body = pages.filter(p => !p.title && !p.toc && !p.colophon);
      assert.ok(body.some(p => p.text.includes("脚注の内容")), "footnote survives pagination");
      assert.ok(body.some(p => p.text.includes("120")), "table survives pagination");
      assert.ok(body.some(p => p.headings.some(h => /1\s*方法/.test(h ?? ""))), "first section is numbered 1");
      assert.ok(body.some(p => p.headings.some(h => /1\.1\s*対象/.test(h ?? ""))), "subsection is numbered 1.1");
      assert.ok(body.some(p => p.headings.some(h => /2\s*結果/.test(h ?? ""))), "second section is numbered 2");
      assert.ok(body.some(p => p.headings.some(h => /2\.1\s*集計/.test(h ?? ""))), "subsection numbering restarts in each section");
      assert.ok(body.some(p => /図\s*1/.test(p.text)), "figure number resolves");
      assert.ok(body.some(p => /図への参照：図1/.test(p.text)), "figure reference resolves to its target");
      assert.ok(body.some(p => /表への参照：表1/.test(p.text)), "table reference resolves to its target");
      assert.ok(pages.filter(p => p.title || p.colophon).every(p => p.furniture.every(f => f.visible === "hidden")), "title and colophon have no visible folios");
      const folios = pages.flatMap(p => p.furniture.filter(f => f.name === "bottom-center" && f.visible === "visible").map(f => f.text));
      assert.deepEqual(folios, numbering === "none" ? [] : numbering === "continuous" ? ["2", "3"] : ["ii", "1"], "folio mode controls visible page numbers");
      const css = epubStylesheet(build.context);
      assert.ok(css.includes("--vs-section--h2-marker-content"), "EPUB carries academic numbering");
      assert.ok(css.includes(".colophon-detail dd"), "EPUB carries Vivlio front matter styles");
      assert.ok(!css.includes("@import"), "EPUB has no unresolved imports");
      process.stdout.write(`ok paper: ${numbering}, headings, references, footnotes, front matter and EPUB CSS\n`);
      if (process.env.VIVLIO_PAPER_FIXTURE_SCREENSHOT && numbering === "continuous") {
        for (let index = 0; index < pages.length; index++) {
          await page.locator("[data-vivliostyle-page-container]").nth(index).screenshot({ path: process.env.VIVLIO_PAPER_FIXTURE_SCREENSHOT.replace(".png", `-${index}.png`) });
        }
      }
    }
    await checkMultiFileSample(page, server);
  } finally {
    await browser.close();
    await server.stop();
  }
}

/** Reordering and repeated source IDs must not bind a reference to the wrong note. */
function checkPaperAssembly() {
  for (const order of [["a", "b"], ["b", "a"]]) {
    const workspace = new Workspace();
    const markup: Record<string, string> = {
      abstract: '<h1 id="title">要旨</h1>',
      a: '<h1 id="title">Alpha</h1><h2 id="detail">Detail</h2><a data-ref="sec" href="b.html#title"></a><a data-ref="fig" href="b.html#figure"></a><a href="#note">note</a><p id="note">Alpha note</p><figure class="fig" id="figure"><figcaption>Alpha plot</figcaption></figure>',
      b: '<h1 id="title">Beta</h1><a data-ref="fig" href="#figure"></a><a href="#note">note</a><p id="note">Beta note</p><figure class="fig" id="figure"><figcaption>Beta plot</figcaption></figure>',
      continuation: '<h2 id="detail">Continued</h2>',
      appendix: '<h1 id="title">付録 手順</h1><h2 id="detail">Code</h2>',
      references: '<h1 id="title">参考文献</h1>',
    };
    const roles: Record<string, string> = { abstract: "abstract", appendix: "appendix", references: "references" };
    const chapters: Chapter[] = ["abstract", ...order, "continuation", "appendix", "references"].map(name => ({
      docName: `${name}.html`, title: name, file: Object.assign(new TFile(), { path: name }),
      isBody: true, isFrontMatter: false, role: null, slot: null,
    }));
    for (const c of chapters) workspace.putText(c.docName, `<html><body>${markup[c.title]}</body></html>`);
    const context = {
      config: { theme: "paper", title: "Test", lang: "ja", writingMode: "horizontal-tb" },
      app: { metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: roles[file.path] ? { "vivlio-paper-role": roles[file.path] } : {} }) } },
      chapters, workspace, warnings: [],
    } as unknown as BuildContext;
    assemblePaper(context, chapters)();
    assert.equal(chapters.length, 1, "paper is one flowing body document");
    const doc = new DOMParser().parseFromString(workspace.getFile("paper.html")!.text!, "text/html");
    const ids = Array.from(doc.querySelectorAll("[id]"), el => el.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const a of Array.from(doc.querySelectorAll("a"))) {
      const target = doc.getElementById(a.getAttribute("href")!.split("#")[1]);
      assert.ok(target);
      if (a.hasAttribute("data-ref")) assert.ok(target.textContent?.startsWith(a.textContent));
      else assert.equal(a.closest("article"), target.closest("article"), "note IDs stay local");
    }
    assert.deepEqual(Array.from(doc.querySelectorAll("h1"), h => h.textContent), ["要旨", `1 ${order[0] === "a" ? "Alpha" : "Beta"}`, `2 ${order[1] === "a" ? "Alpha" : "Beta"}`, "付録A 手順", "参考文献"]);
    assert.ok(doc.querySelector('[data-paper-role="body"]'));
    assert.ok(Array.from(doc.querySelectorAll("h2")).some(h => h.textContent === `2.${order[1] === "a" ? "2" : "1"} Continued`), "a split source continues its parent section");
    assert.ok(chapters[0].tocHeadings?.some(h => h.text === "A.1 Code"));
  }
  process.stdout.write("ok paper assembly: reorder, duplicate anchors, section references, roles and split sections\n");
}

/** Read the distributed sample itself so fixture and user-facing files cannot drift. */
async function checkMultiFileSample(page: Page, server: PreviewServer) {
  const root = "sample/paper";
  const folder = Object.assign(new TFolder(), { path: root, name: "paper" });
  const contents = new Map<string, string>();
  const files = new Map<string, TFile>();
  async function collect(path: string, parent: TFolder) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const fullPath = `${path}/${entry.name}`;
      if (entry.isDirectory()) {
        const sub = Object.assign(new TFolder(), { path: fullPath, name: entry.name, parent });
        parent.children.push(sub);
        await collect(fullPath, sub);
        continue;
      }
      const info = await stat(fullPath);
      const file = Object.assign(new TFile(), { path: fullPath, name: entry.name, basename: entry.name.replace(/\.[^.]+$/, ""), extension: entry.name.split(".").at(-1), parent, stat: { size: info.size, mtime: info.mtimeMs, ctime: info.ctimeMs } });
      parent.children.push(file);
      files.set(fullPath, file);
      if (["md", "yaml"].includes(file.extension)) contents.set(fullPath, await readFile(fullPath, "utf8"));
    }
  }
  await collect(root, folder);
  const images = [...files.values()].filter(f => f.extension === "png");
  assert.equal(images.length, 5, "sample supplies five real figures");
  const resolve = (path: string) => files.get(path) ?? files.get(`${root}/${path}`) ?? files.get(`${root}/${path}.md`) ?? null;
  const resolvedLinks = Object.fromEntries([...contents].filter(([path]) => path.endsWith(".md")).map(([path, text]) => [path, Object.fromEntries(images.filter(f => text.includes(f.path.slice(root.length+1))).map(f => [f.path, 1]))]));
  const app = {
    vault: {
      getFileByPath: resolve,
      cachedRead: async (file: TFile) => contents.get(file.path)!,
      readBinary: async (file: TFile) => new Uint8Array(await readFile(file.path)).buffer,
    },
    metadataCache: {
      resolvedLinks,
      getFirstLinkpathDest: resolve,
      getFileCache: (file: TFile) => {
        const text = contents.get(file.path) ?? "";
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
        return {
          frontmatter: frontmatter ? loadYaml(frontmatter[1]) : {},
          headings: [...text.matchAll(/^(#{1,6}) (.+)$/gm)].map(m => ({ level: m[1].length, heading: m[2].trim() })),
        };
      },
    },
  } as unknown as App;
  const sampleConfig = loadYaml(contents.get(`${root}/vivlio.yaml`)!) as { css?: string };
  assert.ok(!sampleConfig.css, "sample must expose standard paper without CSS workarounds");
  for (const [path, text] of contents) {
    if (/\/\d{2}-.*\.md$/.test(path)) {
      assert.ok(!/^(?:#{1,6} |title: )(?:\d+(?:\.\d+)* |A\.\d+ |付録A)/m.test(text), `no manual heading numbers: ${path}`);
    }
  }
  const failures: string[] = [];
  const verify = (label: string, check: () => void) => {
    try { check(); } catch (error) { failures.push(`${label}: ${String(error)}`); }
  };
  const target = { kind: "config" as const, file: files.get(`${root}/vivlio.yaml`)!, folder };
  for (const numbering of ["continuous", "roman-then-arabic", "none"] as const) {
    const build = await buildBook({
      app, settings: DEFAULT_SETTINGS, server, component: new Component(), target,
      mode: process.env.VIVLIO_PAPER_PDF ? "pdf" : "preview", overrides: { pageNumbering: numbering },
    });
    assert.equal(build.context.config.theme, "paper", "sample YAML selects the paper theme");
    assert.deepEqual(build.context.chapters.filter(c => c.isBody).flatMap(c => c.sources ?? [c]).map(c => c.file?.basename), ["00-abstract", "01-background", "02-methods", "03-results", "04-discussion", "05-references", "06-appendix"], "index specifies seven manuscripts in order");
    assert.equal(build.context.warnings.length, 0, JSON.stringify(build.context.warnings));
    const paperDoc = new DOMParser().parseFromString(build.context.workspace.getFile("paper.html")!.text!, "text/html");
    const ids = Array.from(paperDoc.querySelectorAll("[id]"), el => el.id);
    assert.equal(new Set(ids).size, ids.length, "joined notes have unique anchors");
    for (const a of Array.from(paperDoc.querySelectorAll('a[href^="paper.html#"]'))) {
      assert.ok(paperDoc.getElementById(a.getAttribute("href")!.slice("paper.html#".length)), `valid local reference: ${a.outerHTML}`);
    }
    for (const role of ["abstract", "references"]) {
      assert.equal(paperDoc.querySelectorAll(`[data-paper-role='${role}'] :is(h1,h2) .vivlio-paper-number`).length, 0, `${role} headings are unnumbered`);
    }
    assert.deepEqual(Array.from(paperDoc.querySelectorAll("[data-paper-role='appendix'] :is(h1,h2) .vivlio-paper-number"), n => n.textContent?.trim()), ["付録A", "A.1", "A.2"]);
    if (process.env.VIVLIO_PAPER_SCREENSHOT && numbering === "continuous") {
      await mkdir(process.env.VIVLIO_PAPER_SCREENSHOT, { recursive: true });
      await writeFile(`${process.env.VIVLIO_PAPER_SCREENSHOT}/paper.html`, build.context.workspace.getFile("paper.html")!.text!);
    }
    await page.goto(server.bookViewerUrl(build.publicationUrl));
    await page.waitForFunction(() => (window as unknown as { coreViewer?: { readyState: string } }).coreViewer?.readyState === "complete", undefined, { timeout: 30000 });
    const pages = await page.evaluate(() => Array.from(document.querySelectorAll("[data-vivliostyle-page-container]")).map(p => ({
      text: p.textContent ?? "",
      headings: Array.from(p.querySelectorAll("h1, h2, h3")).map(h => h.textContent ?? ""),
      title: !!p.querySelector(".titlepage"), toc: !!p.querySelector("#toc"), colophon: !!p.querySelector(".colophon"),
      folios: Array.from(p.querySelectorAll('[data-vivliostyle-page-margin-box="bottom-center"]')).filter(el => getComputedStyle(el).visibility === "visible").map(el => el.textContent),
      links: Array.from(p.querySelectorAll("a.vivlio-link")).map(el => el.getAttribute("href")),
      captions: Array.from(p.querySelectorAll("figcaption")).map(el => el.textContent),
      figures: Array.from(p.querySelectorAll(".vivlio-paper-figure")).map(el => {
        const box = el.getBoundingClientRect();
        const sheet = p.getBoundingClientRect();
        const image = el.querySelector("img")?.getBoundingClientRect();
        const caption = el.querySelector("figcaption")?.getBoundingClientRect();
        return {
          label: el.querySelector(".vivlio-paper-number")?.textContent?.trim(),
          top: box.top - sheet.top, bottom: box.bottom - sheet.top, pageHeight: sheet.height,
          captionBelowImage: !!image && !!caption && caption.top >= image.bottom - 1,
          overlappingText: Array.from(p.querySelectorAll("p, h1, h2, h3, table")).some(text => {
            if (el.contains(text)) return false;
            const rect = text.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.left < box.right - 1 && rect.right > box.left + 1 && rect.top < box.bottom - 1 && rect.bottom > box.top + 1;
          }),
        };
      }),
      images: Array.from(p.querySelectorAll("img")).map(el => ({ loaded: el.complete && el.naturalWidth > 0, width: el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft) - parseFloat(getComputedStyle(el).paddingRight), height: el.clientHeight - parseFloat(getComputedStyle(el).paddingTop) - parseFloat(getComputedStyle(el).paddingBottom), ratio: el.naturalWidth / el.naturalHeight, alt: el.alt })),
      trialRows: Array.from(p.querySelectorAll("tr")).map(el => el.textContent?.trim() ?? "").filter(text => /^S\d{2}/.test(text)),
      tableCaptions: Array.from(p.querySelectorAll(".vivlio-paper-table-caption")).map(el => ({text: el.textContent, top: el.getBoundingClientRect().top, display: getComputedStyle(el).display})),
      trialHeaders: Array.from(p.querySelectorAll("thead")).filter(el => el.textContent?.includes("系列ID")).length,
      math: p.querySelectorAll("math").length,
      overflow: Array.from(p.querySelectorAll("p, table, img, h1, h2, h3")).filter(el => {
        const box = el.getBoundingClientRect();
        const sheet = p.getBoundingClientRect();
        return box.width > 0 && (box.left < sheet.left - 1 || box.right > sheet.right + 1);
      }).map(el => el.textContent?.slice(0, 60) || el.tagName),
    })));
    if (process.env.VIVLIO_PAPER_SCREENSHOT && numbering === "continuous") await writeFile(`${process.env.VIVLIO_PAPER_SCREENSHOT}/layout.json`, JSON.stringify(pages, null, 2));
    const body = pages.filter(p => !p.title && !p.toc && !p.colophon);
    verify(numbering, () => assert.deepEqual(body.flatMap(p => p.headings).filter(h => /^(?:\d+[.\s]*)?(?:はじめに|方法|結果|考察と結論)$/.test(h)), ["1 はじめに", "2 方法", "3 結果", "4 考察と結論"], "P01: automatic chapter numbering across manuscripts"));
    verify(numbering, () => assert.deepEqual(pages.flatMap(p => p.overflow), [], "text after a fragmented table stays inside the page"));
    if (process.env.VIVLIO_PAPER_SCREENSHOT && numbering === "continuous") {
      await mkdir(process.env.VIVLIO_PAPER_SCREENSHOT, { recursive: true });
      for (let index=0; index<pages.length; index++) {
        await page.locator("[data-vivliostyle-page-container]").nth(index).screenshot({ path: `${process.env.VIVLIO_PAPER_SCREENSHOT}/paper-${String(index+1).padStart(2,"0")}.png` });
      }
    }
    const renderedImages = pages.flatMap(p => p.images);
    verify(numbering, () => assert.equal(renderedImages.length, 5, "all five figures render exactly once"));
    verify(numbering, () => assert.ok(renderedImages.every(i => i.loaded && i.width > 300 && Math.abs(i.width/i.height - i.ratio) < .02), JSON.stringify(renderedImages)));
    const captionPages = pages.filter(p => p.images.length);
    const figures = pages.flatMap(p => [...p.figures].sort((a,b) => a.top - b.top));
    verify(numbering, () => assert.deepEqual(figures.map(f => f.label), ["図1", "図2", "図3", "図4", "図5"], "page floats preserve visual figure order"));
    verify(numbering, () => assert.ok(figures.every(f => f.captionBelowImage && !f.overlappingText && f.top >= 0 && f.bottom < f.pageHeight), "each complete figure and caption stays inside its page without overlapping prose"));
    const figure3Page = pages.find(p => p.figures.some(f => f.label === "図3"))!;
    verify(numbering, () => assert.ok(Math.max(...figure3Page.figures.map(f => f.bottom)) > figure3Page.figures[0].pageHeight * .75, "page floats fill the former half-empty figure 3 page"));
    const referencesPage = pages.findIndex(p => !p.toc && p.headings.includes("参考文献"));
    verify(numbering, () => assert.ok(pages.every((p,i) => !p.figures.length || i < referencesPage), "body figures do not drift into references or appendix"));
    for (const [label, mention] of [["図2", "図2は系列S01"], ["図3", "図3に平均RMSE"], ["図5", "条件別の曲線を図5"]]) {
      const mentionPage = pages.findIndex(p => p.text.includes(mention));
      const figurePage = pages.findIndex(p => p.figures.some(f => f.label === label));
      verify(numbering, () => assert.ok(mentionPage >= 0 && figurePage >= mentionPage && figurePage - mentionPage <= 2, `${label} stays within two pages of its first reference`));
    }
    verify(numbering, () => assert.ok(captionPages.every(p => p.captions.some(c => c?.startsWith("図"))), "figures keep their captions on the same page"));
    verify(numbering, () => assert.equal(pages.flatMap(p => p.trialRows).length, 48, "long table retains all 48 rows exactly once"));
    verify(numbering, () => assert.equal(new Set(pages.flatMap(p => p.trialRows).map(row => row.slice(0,3))).size, 48));
    verify(numbering, () => assert.ok(pages.filter(p => p.trialRows.length).length >= 2, "long table really spans pages"));
    verify(numbering, () => assert.ok(pages.filter(p => p.trialRows.length).every(p => p.trialHeaders > 0), "table header repeats on each fragment"));
    const tableFragments = pages.filter(p => p.trialRows.length);
    verify(numbering, () => assert.ok(tableFragments.every((p, index) => p.tableCaptions.some(c => c.text?.includes("表6") && (index === 0 || c.text.includes("続き")))), "P05: table number and continuation repeat with column headers"));
    verify(numbering, () => assert.ok(body.some(p => p.text.includes("主要指標は次式") && p.math > 0), "P04: equation stays with its introduction"));
    verify(numbering, () => assert.equal(body.map(p => p.text).join(" ").split("https://numpy.org/doc/2.3/reference/generated/numpy.interp.html").length - 1, 1, "P06: reference URL appears once"));
    verify(numbering, () => assert.ok(pages.reduce((sum,p) => sum+p.math, 0) >= 2, "equations render as MathML"));
    const discussion = body.filter(p => /誤差の解釈|個々の系列について一律/.test(p.text)).map(p => p.text).join(" ");
    verify(numbering, () => assert.ok(/図4/.test(discussion), "cross-file figure 4 reference resolves"));
    verify(numbering, () => assert.ok(body.some(p => p.text.includes("表3") && p.text.includes("欠測点上のRMSE")), "cross-file table 3 reference resolves"));
    const tocPages = pages.filter(p => p.toc);
    verify(numbering, () => assert.ok(tocPages.some(p => p.text.includes("再現手順と系列別結果")), "contents reaches the appendix"));
    verify(numbering, () => assert.ok(tocPages.some(p => p.text.includes("2 方法") && p.text.includes("A.2 系列別")), "P01: contents carries the generated heading numbers"));
    const first = numbering === "continuous" ? pages.indexOf(body[0])+1 : 1;
    verify(numbering, () => assert.deepEqual(body.flatMap(p => p.folios), numbering === "none" ? [] : body.map((_,i) => String(first+i)), "page numbers continue across all manuscripts"));
    process.stdout.write(`checked paper research sample: ${numbering}, ${pages.length} pages, five figures, six tables\n`);
    if (process.env.VIVLIO_PAPER_PDF && numbering === "roman-then-arabic") {
      await mkdir(dirname(process.env.VIVLIO_PAPER_PDF), { recursive: true });
      await page.pdf({ path: process.env.VIVLIO_PAPER_PDF, printBackground: true, preferCSSPageSize: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
    }
  }
  const epub = await buildBook({ app, settings: DEFAULT_SETTINGS, server, component: new Component(), target, mode: "epub" });
  await materializeAssets(epub.context, { forEpub: true, keepBytes: true });
  assert.equal(epub.context.warnings.length, 0, JSON.stringify(epub.context.warnings));
  const archive = await JSZip.loadAsync(await buildEpub(epub.context, epub.chapters, null));
  const bundledImages = Object.keys(archive.files).filter(path => path.endsWith(".png"));
  assert.equal(bundledImages.length, 5, "EPUB packages all five figures");
  for (const image of bundledImages) assert.ok((await archive.file(image)!.async("uint8array")).length > 10000);
  const documents = await Promise.all(Object.keys(archive.files).filter(path => path.endsWith(".xhtml")).map(path => archive.file(path)!.async("string")));
  assert.ok(documents.some(text => text.includes("S48")), "EPUB contains the end of the long table");
  assert.ok(documents.every(text => !/src="https?:\/\//.test(text)), "EPUB images are local");
  process.stdout.write("ok paper research sample: EPUB embeds figures, equations and complete appendix\n");
  assert.equal(failures.length, 0, `Standard paper acceptance failures (do not compensate in the sample):\n${failures.join("\n")}`);
}
void main().catch(error => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
