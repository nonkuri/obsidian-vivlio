/** Inspect the actual built-in vertical themes, without supplemental CSS.
 * VIVLIO_PLAYWRIGHT selects an external Playwright installation.
 * VIVLIO_TITLE_OUTPUT optionally saves title-page screenshots and measurements. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { TFile, TFolder, Component, type App } from "obsidian";
import { buildBook } from "../src/build/pipeline";
import { DEFAULT_SETTINGS } from "../src/config/defaults";
import { PreviewServer } from "../src/server/static";

interface BrowserPage {
  emulateMedia(options: { media: string }): Promise<void>;
  goto(url: string): Promise<void>;
  waitForFunction(callback: () => boolean, arg: undefined, options: { timeout: number }): Promise<void>;
  evaluate<T>(callback: () => T): Promise<T>;
  locator(selector: string): { first(): { screenshot(options: { path: string }): Promise<unknown> } };
}
interface Browser { newPage(options: { viewport: { width: number; height: number } }): Promise<BrowserPage>; close(): Promise<void>; }
const requirePackage = createRequire(`${process.cwd()}/package.json`);
const { chromium } = requirePackage(process.env.VIVLIO_PLAYWRIGHT || "playwright") as {
  chromium: { launch(options: { channel: string; headless: boolean }): Promise<Browser> };
};

async function main() {
  const server = new PreviewServer();
  await server.start({ vaultRoot: process.cwd() });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const output = process.env.VIVLIO_TITLE_OUTPUT;
  if (output) await mkdir(output, { recursive: true });
  const folder = Object.assign(new TFolder(), { path: "", name: "fixture" });
  const file = Object.assign(new TFile(), { path: "title-fixture.md", name: "title-fixture.md", basename: "title-fixture", extension: "md", parent: folder });
  folder.children.push(file);
  const app = {
    vault: { getFileByPath: () => null, cachedRead: async () => "# 本文\n\n本扉を確認するための本文。" },
    metadataCache: { getFirstLinkpathDest: () => null, getFileCache: () => ({ headings: [{ level: 1, heading: "本文" }] }) },
  } as unknown as App;
  const variants = {
    short: { title: "遠い灯", subtitle: "", author: "山田花子", series: "", translator: "", publisher: "" },
    normal: { title: "改札の向こう", subtitle: "日々の記憶をたどる", author: "Vivlio サンプル編集部", series: "", translator: "", publisher: "" },
    full: { title: "遠い町の図書館で出会った人々の物語", subtitle: "失われた時間と小さな記憶をたどって", author: "山田花子", series: "小さな文芸叢書", translator: "佐藤太郎", publisher: "青空文庫編集室" },
  };
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1500 } });
    await page.emulateMedia({ media: "print" });
    for (const theme of ["novel", "novel-2col", "essay", "haiku", "tanka"]) {
      for (const [variant, metadata] of Object.entries(variants)) {
        const build = await buildBook({ app, settings: DEFAULT_SETTINGS, server, component: new Component(), target: { kind: "folder", folder }, mode: "preview", overrides: {
          ...metadata, theme, writingMode: "vertical-rl", size: theme === "novel" ? "A6" : "四六判", charsPerLine: 0, linesPerPage: 0,
          sections: { ...DEFAULT_SETTINGS.sectionDefaults, titlePage: "auto", toc: "off", colophon: "off" },
        } });
        assert.deepEqual(build.warnings, [], `${theme}/${variant}: valid built-in configuration`);
        await page.goto(server.bookViewerUrl(build.publicationUrl));
        await page.waitForFunction(() => (window as unknown as { coreViewer?: { readyState: string } }).coreViewer?.readyState === "complete", undefined, { timeout: 30000 });
        const result = await page.evaluate(() => {
          const pages = Array.from(document.querySelectorAll("[data-vivliostyle-page-container]")).filter(p => p.querySelector(".titlepage"));
          const sheet = pages[0].getBoundingClientRect();
          const labels = Array.from(pages[0].querySelectorAll(".titlepage p")).map(el => {
            const range = document.createRange();
            range.selectNodeContents(el);
            const r = range.getBoundingClientRect();
            return { kind: el.className, text: el.textContent, x: r.left - sheet.left, y: r.top - sheet.top, width: r.width, height: r.height };
          });
          return { pageCount: pages.length, side: pages[0].getAttribute("data-vivliostyle-page-side"), width: sheet.width, height: sheet.height, labels };
        });
        if (output) {
          await page.locator("[data-vivliostyle-page-container]").first().screenshot({ path: `${output}/${theme}-${variant}.png` });
          await writeFile(`${output}/${theme}-${variant}.json`, JSON.stringify(result, null, 2));
        }
        assert.equal(result.pageCount, 1, `${theme}/${variant}: title fits one page`);
        assert.equal(result.side, "left");
        for (const label of result.labels) {
          assert.ok(label.x >= 0 && label.y >= 0 && label.x + label.width <= result.width + 1 && label.y + label.height <= result.height + 1, `${theme}/${variant}: ${label.kind} stays on paper`);
        }
        assert.ok(result.labels.some(l => l.text?.includes(metadata.title)));
        assert.ok(result.labels.some(l => l.text?.includes(metadata.author)));
        const title = result.labels.find(l => l.kind === "title")!;
        const author = result.labels.find(l => l.kind === "author")!;
        assert.ok(title.x > author.x && author.y > title.y, `${theme}/${variant}: title and credits are offset`);
        if (variant === "normal") {
          assert.ok(title.x > result.width * 0.55 && title.x < result.width * 0.85, `${theme}: title is right of center, inside the page`);
          assert.ok(author.x > result.width * 0.15 && author.x < result.width * 0.45, `${theme}: credits are left of center, inside the page`);
        }
        process.stdout.write(`ok ${theme}/${variant}: one title page, all labels within bounds\n`);
      }
    }
  } finally { await browser.close(); await server.stop(); }
}
void main().catch(error => { process.stderr.write(String(error) + "\n"); process.exitCode = 1; });
