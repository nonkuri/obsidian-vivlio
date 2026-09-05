/** Browser regression check: VIVLIO_PLAYWRIGHT can name an installed Playwright
 * package, VIVLIO_BROWSER defaults to chrome. No browser download is needed.
 * Run: node test/run.mjs test/pagination.check.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { TFile, TFolder, Component, type App } from "obsidian";
import { buildBook } from "../src/build/pipeline";
import { DEFAULT_SETTINGS } from "../src/config/defaults";
import { PreviewServer } from "../src/server/static";
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFNumber } from "pdf-lib";
import { postprocessPdf, type PageClass } from "../src/export/pdfPostprocess";

const requirePackage = createRequire(`${process.cwd()}/package.json`);
interface BrowserPage {
  emulateMedia(options: { media: string }): Promise<void>;
  on(event: string, callback: (error: Error) => void): void;
  goto(url: string): Promise<void>;
  waitForFunction(callback: () => boolean, arg?: unknown, options?: { timeout: number }): Promise<void>;
  evaluate<T>(callback: () => T): Promise<T>;
  pdf(options: { preferCSSPageSize: boolean; printBackground: boolean }): Promise<Uint8Array>;
}
interface Browser { newPage(): Promise<BrowserPage>; close(): Promise<void>; }
interface LayoutPage {
  number: number;
  counter: string | null;
  coverVerso: boolean;
  spine: number;
  side: string | null;
  text: string;
  preResetBlank: boolean;
}
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

    for (const startPage of [5, 0, -2]) {
      for (const side of ["any", "left"] as const) {
        for (const long of [false, true]) {
          for (const mode of ["continuous", "roman-then-arabic"] as const) {
        const folder = Object.assign(new TFolder(), { path: "", name: "fixture" });
        const text = new Map<TFile, string>();
        const note = (name: string, content: string) => {
          const file = Object.assign(new TFile(), { path: name, name, basename: name.replace(/\.md$/, ""), parent: folder });
          folder.children.push(file);
          text.set(file, content);
          return file;
        };
        note("cover.md", "# Cover");
        note("preface.md", "# Preface\n\nShort preface.");
        note("01.md", "# First\n\nFirst page." + (long ? '\n\n<div style="break-before:page">Second page.</div>' : ""));
        note("02.md", "# Second\n\nNext chapter.");
        const yaml = Object.assign(new TFile(), {
          path: "vivlio.yaml", name: "vivlio.yaml", basename: "vivlio", parent: folder,
        });
        text.set(yaml, `pageNumbering: ${mode}\nstartPage: ${startPage}\n`);
        const app = {
          vault: {
            getFileByPath: (path: string) => path === "vivlio.yaml" ? yaml : null,
            cachedRead: async (file: TFile) => text.get(file) || "",
          },
          metadataCache: {
            getFirstLinkpathDest: (name: string) => folder.children.find((file) => file.path === name) || null,
            getFileCache: () => ({}),
          },
        } as unknown as App;
        const build = await buildBook({
          app, settings: DEFAULT_SETTINGS, server, component: new Component(),
          target: { kind: "folder", folder }, mode: "preview",
          overrides: {
            title: "Pagination", theme: "novel", coverPage: "cover.md", startSide: side,
            sections: { ...DEFAULT_SETTINGS.sectionDefaults, titlePage: "auto", toc: "auto", preface: "preface.md", colophon: "off" },
          },
        });
        await page.goto(server.bookViewerUrl(build.publicationUrl));
        await page.waitForFunction(() => (window as unknown as { coreViewer?: { readyState: string } }).coreViewer?.readyState === "complete", undefined, { timeout: 30000 });
        const pages: LayoutPage[] = await page.evaluate(() => {
          const containers = Array.from(document.querySelectorAll("[data-vivliostyle-page-container]"));
          const numbers = containers.map((p) =>
            (p as HTMLElement & { vivlioPageNumber: number }).vivlioPageNumber,
          );
          return containers.map((p, index) => {
            const text = (p.textContent || "").replace(/\s+/g, " ").trim();
            const next = containers[index + 1];
            const preResetBlank = Boolean(
              next && !text && numbers[index] === numbers[index + 1] &&
              p.getAttribute("data-vivliostyle-spine-index") === next.getAttribute("data-vivliostyle-spine-index"),
            );
            const number = preResetBlank && index > 0 ? numbers[index - 1] + 1 : numbers[index];
            if (preResetBlank) numbers[index] = number;
            return {
              number,
              counter: Array.from(p.querySelectorAll("[data-vivliostyle-page-counter]"))
                .at(-1)?.textContent?.trim() ?? null,
              coverVerso: index > 0 &&
                (p as HTMLElement & { vivlioIsCoverVerso?: boolean }).vivlioIsCoverVerso === true,
              spine: Number(p.getAttribute("data-vivliostyle-spine-index")),
              side: p.getAttribute("data-vivliostyle-page-side"),
              text,
              preResetBlank,
            };
          });
        });
        assert.equal(pages[0].number, 0, "cover is excluded");
        const bodyIndex = build.chapters.findIndex((chapter) => chapter.isBody);
        const body = pages.filter((p) => p.spine >= bodyIndex);
        // With a forced side, an opening blank precedes the first body page.
        const first = body.findIndex((p) => p.text.includes("First"));
        if (mode === "roman-then-arabic") {
          assert.deepEqual(body.slice(first).map((p) => p.number), body.slice(first).map((_, i) => i + startPage));
        } else {
          const numbered = pages.filter((_, index) => index > 0 && !pages[index].coverVerso);
          assert.deepEqual(numbered.map((p) => p.number), numbered.map((_, i) => i + startPage));
          const firstRenderedFolio = pages.slice(1).find((p) => p.counter !== null);
          if (firstRenderedFolio && firstRenderedFolio.number > 0) {
            assert.equal(Number(firstRenderedFolio.counter), firstRenderedFolio.number, "the rendered folio honors YAML startPage");
          }
        }
        const nonpositiveCountersAreHidden = await page.evaluate(() => Array.from(
          document.querySelectorAll("[data-vivliostyle-page-counter]"),
        ).filter((node) => Number(node.textContent?.trim()) <= 0).every((node) =>
          getComputedStyle(node).visibility === "hidden",
        ));
        assert.ok(nonpositiveCountersAreHidden, "zero and negative folios are hidden");
        const classes = pages.map((p): PageClass => {
          if (p.coverVerso) return "cover-verso";
          const chapter = build.chapters[p.preResetBlank ? p.spine - 1 : p.spine];
          return chapter.role === "doc-cover" ? "cover" : chapter.isFrontMatter ? "front" : "body";
        });
        if (mode === "roman-then-arabic" && side === "left") {
          const resetBlank = pages.find((p) => p.preResetBlank);
          assert.ok(resetBlank);
          const resetBlankIndex = pages.indexOf(resetBlank);
          assert.equal(resetBlank.number, pages[resetBlankIndex - 1].number + 1);
          assert.equal(classes[resetBlankIndex], "front");
        }
        const pdf = await postprocessPdf(await page.pdf({ preferCSSPageSize: true, printBackground: true }), {
          config: build.context.config, toc: [], anchorPages: {}, pageClasses: classes,
          pageNumbers: pages.map((p) => p.number), pageLabels: true, metadata: false, outline: false,
        });
        const parsed = await PDFDocument.load(pdf);
        assert.equal(parsed.getPageCount(), pages.length);
        const labels = parsed.catalog.lookup(PDFName.of("PageLabels"), PDFDict).lookup(PDFName.of("Nums"), PDFArray);
        for (let i = 0; i < pages.length; i++) {
          let entry = 0;
          while (entry + 2 < labels.size() && labels.lookup(entry + 2, PDFNumber).asNumber() <= i) entry += 2;
          const start = labels.lookup(entry, PDFNumber).asNumber();
          const dict = labels.lookup(entry + 1, PDFDict);
          if (classes[i] === "cover" || classes[i] === "cover-verso" || pages[i].number <= 0) {
            assert.equal(dict.has(PDFName.of("S")), false);
            continue;
          }
          assert.equal(dict.lookup(PDFName.of("St"), PDFNumber).asNumber() + i - start, pages[i].number);
          assert.equal(dict.lookup(PDFName.of("S"), PDFName).asString(), mode === "roman-then-arabic" && classes[i] === "front" ? "/r" : "/D");
        }
        process.stdout.write(`ok start ${startPage}, ${mode}, ${side}, ${long ? "two" : "one"}-page chapter: ${pages.map((p) => p.number).join(",")} (PDF labels match)\n`);
          }
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
