/** Real converter, Vivliostyle pagination and EPUB checks for short poetry.
 * VIVLIO_PLAYWRIGHT / VIVLIO_JSDOM select the external browser/DOM packages.
 * VIVLIO_VERSE_OUTPUT saves the six PDF comparisons and two EPUB samples. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, readdir, mkdir, stat, writeFile } from "node:fs/promises";
import { TFile, TFolder, Component, type App } from "obsidian";
import { buildBook } from "../src/build/pipeline";
import { DEFAULT_SETTINGS } from "../src/config/defaults";
import { resolveConfig } from "../src/config/resolve";
import { PreviewServer } from "../src/server/static";
import { buildEpub } from "../src/export/epub";
import JSZip from "jszip";

const requirePackage = createRequire(`${process.cwd()}/package.json`);
// These packages are test tools, not plugin dependencies.
const { JSDOM } = requirePackage(process.env.VIVLIO_JSDOM || "jsdom");
const dom = new JSDOM();
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;
const { chromium } = requirePackage(process.env.VIVLIO_PLAYWRIGHT || "playwright");

async function fixture(kind: string) {
  const root = `sample/${kind}`;
  const folder = Object.assign(new TFolder(), { path: root, name: kind });
  const contents = new Map<string, string>();
  const files = new Map<string, TFile>();
  async function collect(path: string, parent: TFolder) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = `${path}/${entry.name}`;
      if (entry.isDirectory()) {
        const sub = Object.assign(new TFolder(), { path: full, name: entry.name, parent });
        parent.children.push(sub);
        await collect(full, sub);
      } else {
        const info = await stat(full);
        const file = Object.assign(new TFile(), { path: full, name: entry.name, basename: entry.name.replace(/\.[^.]+$/, ""), extension: entry.name.split(".").at(-1), parent, stat: { size: info.size, mtime: info.mtimeMs, ctime: info.ctimeMs } });
        parent.children.push(file);
        files.set(full, file);
        if (["md", "yaml"].includes(file.extension)) contents.set(full, await readFile(full, "utf8"));
      }
    }
  }
  await collect(root, folder);
  const app = {
    vault: { getFileByPath: (path: string) => files.get(path) ?? null, cachedRead: async (file: TFile) => contents.get(file.path)!, readBinary: async (file: TFile) => new Uint8Array(await readFile(file.path)).buffer },
    metadataCache: { getFirstLinkpathDest: (path: string) => files.get(path) ?? files.get(`${root}/${path}`) ?? files.get(`${root}/${path}.md`) ?? null, getFileCache: (file: TFile) => ({ headings: [...(contents.get(file.path) ?? "").matchAll(/^(#{1,6}) (.+)$/gm)].map(m => ({ level: m[1].length, heading: m[2].trim() })) }) },
  } as unknown as App;
  return { app, contents, files, target: { kind: "config" as const, file: files.get(`${root}/vivlio.yaml`)!, folder } };
}

async function main() {
  for (const value of [1, 2, 3]) assert.equal(resolveConfig({ settings: DEFAULT_SETTINGS, yaml: { versePerPage: value } }).config.versePerPage, value);
  for (const value of [0, 4, 1.5, -1]) assert.equal(resolveConfig({ settings: DEFAULT_SETTINGS, yaml: { versePerPage: value } }).config.versePerPage, 2);
  const server = new PreviewServer();
  await server.start({ vaultRoot: process.cwd() });
  const browser = await chromium.launch({ channel: process.env.VIVLIO_BROWSER || "chrome", headless: true });
  const output = process.env.VIVLIO_VERSE_OUTPUT;
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1500 } });
    await page.emulateMedia({ media: "print" });
    for (const kind of ["haiku", "tanka"]) {
      const f = await fixture(kind);
      const args = { app: f.app, settings: DEFAULT_SETTINGS, server, component: new Component(), target: f.target };
      for (const count of [1, 2, 3]) {
        const build = await buildBook({ ...args, mode: "pdf", overrides: { versePerPage: count } });
        assert.deepEqual(build.warnings, []);
        await page.goto(server.bookViewerUrl(build.publicationUrl));
        await page.waitForFunction(() => (window as unknown as { coreViewer?: { readyState: string } }).coreViewer?.readyState === "complete", undefined, { timeout: 60000 });
        const pages = await page.evaluate(() => Array.from(document.querySelectorAll("[data-vivliostyle-page-container]")).map(p => {
          const sheet = p.getBoundingClientRect();
          return {
            text: p.textContent ?? "",
            works: Array.from(p.querySelectorAll(".vivlio-verse")).map(el => {
              const r = el.getBoundingClientRect();
              return { text: el.textContent, x: r.left - sheet.left, y: r.top - sheet.top, width: r.width, height: r.height, preface: el.querySelector(".vivlio-verse-preface")?.textContent, author: el.querySelector(".vivlio-verse-author")?.textContent };
            }),
            overflow: Array.from(p.querySelectorAll(".vivlio-verse, .vivlio-verse p, h1, h2")).filter(el => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && (r.left < sheet.left - 1 || r.right > sheet.right + 1 || r.top < sheet.top - 1 || r.bottom > sheet.bottom + 1);
            }).map(el => el.textContent),
            title: !!p.querySelector(".titlepage"), toc: !!p.querySelector("#toc"), colophon: !!p.querySelector("[role='doc-colophon']"),
            divider: !!p.querySelector(".vivlio-chapter-title"),
            side: p.getAttribute("data-vivliostyle-page-side"),
            sequence: !!p.querySelector(".vivlio-verse-sequence"),
          };
        }));
        if (output) {
          const dest = `${output}/${kind}-${count}`;
          await mkdir(dest, { recursive: true });
          await writeFile(`${dest}/layout.json`, JSON.stringify(pages, null, 2));
          for (let i = 0; i < pages.length; i++) await page.locator("[data-vivliostyle-page-container]").nth(i).screenshot({ path: `${dest}/page-${String(i + 1).padStart(2, "0")}.png` });
          await page.pdf({ path: `${output}/${kind}-${count}.pdf`, printBackground: true, preferCSSPageSize: true });
        }
        assert.deepEqual(pages.flatMap((p: { overflow: string[] }) => p.overflow), [], `${kind}/${count}: no page overflow`);
        assert.equal(pages.filter((p: { divider: boolean }) => p.divider).length, 2);
        assert.ok(pages.filter((p: { divider: boolean }) => p.divider).every((p: { side: string; works: unknown[] }) => p.side === "left" && p.works.length === 0), "chapter half titles open alone on the left");
        assert.ok(pages.some((p: { sequence: boolean; works: unknown[] }) => p.sequence && p.works.length > 0), "sequence heading stays with works");
        const workPages = pages.filter((p: { works: unknown[] }) => p.works.length);
        assert.deepEqual(workPages.map((p: { works: unknown[] }) => p.works.length), count === 1 ? [1,1,1,1,1,1,1,1] : count === 2 ? [2,2,1,2,1] : [3,2,2,1], `${kind}/${count}: counts and explicit break`);
        assert.ok(pages.some((p: { title: boolean }) => p.title) && pages.some((p: { toc: boolean }) => p.toc) && pages.some((p: { colophon: boolean }) => p.colophon));
        const works = workPages.flatMap((p: { works: { preface?: string; author?: string }[] }) => p.works);
        assert.ok(works.some((w: { preface?: string; author?: string }) => w.preface && w.author === "架空花子"), "preface and author stay with the work");
        console.log(`ok ${kind}/${count}: ${pages.length} pages, all 8 works, page counts and bounds`);
      }
      const build = await buildBook({ ...args, mode: "epub" });
      const epub = await buildEpub(build.context, build.chapters, null);
      const archive = await JSZip.loadAsync(epub);
      const docs = await Promise.all(Object.keys(archive.files).filter(p => p.endsWith(".xhtml")).map(p => archive.file(p)!.async("string")));
      const joined = docs.join("\n");
      assert.equal((joined.match(/data-verse=/g) ?? []).length, 8);
      assert.ok(!joined.includes('class="vivlio-verse-page"'));
      assert.ok(joined.includes("<ruby>") && joined.includes("架空花子") && /<br\s*\/?\s*>/.test(joined));
      if (kind === "haiku") assert.ok(joined.includes("　雨の駅"), "intentional leading space survives");
      const cssPath = Object.keys(archive.files).find(p => p.endsWith("vivlio.css"))!;
      const css = await archive.file(cssPath)!.async("string");
      const chapterDoc = docs.find(doc => doc.includes("data-verse="))!;
      const reflowPage = await browser.newPage({ viewport: { width: 390, height: 700 } });
      await reflowPage.setContent(chapterDoc.replace(/<link[^>]+>/g, "").replace("</head>", `<style>${css}</style></head>`));
      const reflow = await reflowPage.evaluate(() => Array.from(document.querySelectorAll(".vivlio-verse")).map(el => ({ minimum: getComputedStyle(el).minBlockSize, padding: getComputedStyle(el).padding, text: el.textContent })));
      assert.ok(reflow.length > 0 && reflow.every((work: { minimum: string; padding: string }) => work.minimum === "0px" && work.padding === "0px"));
      await reflowPage.close();
      if (output) await writeFile(`${output}/${kind}.epub`, epub);
      console.log(`ok ${kind}: reflow EPUB with ruby, explicit break and authors`);

      if (kind === "tanka") {
        const file = f.files.get("sample/tanka/01-home.md")!;
        f.contents.set(file.path, "# 長い作品\n\n> [!tanka]\n> " + "遠い山を見て歩いた。".repeat(180) + "最後の一語\n\n> [!tanka]\n> 後続作品");
        const long = await buildBook({ ...args, target: { kind: "note", file }, mode: "pdf", overrides: { theme: "tanka", writingMode: "vertical-rl", size: "四六判", charsPerLine: 34, linesPerPage: 12, columns: 1, versePerPage: 3, sections: { titlePage: "off", toc: "off", colophon: "off" } } });
        assert.ok(long.warnings.some(w => w.kind === "unsupported"));
        await page.goto(server.bookViewerUrl(long.publicationUrl));
        await page.waitForFunction(() => (window as unknown as { coreViewer?: { readyState: string } }).coreViewer?.readyState === "complete", undefined, { timeout: 60000 });
        const text = await page.evaluate(() => Array.from(document.querySelectorAll("[data-vivliostyle-page-container] .vivlio-verse-text")).map(p => p.textContent).join("").replace(/\s/g, ""));
        assert.equal((text.match(/遠い山を見て歩いた。/g) ?? []).length, 180);
        assert.ok(text.includes("最後の一語") && text.includes("後続作品"));
        console.log("ok long work: complete text flows across pages without shrinking or truncation");

        // A single-note manuscript spends H1 on the book title, so H2 must
        // become the divider while H3 stays with the opening work.
        f.contents.set(file.path, "# 一冊の歌集\n\n## 第一章\n\n### 連作の題\n\n> [!tanka]\n> 最初の歌\n\n## 第二章\n\n> [!tanka]\n> 次の歌");
        const single = await buildBook({ ...args, target: { kind: "note", file }, mode: "pdf", overrides: { title: "一冊の歌集", theme: "tanka", writingMode: "vertical-rl", size: "四六判", versePerPage: 2, sections: { titlePage: "auto", toc: "off", colophon: "off" } } });
        await page.goto(server.bookViewerUrl(single.publicationUrl));
        await page.waitForFunction(() => (window as unknown as { coreViewer?: { readyState: string } }).coreViewer?.readyState === "complete", undefined, { timeout: 60000 });
        const headings = await page.evaluate(() => Array.from(document.querySelectorAll("[data-vivliostyle-page-container]")).map(p => ({ side: p.getAttribute("data-vivliostyle-page-side"), chapters: Array.from(p.querySelectorAll(".vivlio-chapter-title")).map(h => h.textContent), sequence: p.querySelector(".vivlio-verse-sequence h3")?.textContent, work: p.querySelector(".vivlio-verse-text")?.textContent })));
        assert.deepEqual(headings.flatMap((p: { chapters: string[] }) => p.chapters), ["第一章", "第二章"]);
        assert.ok(headings.filter((p: { chapters: string[] }) => p.chapters.length).every((p: { side: string }) => p.side === "left"));
        assert.ok(headings.some((p: { sequence?: string; work?: string }) => p.sequence === "連作の題" && p.work?.includes("最初の歌")));
        console.log("ok single-note book: H2 half titles and H3 sequence remain distinct");
      }
    }
  } finally { await browser.close(); await server.stop(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
