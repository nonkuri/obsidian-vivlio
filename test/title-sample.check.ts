/** Render the chapter-title sample with the real Vivliostyle engine.
 * Run: node test/run.mjs test/title-sample.check.ts
 * VIVLIO_PLAYWRIGHT may name an external Playwright installation. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { TFile, TFolder, Component, type App } from "obsidian";
import { buildBook } from "../src/build/pipeline";
import { DEFAULT_SETTINGS, PAPER_SIZES } from "../src/config/defaults";
import { PreviewServer } from "../src/server/static";

const req = createRequire(`${process.cwd()}/package.json`);
interface BrowserPage {
  emulateMedia(options: { media: string }): Promise<void>;
  goto(url: string): Promise<void>;
  waitForFunction(callback: () => boolean, arg: undefined, options: { timeout: number }): Promise<void>;
  evaluate<T>(callback: () => T): Promise<T>;
}
interface Browser {
  newPage(options: { viewport: { width: number; height: number } }): Promise<BrowserPage>;
  close(): Promise<void>;
}
const { chromium } = req(process.env.VIVLIO_PLAYWRIGHT || "playwright") as {
  chromium: { launch(options: { channel: string; headless: boolean }): Promise<Browser> };
};
async function main() {
  const server = new PreviewServer();
  await server.start({ vaultRoot: process.cwd() });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1800 } });
    await page.emulateMedia({ media: "print" });
    for (const size of process.env.VIVLIO_CHECK_SIZE ? [process.env.VIVLIO_CHECK_SIZE] : [...Object.keys(PAPER_SIZES), "140mm 200mm"]) {
    for (const single of [false, true]) {
      const folder = Object.assign(new TFolder(), { path: "", name: "fixture" });
      const text = new Map<string, string>();
      const files = new Map<string, TFile>();
      const note = (path: string, content: string) => {
        const file = Object.assign(new TFile(), { path, name: path, basename: path.replace(/\.[^.]+$/, ""), extension: path.split(".").at(-1), parent: folder });
        files.set(path, file); text.set(path, content);
        if (path.endsWith(".md")) folder.children.push(file);
      };
      note("01.md", "# 第一章\n\n" + Array.from({length: 18}, (_, i) => `本文${i}。` + "これは判型を変えて本文の配置を確認するための文章です。".repeat(7)).join("\n\n"));
      const second = "第二章・" + "遠い町の図書館で出会った人々の物語".repeat(3);
      note("02.md", `# ${second}\n\n次の章の本文です。`);
      if (single) {
        text.set("01.md", "# 章扉検証\n\n" + text.get("01.md")!.replace(/^# /, "## ") + "\n\n" + text.get("02.md")!.replace(/^# /, "## "));
        folder.children.splice(1, 1);
      }
      const matter = {
        dedication: "献辞.md", preface: "まえがき.md", afterword: "あとがき.md",
        appendix: "付録.md", bibliography: "参考文献.md", acknowledgments: "謝辞.md",
      };
      for (const name of Object.values(matter)) note(name, `# ${name.slice(0, -3)}\n\nこれは前後付けの文章です。`);
      note("sample/novel-title-page.css", readFileSync("sample/novel-title-page.css", "utf8"));
      const app = {
        vault: { getFileByPath: (p: string) => files.get(p) ?? null, cachedRead: async (f: TFile) => text.get(f.path) || "" },
        metadataCache: { getFirstLinkpathDest: (p: string) => files.get(p) ?? null, getFileCache: (f: TFile) => ({ headings: [...(text.get(f.path) || "").matchAll(/^(#+) (.+)$/gm)].map(m => ({ level: m[1].length, heading: m[2], position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } })) }) },
      } as unknown as App;
      const build = await buildBook({ app, settings: DEFAULT_SETTINGS, server, component: new Component(), target: single ? { kind: "note", file: files.get("01.md")! } : { kind: "folder", folder }, mode: "preview", overrides: {
        title: "章扉検証", theme: "sample/novel-title-page.css", size, writingMode: "vertical-rl", charsPerLine: null, linesPerPage: null, columns: null, startSide: "any",
        sections: { ...DEFAULT_SETTINGS.sectionDefaults, titlePage: single ? "auto" : "off", toc: "auto", colophon: "off", ...matter },
      } });
      await page.goto(server.bookViewerUrl(build.publicationUrl));
      await page.waitForFunction(() => (window as unknown as { coreViewer?: { readyState: string } }).coreViewer?.readyState === "complete", undefined, { timeout: 30000 });
      const result = await page.evaluate(() => Array.from(document.querySelectorAll("[data-vivliostyle-page-container]")).map(p => {
        const sheet = p.getBoundingClientRect();
        const heading = p.querySelector(".vivlio-chapter-title");
        const titleRange = document.createRange();
        if (heading) titleRange.selectNodeContents(heading);
        const titleRect = titleRange.getBoundingClientRect();
        return { side: p.getAttribute("data-vivliostyle-page-side"), title: p.querySelector(".vivlio-chapter-title")?.textContent,
          toc: Array.from(p.querySelectorAll("[role='doc-toc'] a[href]")).map(a => {
            const range = document.createRange(); range.selectNodeContents(a); const rect = range.getBoundingClientRect();
            const target = document.getElementById(a.getAttribute("href")!.slice(1))?.closest("[data-vivliostyle-page-container]") as (HTMLElement & { vivlioPageNumber: number }) | null;
            return { label: a.childNodes[0]?.textContent, number: a.querySelector("[data-vivliostyle-target-counter]")?.textContent, targetNumber: target?.vivlioPageNumber,
              inside: rect.left >= sheet.left - 1 && rect.right <= sheet.right + 1 && rect.top >= sheet.top - 1 && rect.bottom <= sheet.bottom + 1 };
          }),
          titleInside: !heading || (titleRect.left >= sheet.left - 1 && titleRect.right <= sheet.right + 1 && titleRect.top >= sheet.top - 1 && titleRect.bottom <= sheet.bottom + 1),
          paragraphs: Array.from(p.querySelectorAll("p")).map(el => {
            const range = document.createRange(); range.selectNodeContents(el); const r = range.getBoundingClientRect();
            return { text: el.textContent?.slice(0, 10), inside: r.left >= sheet.left - 1 && r.right <= sheet.right + 1 && r.top >= sheet.top - 1 && r.bottom <= sheet.bottom + 1, x: r.left-sheet.left, width: r.width, y: r.top-sheet.top, height: r.height, sheet: [sheet.width,sheet.height] };
          }) };
      }));
      assert.deepEqual(result.flatMap(p => p.toc.map(e => e.label)), ["まえがき", "第一章", second, "あとがき", "付録", "参考文献", "謝辞"], "TOC lists each part once in book order and omits the dedication");
      assert.equal(build.chapters.filter(c => c.isBody).length, single ? 1 : 2, "front/back matter are not also body chapters");
      assert.equal(result.filter(p => p.title).length, 2, "both chapter titles are present");
      for (let i = 0; i < result.length; i++) {
        const p = result[i];
        for (const entry of p.toc) {
          assert.ok(entry.inside, "TOC entry stays on paper");
          assert.equal(Number(entry.number), entry.targetNumber, `TOC page number: ${entry.label}`);
        }
        if (p.title) {
          assert.ok(p.titleInside, "wrapped title stays on paper");
          assert.equal(p.side, "left"); assert.equal(p.paragraphs.length, 0, "title is alone");
          assert.equal(result[i + 2]?.side, "left"); assert.ok(result[i + 2]?.paragraphs.length, "body starts on the next left page");
        }
        assert.ok(p.paragraphs.every(x => x.inside), `${size}: body stays on paper: ${JSON.stringify(p.paragraphs.filter(x => !x.inside))}`);
      }
      process.stdout.write(`ok ${size}/${single ? "single note" : "multiple notes"}: chapter titles and body layout\n`);
    }
    }
  } finally { await browser.close(); await server.stop(); }
}
void main().catch(e => { process.stderr.write(String(e) + "\n"); process.exitCode = 1; });
