/** Real pagination regression: node test/run.mjs test/footnotes.check.ts.
 * VIVLIO_PLAYWRIGHT selects an installed package; VIVLIO_BROWSER defaults
 * to chrome. Checks the rendered numbers, not just the source HTML/CSS.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { TFile, TFolder, Component, type App } from "obsidian";
import { buildBook } from "../src/build/pipeline";
import { DEFAULT_SETTINGS } from "../src/config/defaults";
import { PreviewServer } from "../src/server/static";

interface Page {
  emulateMedia(options: { media: string }): Promise<void>;
  goto(url: string): Promise<void>;
  waitForFunction(callback: () => boolean, arg: undefined, options: { timeout: number }): Promise<void>;
  evaluate<T>(callback: () => T): Promise<T>;
}
const requirePackage = createRequire(`${process.cwd()}/package.json`);
const { chromium } = requirePackage(process.env.VIVLIO_PLAYWRIGHT || "playwright") as {
  chromium: { launch(options: { channel: string; headless: boolean }): Promise<{
    newPage(): Promise<Page>; close(): Promise<void>;
  }> };
};

async function main() {
  const server = new PreviewServer();
  await server.start({ vaultRoot: process.cwd() });
  const browser = await chromium.launch({ channel: process.env.VIVLIO_BROWSER || "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.emulateMedia({ media: "print" });
    const folder = Object.assign(new TFolder(), { path: "", name: "fixture" });
    const manuscripts = [
      "# First chapter\n\nShort note[^short]. Long note[^long]. Repeat[^short]. Inline^[Inline note body].\n\n" +
      "[^short]: Short note body.\n\n[^long]: First note paragraph.\n\n    Second note paragraph.\n\n    - Note list item.\n\n    Final note paragraph.",
      "# Second chapter\n\nNext chapter[^next].\n\n[^next]: Next chapter note body.",
    ];
    const sources = new Map<TFile, string>();
    manuscripts.forEach((text, index) => {
      const name = `0${index + 1}.md`;
      const file = Object.assign(new TFile(), { path: name, name, basename: name.slice(0, -3), extension: "md", parent: folder });
      folder.children.push(file);
      sources.set(file, text);
    });
    const app = {
      vault: { getFileByPath: () => null, cachedRead: async (file: TFile) => sources.get(file) || "" },
      metadataCache: { getFirstLinkpathDest: () => null, getFileCache: () => ({}) },
    } as unknown as App;
    for (const footnote of ["dpub", "gcpm", "pandoc"] as const) {
      const build = await buildBook({
        app, settings: DEFAULT_SETTINGS, server, component: new Component(),
        target: { kind: "folder", folder }, mode: "preview",
        overrides: {
          title: "Footnote numbers", theme: "english-novel", writingMode: "horizontal-tb",
          size: "A5", startSide: "any", footnote,
          sections: { titlePage: "off", toc: "off", colophon: "off" },
        },
      });
      await page.goto(server.bookViewerUrl(build.publicationUrl));
      await page.waitForFunction(() => (window as unknown as { coreViewer?: { readyState: string } }).coreViewer?.readyState === "complete", undefined, { timeout: 30000 });
      const rendered = await page.evaluate(() => {
        const pages = Array.from(document.querySelectorAll("[data-vivliostyle-page-container]"));
        return {
          text: pages.map(p => p.textContent || "").join("\n"),
          notes: pages.flatMap(p => Array.from(p.querySelectorAll("[role='doc-footnote']")).map(note => ({
            text: note.textContent || "",
            backlink: note.querySelector("[role='doc-backlink']")?.textContent || null,
            backlinkDisplay: note.querySelector("[role='doc-backlink']") ? getComputedStyle(note.querySelector("[role='doc-backlink']")!).display : null,
          }))),
        };
      });
      for (const text of ["Short note body.", "First note paragraph.", "Second note paragraph.", "Note list item.", "Final note paragraph.", "Inline note body", "Next chapter note body."]) {
        assert.equal(rendered.text.split(text).length - 1, 1, `${footnote}: ${text} appears once\n${JSON.stringify(rendered)}`);
      }
      if (footnote === "dpub") {
        assert.equal(rendered.notes.length, 4, "dpub: repeated reference does not duplicate a note");
        assert.deepEqual(rendered.notes.map(n => n.backlink), ["1", "2", "3", "1"], "dpub: VFM numbers restart per chapter");
        assert.ok(rendered.notes.every(n => n.backlinkDisplay !== "none"), "dpub: number backlinks remain visible in print");
        assert.deepEqual(rendered.notes.map(n => n.text.trim().match(/^\d+/)?.[0]), ["1", "2", "3", "1"], "dpub: rendered notes use their source number without a generated zero");
      } else if (footnote === "gcpm") {
        assert.deepEqual(rendered.notes.map(n => n.text.trim().match(/^\d+/)?.[0]), ["1", "2", "3", "1"], "gcpm: generated note markers are preserved");
      } else {
        assert.equal(rendered.notes.length, 0, "pandoc: endnotes are not converted to page-bottom notes");
      }
      process.stdout.write(`ok english-novel ${footnote}: printed note numbers and complete bodies\n`);
    }
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch(error => { process.stderr.write(String(error) + "\n"); process.exitCode = 1; });
