/** Real conversion and Vivliostyle navigation, including joined papers.
 * VIVLIO_JSDOM and VIVLIO_PLAYWRIGHT can name local packages.
 * Run: node test/run.mjs test/sourceSync.check.ts */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { TFile } from "obsidian";
import { baseBookConfig, DEFAULT_SETTINGS } from "../src/config/defaults";
import { convertChapter } from "../src/build/vfm";
import { collectSourceBlocks } from "../src/build/sourceMap";
import { assemblePaper } from "../src/build/paper";
import { publicationManifest } from "../src/build/manifest";
import { Workspace } from "../src/build/workspace";
import type { BuildContext, Chapter } from "../src/build/context";
import { PreviewServer } from "../src/server/static";
import { SOURCE_SYNC_MESSAGE } from "../src/server/sourceSync";

const requirePackage = createRequire(`${process.cwd()}/package.json`);
const { JSDOM } = requirePackage(process.env.VIVLIO_JSDOM || "jsdom") as {
  JSDOM: new () => { window: { DOMParser: typeof DOMParser } };
};
global.DOMParser = new JSDOM().window.DOMParser;
interface Page {
  goto(url: string): Promise<void>;
  waitForFunction<A>(fn: (arg: A) => boolean, arg?: A, options?: { timeout: number }): Promise<void>;
  evaluate<T, A>(fn: (arg: A) => T, arg?: A): Promise<T>;
  locator(selector: string): { first(): { click(): Promise<void> } };
}
const { chromium } = requirePackage(process.env.VIVLIO_PLAYWRIGHT || "playwright") as {
  chromium: { launch(options: { channel: string; headless: boolean }): Promise<{
    newPage(): Promise<Page>; close(): Promise<void>;
  }> };
};
type ViewerWindow = Window & { coreViewer?: { readyState: string }; syncMessages?: { action?: string; key?: string; cfi?: string }[] };

async function main() {
  const server = new PreviewServer();
  await server.start({ vaultRoot: process.cwd() });
  const browser = await chromium.launch({ channel: process.env.VIVLIO_BROWSER || "chrome", headless: true });
  try {
    for (const theme of ["novel", "paper"]) {
      const first = Object.assign(new TFile(), { path: "book/first.md", basename: "first" });
      const second = Object.assign(new TFile(), { path: "book/second.md", basename: "second" });
      const embedded = Object.assign(new TFile(), { path: "book/embedded.md", basename: "embedded" });
      const chapters: Chapter[] = [first, second].map((file, i) => ({ file, docName: `ch${i}.html`, title: file.basename,
        role: null, slot: null, isBody: true, isFrontMatter: false }));
      const workspace = new Workspace();
      server.addWorkspace(workspace);
      const embeddedText = "---\ntitle: Embedded\n---\n# Embedded\n\nEmbedded paragraph.";
      const context: BuildContext = {
        app: { vault: { cachedRead: async () => embeddedText }, metadataCache: {
          getFileCache: () => ({}), getFirstLinkpathDest: () => embedded,
        } } as unknown as BuildContext["app"],
        settings: DEFAULT_SETTINGS, config: { ...baseBookConfig(), theme, writingMode: theme === "novel" ? "vertical-rl" : "horizontal-tb" },
        workspace, mode: "preview", bookRoot: "book", chapters,
        chapterByPath: new Map(), headings: new Map(), imageSizes: new Map(), warnings: [],
        component: {} as BuildContext["component"], workspaceBase: `${server.base}/w/${workspace.id}/`,
        vaultBase: `${server.base}/vault/`, themeBase: `${server.base}/themes/`,
      };
      const firstText = "---\ntitle: First\n---\n# First\n\nOpening paragraph.\n\n- First item\n- Second item\n\n> [!note] A note\n> Callout paragraph.\n\n```js\nconst n = 1;\n```\n\n![[embedded#Embedded]]";
      const secondText = "# Second\n\n" + "Long text for pagination. ".repeat(400) + "\n\nTARGET paragraph with ｜漢字《かんじ》.\n\n[Link](#second)";
      for (const [i, source] of [firstText, secondText].entries()) {
        workspace.putText(chapters[i].docName, await convertChapter(context, chapters[i], chapters[i].file!, source));
      }
      const rewrite = assemblePaper(context, chapters);
      rewrite();
      const blocks = collectSourceBlocks(context, chapters);
      assert.ok(blocks.some(block => block.path === first.path && block.start === 5), "frontmatter preserves source line numbers");
      assert.ok(blocks.some(block => block.path === first.path && block.start === 7), "list item is mapped");
      assert.ok(blocks.some(block => block.path === first.path && block.start === 13), "code fence is mapped after VFM plugins");
      assert.ok(blocks.some(block => block.path === embedded.path && block.start === 5), "section embeds preserve original file and line");
      assert.equal(context.sourceTexts?.get(embedded.path), embeddedText);
      const target = blocks.find(block => block.path === second.path && block.start === 4)!;
      assert.ok(target);
      if (theme === "paper") assert.ok(target.url.includes("paper.html#"));
      workspace.putText("vivlio.css", `@page { size: 100mm 140mm; margin: 10mm; } body { writing-mode: ${context.config.writingMode}; font-size: 14px; }`);
      workspace.putText("publication.json", publicationManifest(context, chapters));
      const page = await browser.newPage();
      await page.goto(server.bookViewerUrl(`${context.workspaceBase}publication.json`, { viewId: "9", renderAllPages: false }));
      await page.waitForFunction(() => !!(window as ViewerWindow).coreViewer && (window as ViewerWindow).coreViewer!.readyState !== "loading", undefined, { timeout: 30000 });
      await page.evaluate(({ type, url }) => {
        const win = window as ViewerWindow;
        win.syncMessages = [];
        window.addEventListener("message", event => win.syncMessages!.push(event.data as { action?: string; key?: string; cfi?: string }));
        window.postMessage({ type, action: "follow", viewId: "9", enabled: true, url }, "*");
      }, { type: SOURCE_SYNC_MESSAGE, url: target.url });
      const selector = `[data-vivlio-sync="${target.key}"]`;
      await page.waitForFunction(selector => {
        const el = document.querySelector(selector);
        return !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
      }, selector, { timeout: 30000 });
      await page.locator(selector).first().click();
      await page.waitForFunction(key => (window as ViewerWindow).syncMessages!.some(message => message.action === "select" && message.key === key), target.key, { timeout: 10000 });
      const exported = await convertChapter({ ...context, mode: "epub" }, chapters[0], first, firstText);
      assert.ok(!exported.includes("data-vivlio-source"), "export contains no editor mapping metadata");
      process.stdout.write(`ok ${theme}: source lines, embeds, list/code blocks, lazy page navigation, click mapping, export isolation\n`);
    }
  } finally {
    await browser.close();
    await server.stop();
  }
}
void main().catch((error: unknown) => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
