/** Real pagination and EPUB integration for the essay theme.
 * node test/run.mjs test/essay.check.ts
 * VIVLIO_PLAYWRIGHT / VIVLIO_JSDOM select installed packages.
 * VIVLIO_ESSAY_OUTPUT optionally saves the sample PDF, EPUB and page PNGs.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, readdir, mkdir, stat, writeFile } from "node:fs/promises";
import { TFile, TFolder, Component, type App } from "obsidian";
import { buildBook } from "../src/build/pipeline";
import { DEFAULT_SETTINGS, DEFAULT_SANS_STACK } from "../src/config/defaults";
import { resolveConfig } from "../src/config/resolve";
import { load as loadYaml } from "js-yaml";
import { PreviewServer } from "../src/server/static";
import { buildEpub } from "../src/export/epub";
import { materializeAssets } from "../src/build/materialize";
import { flattenBundledTheme } from "../src/build/theme";
import JSZip from "jszip";

const requirePackage = createRequire(`${process.cwd()}/package.json`);
interface Page {
  emulateMedia(options: { media: string }): Promise<void>;
  goto(url: string): Promise<void>;
  waitForFunction(callback: () => boolean, arg: undefined, options: { timeout: number }): Promise<void>;
  evaluate<T>(callback: () => T): Promise<T>;
  locator(selector: string): { nth(index: number): { screenshot(options: { path: string }): Promise<unknown> } };
  pdf(options: { path: string; printBackground: boolean; preferCSSPageSize: boolean }): Promise<unknown>;
}
const { JSDOM } = requirePackage(process.env.VIVLIO_JSDOM || "jsdom") as {
  JSDOM: new () => { window: { DOMParser: typeof DOMParser; XMLSerializer: typeof XMLSerializer } };
};
const dom = new JSDOM();
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;
const { chromium } = requirePackage(process.env.VIVLIO_PLAYWRIGHT || "playwright") as {
  chromium: { launch(options: { channel: string; headless: boolean }): Promise<{
    newPage(options: { viewport: { width: number; height: number } }): Promise<Page>; close(): Promise<void>;
  }> };
};

async function main() {
  const root = "sample/essay";
  const folder = Object.assign(new TFolder(), { path: root, name: "essay" });
  const contents = new Map<string, string>();
  const files = new Map<string, TFile>();
  async function collect(path: string, parent: TFolder) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const fullPath = `${path}/${entry.name}`;
      if (entry.isDirectory()) {
        const sub = Object.assign(new TFolder(), { path: fullPath, name: entry.name, parent });
        parent.children.push(sub);
        await collect(fullPath, sub);
      } else {
        const info = await stat(fullPath);
        const file = Object.assign(new TFile(), { path: fullPath, name: entry.name, basename: entry.name.replace(/\.[^.]+$/, ""), extension: entry.name.split(".").at(-1), parent, stat: { size: info.size, mtime: info.mtimeMs, ctime: info.ctimeMs } });
        parent.children.push(file);
        files.set(fullPath, file);
        if (["md", "yaml"].includes(file.extension)) contents.set(fullPath, await readFile(fullPath, "utf8"));
      }
    }
  }
  await collect(root, folder);
  const settings = { ...DEFAULT_SETTINGS, fontFamily: "monospace", headingFontFamily: "monospace" };
  const yaml = loadYaml(contents.get(`${root}/vivlio.yaml`)!) as Record<string, unknown>;
  const inherited = resolveConfig({ settings, yaml: { theme: "essay" } }).config;
  assert.equal(inherited.headingFontFamily, "monospace", "theme selection alone preserves vault fonts");
  assert.equal(yaml.theme, "essay", "sample uses bundled essay theme");
  assert.ok(!yaml.css, "sample has no additional CSS");
  for (const [path, text] of contents) if (path.endsWith(".md")) assert.ok(!/<(?:style|figure|div|img)\b|style=/i.test(text), "sample uses Markdown without layout HTML");
  const pinned = resolveConfig({ settings, yaml }).config;
  assert.equal(pinned.fontFamily, DEFAULT_SANS_STACK, "sample YAML overrides vault body font");
  assert.equal(pinned.headingFontFamily, DEFAULT_SANS_STACK, "sample YAML overrides vault heading font");
  const resolve = (path: string) => files.get(path) ?? files.get(`${root}/${path}`) ?? files.get(`${root}/${path}.md`) ?? null;
  const decoyCover = Object.assign(new TFile(), { path: "other/images/cover.png", name: "cover.png", extension: "png" });
  const app = {
    vault: { getFileByPath: (path: string) => files.get(path) ?? null, cachedRead: async (file: TFile) => contents.get(file.path)!, readBinary: async (file: TFile) => new Uint8Array(await readFile(file.path)).buffer },
    metadataCache: { resolvedLinks: { [`${root}/01-morning.md`]: { [`${root}/images/walk.svg`]: 1 } }, getFirstLinkpathDest: (path: string) => path.endsWith("images/cover.png") ? decoyCover : resolve(path), getFileCache: (file: TFile) => ({ headings: [...(contents.get(file.path) ?? "").matchAll(/^(#{1,6}) (.+)$/gm)].map(m => ({ level: m[1].length, heading: m[2].trim() })) }) },
  } as unknown as App;
  const server = new PreviewServer();
  await server.start({ vaultRoot: process.cwd() });
  const browser = await chromium.launch({ channel: process.env.VIVLIO_BROWSER || "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1500 } });
    await page.emulateMedia({ media: "print" });
    const target = { kind: "config" as const, file: files.get(`${root}/vivlio.yaml`)!, folder };
    for (const size of ["四六判", "文庫"]) {
      const build = await buildBook({ app, settings, server, component: new Component(), target, mode: "pdf", overrides: { size, ...(size === "文庫" ? { charsPerLine: null, linesPerPage: null } : {}) } });
      assert.equal(build.warnings.length, 0, JSON.stringify(build.warnings));
      assert.deepEqual(build.context.imageSizes.get(`${root}/images/walk.svg`), { width: 180, height: 77 }, "real metadata link index measures the SVG viewport");
      await page.goto(server.bookViewerUrl(build.publicationUrl));
      await page.waitForFunction(() => (window as unknown as { coreViewer?: { readyState: string } }).coreViewer?.readyState === "complete", undefined, { timeout: 60000 });
      const pages = await page.evaluate(() => Array.from(document.querySelectorAll("[data-vivliostyle-page-container]")).map(p => {
        const sheet = p.getBoundingClientRect();
        return {
          text: p.textContent ?? "",
          title: !!p.querySelector(".titlepage"), toc: !!p.querySelector("#toc"), colophon: !!p.querySelector("[role='doc-colophon']"),
          chapters: Array.from(p.querySelectorAll(".vivlio-chapter-title")).map(el => el.textContent),
          headingFonts: Array.from(p.querySelectorAll("h1,h2,h3")).map(el => getComputedStyle(el).fontFamily),
          bodyFonts: Array.from(p.querySelectorAll("p")).map(el => getComputedStyle(el).fontFamily),
          sections: Array.from(p.querySelectorAll("h2:not(.vivlio-chapter-title)")).map(el => ({ text: el.textContent, before: getComputedStyle(el).breakBefore })),
          quotes: p.querySelectorAll("blockquote").length,
          calloutTitles: Array.from(p.querySelectorAll(".callout-title")).map(el => ({ text: el.textContent, after: getComputedStyle(el).breakAfter })),
          callouts: Array.from(p.querySelectorAll(".callout")).map(el => ({ type: el.getAttribute("data-callout"), rule: getComputedStyle(el).borderBlockStartStyle, endRule: getComputedStyle(el).borderBlockEndStyle })),
          captionPrefixes: Array.from(p.querySelectorAll("figure figcaption")).map(el => getComputedStyle(el, "::before").content),
          images: Array.from(p.querySelectorAll("figure img")).map(img => ({ loaded: (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0, contentWidthPx: (() => { const style = getComputedStyle(img); return parseFloat(style.width) - (style.boxSizing === "border-box" ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) : 0); })(), caption: img.closest("figure")?.querySelector("figcaption")?.textContent ?? "" })),
          overflow: Array.from(p.querySelectorAll("h1,h2,h3,p,blockquote,figure,img,li,.callout")).filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.left < sheet.left - 1 || r.right > sheet.right + 1 || r.top < sheet.top - 1 || r.bottom > sheet.bottom + 1);
          }).map(el => el.textContent?.slice(0, 80) ?? el.tagName),
        };
      }));
      const output = process.env.VIVLIO_ESSAY_OUTPUT;
      if (output) {
        await mkdir(`${output}/${size}`, { recursive: true });
        await writeFile(`${output}/${size}/layout.json`, JSON.stringify(pages, null, 2));
        for (let i = 0; i < pages.length; i++) await page.locator("[data-vivliostyle-page-container]").nth(i).screenshot({ path: `${output}/${size}/page-${String(i + 1).padStart(2, "0")}.png` });
        if (size === "四六判") await page.pdf({ path: `${output}/essay.pdf`, printBackground: true, preferCSSPageSize: true });
      }
      assert.deepEqual(pages.flatMap(p => p.overflow), [], `${size}: no page overflow`);
      assert.ok(pages.some(p => p.title) && pages.some(p => p.toc) && pages.some(p => p.colophon));
      assert.equal(pages.flatMap(p => p.chapters).length, 2);
      assert.ok(pages.flatMap(p => p.headingFonts).every(font => font.includes("Yu Gothic") && !font.includes("monospace")), "rendered headings use YAML fonts over vault settings");
      assert.ok(pages.flatMap(p => p.bodyFonts).every(font => font.includes("Yu Gothic") && !font.includes("monospace")), "rendered body uses YAML fonts over vault settings");
      assert.ok(pages.some(p => p.chapters.includes("スヌーズは会議である") && p.sections.some(s => s.text === "五分後の私ならできる")), "section follows chapter on the same page");
      assert.ok(pages.flatMap(p => p.sections).every(s => s.before === "auto"));
      const images = pages.flatMap(p => p.images);
      assert.equal(images.length, 1);
      assert.ok(images[0].loaded && images[0].caption.includes("模式図"));
      assert.ok(Math.abs(images[0].contentWidthPx - 180) < 0.1, "diagram stays 180px / 47.625mm wide instead of filling the page");
      assert.ok(pages.flatMap(p => p.captionPrefixes).every(prefix => prefix === "none"));
      assert.ok(pages.flatMap(p => p.calloutTitles).every(title => title.after === "avoid"));
      const starts: Record<string, string> = { "本日の発見": "通知がなくても", "翌朝の自分へ": "昨夜のやる気を", "本日の決議": "お湯を沸かした", "私調べの攻略法": "気になることは紙に" };
      for (const p of pages) for (const title of p.calloutTitles) {
        assert.ok(p.text.includes(starts[title.text ?? ""]), "aside title stays with its text");
      }
      const families: Record<string, string> = { note: "solid", tip: "dashed", warning: "double", quote: "solid" };
      for (const [type, rule] of Object.entries(families)) {
        const boxes = pages.flatMap(p => p.callouts).filter(c => c.type === type);
        assert.ok(boxes.length > 0 && boxes.every(c => c.rule === rule && c.endRule === rule), `${type} has its own monochrome rule`);
      }
      assert.ok(pages.map(p => p.text).join("").includes("待つ練習をしてもらおう"));
      process.stdout.write(`ok essay ${size}: ${pages.length} pages, headings, figures, book matter and bounds\n`);
    }
    const epub = await buildBook({ app, settings: DEFAULT_SETTINGS, server, component: new Component(), target, mode: "epub" });
    await materializeAssets(epub.context, { forEpub: true, keepBytes: true });
    const bytes = await buildEpub(epub.context, epub.chapters, null);
    const archive = await JSZip.loadAsync(bytes);
    assert.equal(Object.keys(archive.files).filter(path => path.endsWith(".svg")).length, 1);
    const docs = await Promise.all(Object.keys(archive.files).filter(path => path.endsWith(".xhtml")).map(path => archive.file(path)!.async("string")));
    assert.ok(docs.some(text => text.includes("待つ練習をしてもらおう")));
    assert.ok(docs.some(text => text.includes("figcaption") && text.includes("模式図")));
    for (const type of ["note", "tip", "warning", "quote"]) assert.ok(docs.some(text => text.includes(`data-callout="${type}"`)), `${type} survives EPUB packaging`);
    const css = flattenBundledTheme("vivlio/essay.css");
    assert.ok(css.includes("--vivlio-essay--chapter-size") && !css.includes("@import"), "nested bundled import is flattened");
    if (process.env.VIVLIO_ESSAY_OUTPUT) await writeFile(`${process.env.VIVLIO_ESSAY_OUTPUT}/essay.epub`, bytes);
    process.stdout.write("ok essay EPUB: packaged manuscript, image and resolved theme\n");

    // A single note uses H2 for chapters. A long quote must fragment rather
    // than disappear, overflow or force the entire block onto a blank page.
    const single = files.get(`${root}/01-morning.md`)!;
    contents.set(single.path, "# 一冊の随筆\n\n## 第一章\n\n冒頭の本文。\n\n### 節の見出し\n\n" +
      Array.from({ length: 35 }, (_, i) => `> 引用${i + 1}。長い引用も本文の流れに沿ってページをまたぎ、最後まで読めることを確かめる。`).join("\n>\n") +
      "\n\n> [!warning] 長い注意書き\n" +
      Array.from({ length: 35 }, (_, i) => `> 補足${i + 1}。種類付きの補足も途中で切り捨てず、改ページした先まで本文と罫線を表示する。`).join("\n>\n") +
      ["info", "hint", "caution", "cite", "custom"].map(type => `\n\n> [!${type}] 同義語の確認\n> ${type}の本文。`).join("") +
      "\n\n## 第二章\n\n最終章の本文。");
    const singleBuild = await buildBook({ app, settings: DEFAULT_SETTINGS, server, component: new Component(), target: { kind: "note", file: single }, mode: "pdf", overrides: { theme: "essay", title: "一冊の随筆", sections: { titlePage: "auto", toc: "off", colophon: "off" } } });
    await page.goto(server.bookViewerUrl(singleBuild.publicationUrl));
    await page.waitForFunction(() => (window as unknown as { coreViewer?: { readyState: string } }).coreViewer?.readyState === "complete", undefined, { timeout: 60000 });
    const singlePages = await page.evaluate(() => Array.from(document.querySelectorAll("[data-vivliostyle-page-container]")).map(p => ({
      text: p.textContent ?? "", quote: !!p.querySelector("blockquote"),
      callouts: Array.from(p.querySelectorAll(".callout")).map(el => ({ type: el.getAttribute("data-callout"), rule: getComputedStyle(el).borderBlockStartStyle, endRule: getComputedStyle(el).borderBlockEndStyle })),
      chapters: Array.from(p.querySelectorAll(".vivlio-chapter-title")).map(el => ({ tag: el.tagName, text: el.textContent })),
    })));
    assert.equal(singlePages.flatMap(p => p.chapters).length, 2);
    assert.ok(singlePages.flatMap(p => p.chapters).every(h => h.tag === "H2"));
    assert.ok(singlePages.filter(p => p.quote).length > 1);
    const allText = singlePages.map(p => p.text).join("");
    assert.ok(allText.includes("引用35") && allText.includes("最終章の本文"));
    assert.ok(allText.includes("補足35"));
    assert.ok(singlePages.filter(p => p.callouts.some(c => c.type === "warning")).length > 1, "long warning fragments across pages");
    for (const [type, rule] of Object.entries({ info: "solid", hint: "dashed", caution: "double", cite: "solid", custom: "solid" })) {
      const boxes = singlePages.flatMap(p => p.callouts).filter(c => c.type === type);
      assert.ok(boxes.length && boxes.every(c => c.rule === rule && c.endRule === rule), `${type}: alias or unknown fallback`);
    }
    assert.ok(!singlePages.find(p => p.chapters.some(h => h.text === "第二章"))?.quote);
    process.stdout.write("ok essay single note: chapter breaks and long quotation fragmentation\n");
  } finally { await browser.close(); await server.stop(); }
}
void main().catch(error => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
