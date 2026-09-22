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
import { PDFDocument, PDFDict, PDFArray, PDFName, PDFNumber } from "pdf-lib";
import { postprocessPdf, type PageClass } from "../src/export/pdfPostprocess";
import { buildTocEntries } from "../src/build/toc";

const requirePackage = createRequire(`${process.cwd()}/package.json`);
interface BrowserPage {
  emulateMedia(options: { media: string }): Promise<void>;
  on(event: string, callback: (error: Error) => void): void;
  goto(url: string): Promise<void>;
  waitForFunction(callback: () => boolean, arg: undefined, options: { timeout: number }): Promise<void>;
  evaluate<T>(callback: () => T): Promise<T>;
  pdf(options: { preferCSSPageSize: boolean; printBackground: boolean }): Promise<Uint8Array>;
}
interface Browser { newPage(): Promise<BrowserPage>; close(): Promise<void>; }
const { chromium } = requirePackage(process.env.VIVLIO_PLAYWRIGHT || "playwright") as {
  chromium: { launch(options: { channel: string; headless: boolean }): Promise<Browser> };
};

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
    let longBody = false;
    const app = {
      vault: {
        getFileByPath: (path: string) => path === cover.path ? cover : null,
        cachedRead: async () => "# First chapter\n\nBody text." + (longBody ? '\n\n<div style="break-before:page">Second body page.</div>' : ""),
        readBinary: async (file: TFile) => new Uint8Array(await readFile(file.path)).buffer,
      },
      metadataCache: {
        getFirstLinkpathDest: (path: string) => path === cover.path ? cover : null,
        getFileCache: () => ({}),
      },
    } as unknown as App;

    for (const theme of ["novel", "novel-2col", "manual", "english-novel"]) {
      for (const withCover of [true, false]) {
      for (const ending of ["none", "short", "long", "colophon"] as const) {
        longBody = ending === "long";
        const withBackCover = ending !== "none";
        const startPage = ending === "none" ? 1 : longBody ? -2 : 8;
        const writingMode = theme.startsWith("novel") ? "vertical-rl" : "horizontal-tb";
        const build = await buildBook({
          app, settings: DEFAULT_SETTINGS, server, component: new Component(),
          target: { kind: "folder", folder }, mode: "preview",
          overrides: {
            title: "Title fixture", theme, writingMode, startSide: "any", startPage,
            cover: withCover ? cover.path : "",
            backCover: withBackCover ? String.raw`test\images\cover.png` : "",
            backCoverFit: longBody ? "contain" : "cover",
            bleed: ending === "colophon" ? "3mm" : "0mm",
            sections: { ...DEFAULT_SETTINGS.sectionDefaults, titlePage: "auto", toc: "auto", colophon: ending === "colophon" ? "auto" : "off" },
          },
        });
        await page.goto(server.bookViewerUrl(build.publicationUrl));
        await page.waitForFunction(() => (window as unknown as { coreViewer?: { readyState: string } }).coreViewer?.readyState === "complete", undefined, { timeout: 30000 });
        const pages = await page.evaluate(() => Array.from(document.querySelectorAll("[data-vivliostyle-page-container]")).map((p) => ({
          title: !!p.querySelector(".titlepage"),
          toc: !!p.querySelector("#toc"),
          cover: !!p.querySelector(".cover img"),
          backCover: !!p.querySelector(".back-cover img"),
          backFit: p.querySelector(".back-cover img") ? getComputedStyle(p.querySelector(".back-cover img")!).objectFit : null,
          imageCount: p.querySelectorAll("img").length,
          spine: Number(p.getAttribute("data-vivliostyle-spine-index")),
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
        assert.equal(pages[titleIndex].number, startPage, `${theme}: title starts the folio count`);
        assert.equal(pages[titleIndex + 1].text, "", `${theme}: title verso is blank`);
        assert.ok(pages[titleIndex + 2].toc, `${theme}: contents on the next recto`);
        assert.equal(pages[titleIndex + 2].number, startPage + 2, `${theme}: title verso counts`);
        assert.equal(pages[titleIndex].side, writingMode === "vertical-rl" ? "left" : "right");
        const pdf = await PDFDocument.load(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
        assert.equal(pdf.getPageCount(), pages.length, "PDF retains the blank pages");
        if (withBackCover) {
          assert.equal(pages.length % 2, 0, "back cover is an even physical page");
          assert.ok(pages.at(-1)?.backCover, "last page is the back cover image");
          assert.equal(pages.at(-1)?.side, writingMode === "vertical-rl" ? "right" : "left");
          assert.equal(pages.at(-1)?.backFit, longBody ? "contain" : "cover", "back cover has its own image fit");
          const backIndex = build.chapters.findIndex((c) => c.isBackCover);
          const backPages = pages.filter((p: { spine: number }) => p.spine === backIndex);
          assert.equal(backPages.length, longBody ? 3 : 2, "padding follows body/colophon parity");
          if (ending === "colophon") {
            assert.equal(build.chapters[backIndex - 1].slot, "colophon", "back cover follows the colophon");
          }
          for (const blank of backPages.slice(0, -1)) {
            assert.equal(blank.text, "", "inside and padding have no text or folio");
            assert.equal(blank.imageCount, 0, "inside and padding have no image");
          }
          const before = pages[pages.length - backPages.length - 1].number;
          assert.ok(backPages.every((p: { number: number }) => p.number === before), "back cover pages do not advance folios");
          assert.ok(!buildTocEntries(build.context, build.chapters).some((e) => e.href.startsWith("back-cover")));
          assert.ok(!buildTocEntries(build.context, build.chapters, "nav").some((e) => e.href.startsWith("back-cover")));
          const classes = pages.map((p: { spine: number; coverVerso: boolean }): PageClass =>
            p.spine === backIndex ? "back-cover" : p.coverVerso ? "cover-verso" : build.chapters[p.spine].role === "doc-cover" ? "cover" : "body",
          );
          const labeled = await PDFDocument.load(await postprocessPdf(await pdf.save(), {
            config: build.context.config, toc: [], anchorPages: {}, pageClasses: classes,
            pageNumbers: pages.map((p: { number: number }) => p.number), metadata: false, outline: false, pageLabels: true,
          }));
          const labels = labeled.catalog.lookup(PDFName.of("PageLabels"), PDFDict).lookup(PDFName.of("Nums"), PDFArray);
          for (let i = 0; i < labels.size(); i += 2) {
            if (labels.lookup(i, PDFNumber).asNumber() >= pages.length - backPages.length) {
              assert.equal(labels.lookup(i + 1, PDFDict).has(PDFName.of("S")), false, "back cover labels are hidden");
            }
          }
        }
        process.stdout.write(`ok ${theme}, cover=${withCover}, ending=${ending}: ${pages.length} pages\n`);
      }
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((error) => { process.stderr.write(String(error) + "\n"); process.exitCode = 1; });
