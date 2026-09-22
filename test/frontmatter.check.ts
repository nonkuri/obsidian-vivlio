/** Real pagination regression: same browser setup as pagination.check.ts.
 * Run: node test/run.mjs test/frontmatter.check.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { TFile, TFolder, Component, type App } from "obsidian";
import { buildBook } from "../src/build/pipeline";
import { DEFAULT_SETTINGS } from "../src/config/defaults";
import { PreviewServer } from "../src/server/static";
import { PDFDocument } from "pdf-lib";

const requirePackage = createRequire(`${process.cwd()}/package.json`);
const { chromium } = requirePackage(process.env.VIVLIO_PLAYWRIGHT || "playwright");

async function main() {
  const server = new PreviewServer();
  await server.start({ vaultRoot: process.cwd() });
  const browser = await chromium.launch({ channel: process.env.VIVLIO_BROWSER || "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.emulateMedia({ media: "print" });
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    const folder = Object.assign(new TFolder(), { path: "", name: "fixture" });
    const note = Object.assign(new TFile(), { path: "01.md", name: "01.md", basename: "01", extension: "md", parent: folder });
    folder.children.push(note);
    const cover = Object.assign(new TFile(), { path: "test/images/cover.png", name: "cover.png", extension: "png", stat: { mtime: 0, size: 1 } });
    const app = {
      vault: {
        getFileByPath: (path: string) => path === cover.path ? cover : null,
        cachedRead: async () => "# First chapter\n\nBody text.",
        readBinary: async (file: TFile) => new Uint8Array(await readFile(file.path)).buffer,
      },
      metadataCache: {
        getFirstLinkpathDest: (path: string) => path === cover.path ? cover : null,
        getFileCache: () => ({}),
      },
    } as unknown as App;

    for (const theme of ["novel", "novel-2col", "manual", "english-novel"]) {
      for (const withCover of [true, false]) {
        const writingMode = theme.startsWith("novel") ? "vertical-rl" : "horizontal-tb";
        const build = await buildBook({
          app, settings: DEFAULT_SETTINGS, server, component: new Component(),
          target: { kind: "folder", folder }, mode: "preview",
          overrides: {
            title: "Title fixture", theme, writingMode, startSide: "any",
            cover: withCover ? cover.path : "",
            sections: { ...DEFAULT_SETTINGS.sectionDefaults, titlePage: "auto", toc: "auto", colophon: "none" },
          },
        });
        await page.goto(server.bookViewerUrl(build.publicationUrl));
        await page.waitForFunction(() => (window as unknown as { coreViewer?: { readyState: string } }).coreViewer?.readyState === "complete", undefined, { timeout: 30000 });
        const pages = await page.evaluate(() => Array.from(document.querySelectorAll("[data-vivliostyle-page-container]")).map((p) => ({
          title: !!p.querySelector(".titlepage"),
          toc: !!p.querySelector("#toc"),
          cover: !!p.querySelector(".cover img"),
          text: p.textContent?.trim(),
          side: p.getAttribute("data-vivliostyle-page-side"),
          number: (p as HTMLElement & { vivlioPageNumber: number }).vivlioPageNumber,
          coverVerso: (p as HTMLElement & { vivlioIsCoverVerso?: boolean }).vivlioIsCoverVerso === true,
        })));
        const titleIndex = withCover ? 2 : 0;
        if (withCover) {
          assert.ok(pages[0].cover, `${theme}: image cover on page 1`);
          assert.equal(pages[1].text, "", `${theme}: cover verso is blank`);
          assert.ok(pages[1].coverVerso, `${theme}: cover verso is excluded from folios`);
        }
        assert.ok(pages[titleIndex].title, `${theme}: title on recto`);
        assert.equal(pages[titleIndex].number, 1, `${theme}: title starts the folio count`);
        assert.equal(pages[titleIndex + 1].text, "", `${theme}: title verso is blank`);
        assert.ok(pages[titleIndex + 2].toc, `${theme}: contents on the next recto`);
        assert.equal(pages[titleIndex + 2].number, 3, `${theme}: title verso counts`);
        assert.equal(pages[titleIndex].side, writingMode === "vertical-rl" ? "left" : "right");
        const pdf = await PDFDocument.load(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
        assert.equal(pdf.getPageCount(), pages.length, "PDF retains the blank pages");
        process.stdout.write(`ok ${theme}, cover=${withCover}: title=${titleIndex + 1}, toc=${titleIndex + 3}\n`);
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((error) => { process.stderr.write(String(error) + "\n"); process.exitCode = 1; });
