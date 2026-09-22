/** Real sample through the builder, Vivliostyle and EPUB packager.
 * node test/run.mjs test/manual.check.ts
 * VIVLIO_PLAYWRIGHT / VIVLIO_JSDOM select installed packages.
 * VIVLIO_MANUAL_OUTPUT optionally saves page PNGs and an A5 PDF. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, readdir, mkdir, stat, writeFile } from "node:fs/promises";
import { load as loadYaml } from "js-yaml";
import { TFile, TFolder, Component, type App } from "obsidian";
import { buildBook } from "../src/build/pipeline";
import { DEFAULT_SETTINGS } from "../src/config/defaults";
import { PreviewServer } from "../src/server/static";
import { buildEpub } from "../src/export/epub";
import { materializeAssets } from "../src/build/materialize";
import JSZip from "jszip";
import { numberManualFigures } from "../src/build/manual";
import { Workspace } from "../src/build/workspace";
import type { BuildContext, Chapter } from "../src/build/context";

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

function checkNumbering() {
  for (const lang of ["ja", "en"]) for (const order of [["a", "b"], ["b", "a"]]) {
    const workspace = new Workspace();
    const chapters = order.map(name => ({ docName: `${name}.html`, isBody: true } as Chapter));
    for (const name of order) workspace.putText(`${name}.html`, `<html><body>
      <figure id="same"><img src="x.svg"><figcaption>${name}</figcaption></figure>
      <figure class="tbl" id="table"><figcaption>Settings</figcaption><table><caption>Nested caption</caption><tr><td>1</td></tr></table></figure>
      <a href="#same" data-ref="fig"></a><a href="${name === "a" ? "b" : "a"}.html#same" data-ref="fig"></a>
      <a href="#same">Custom label</a></body></html>`);
    const context = { config: { theme: "manual", lang }, workspace } as BuildContext;
    numberManualFigures(context, chapters);
    const label = lang === "ja" ? "図" : "Figure ";
    const doc = new DOMParser().parseFromString(workspace.getFile(`${order[0]}.html`)!.text!, "text/html");
    assert.deepEqual(Array.from(doc.querySelectorAll(".vivlio-manual-ref"), el => el.textContent), [`${label}1`, `${label}2`]);
    assert.equal(doc.querySelectorAll(".vivlio-manual-number").length, 2, "nested table is numbered only once");
    assert.equal(doc.querySelector('a:not([data-ref])')?.textContent, "Custom label");
    assert.equal(chapters.length, 2, "manual preserves spine documents");
  }
}

async function main() {
  checkNumbering();
  const root = "sample/manual";
  const folder = Object.assign(new TFolder(), { path: root, name: "manual" });
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
  const resolve = (path: string) => files.get(path) ?? files.get(`${root}/${path}`) ?? files.get(`${root}/${path}.md`) ?? null;
  const images = [...files.values()].filter(f => f.extension === "svg");
  const resolvedLinks = Object.fromEntries([...contents].map(([path, text]) => [path, Object.fromEntries(images.filter(f => text.includes(f.path.slice(root.length + 1))).map(f => [f.path, 1]))]));
  const app = {
    vault: { getFileByPath: resolve, cachedRead: async (file: TFile) => contents.get(file.path)!, readBinary: async (file: TFile) => new Uint8Array(await readFile(file.path)).buffer },
    metadataCache: { resolvedLinks, getFirstLinkpathDest: resolve, getFileCache: (file: TFile) => ({ headings: [...(contents.get(file.path) ?? "").matchAll(/^(#{1,6}) (.+)$/gm)].map(m => ({ level: m[1].length, heading: m[2].trim() })) }) },
  } as unknown as App;
  assert.ok(!(loadYaml(contents.get(`${root}/vivlio.yaml`)!) as { css?: string }).css);
  const server = new PreviewServer();
  await server.start({ vaultRoot: process.cwd() });
  const browser = await chromium.launch({ channel: process.env.VIVLIO_BROWSER || "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1500 } });
    await page.emulateMedia({ media: "print" });
    const target = { kind: "config" as const, file: files.get(`${root}/vivlio.yaml`)!, folder };
    for (const size of ["A5", "A4"]) {
      const build = await buildBook({ app, settings: DEFAULT_SETTINGS, server, component: new Component(), target, mode: "pdf", overrides: { size } });
      assert.equal(build.warnings.length, 0, JSON.stringify(build.warnings));
      assert.deepEqual(build.chapters.filter(c => c.isBody).map(c => c.file?.basename), ["01-start", "02-layout", "03-delivery", "04-checklist"]);
      await page.goto(server.bookViewerUrl(build.publicationUrl));
      await page.waitForFunction(() => (window as unknown as { coreViewer?: { readyState: string } }).coreViewer?.readyState === "complete", undefined, { timeout: 60000 });
      const pages = await page.evaluate(() => Array.from(document.querySelectorAll("[data-vivliostyle-page-container]")).map(p => {
        const sheet = p.getBoundingClientRect();
        return {
          text: p.textContent ?? "",
          rows: Array.from(p.querySelectorAll("tbody tr")).map(tr => tr.textContent?.trim() ?? "").filter(t => /^C\d{2}/.test(t)),
          headers: p.querySelectorAll("thead").length,
          tableCaptions: Array.from(p.querySelectorAll(".vivlio-manual-table-caption")).map(el => el.textContent),
          images: Array.from(p.querySelectorAll("figure img")).map(img => ({ loaded: (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0, caption: img.closest("figure")?.querySelector("figcaption")?.textContent ?? "" })),
          references: Array.from(p.querySelectorAll(".vivlio-manual-ref")).map(a => a.textContent),
          callouts: Array.from(p.querySelectorAll(".callout")).map(el => el.textContent),
          overflow: Array.from(p.querySelectorAll("h1,h2,h3,p,pre,table,img,td")).filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.left < sheet.left - 1 || r.right > sheet.right + 1 || r.bottom > sheet.bottom + 1);
          }).map(el => el.textContent?.slice(0,80) ?? el.tagName),
        };
      }));
      const output = process.env.VIVLIO_MANUAL_OUTPUT;
      if (output) {
        await mkdir(`${output}/${size}`, { recursive: true });
        await writeFile(`${output}/${size}/layout.json`, JSON.stringify(pages, null, 2));
        for (let i = 0; i < pages.length; i++) await page.locator("[data-vivliostyle-page-container]").nth(i).screenshot({ path: `${output}/${size}/page-${String(i+1).padStart(2,"0")}.png` });
        if (size === "A5") await page.pdf({ path: `${output}/manual.pdf`, printBackground: true, preferCSSPageSize: true });
      }
      assert.deepEqual(pages.flatMap((p: { overflow: string[] }) => p.overflow), [], `${size}: no page overflow`);
      const rows = pages.flatMap((p: { rows: string[] }) => p.rows);
      assert.equal(rows.length, 36);
      assert.equal(new Set(rows.map((r: string) => r.slice(0,3))).size, 36);
      assert.ok(pages.filter((p: { rows: string[] }) => p.rows.length).length >= 2);
      assert.ok(pages.filter((p: { rows: string[] }) => p.rows.length).every((p: { headers: number }) => p.headers > 0));
      assert.ok(pages.filter(p => p.rows.length).every(p => p.tableCaptions.some(c => c?.startsWith("表2"))), "long table repeats its caption");
      const rendered = pages.flatMap((p: { images: { loaded: boolean; caption: string }[] }) => p.images);
      assert.equal(rendered.length, 2);
      assert.ok(rendered.every((img: { loaded: boolean; caption: string }) => img.loaded && /^図[12]/.test(img.caption)));
      assert.deepEqual(pages.flatMap((p: { references: string[] }) => p.references), ["図1", "図1", "表1", "図2", "表2"]);
      const text = pages.map((p: { text: string }) => p.text).join("");
      assert.ok(text.includes("END-OF-CODE") && text.includes("確認記録を保存します。") && text.includes("次回は保存した原稿"));
      if (size === "A5") assert.ok(pages.filter((p: { callouts: string[] }) => p.callouts.some(c => /原稿の所在|確認記録を保存/.test(c))).length >= 2, "long callout fragments");
      process.stdout.write(`ok manual ${size}: ${pages.length} pages, references, figures, long table and callout\n`);
    }
    const epub = await buildBook({ app, settings: DEFAULT_SETTINGS, server, component: new Component(), target, mode: "epub" });
    await materializeAssets(epub.context, { forEpub: true, keepBytes: true });
    const bytes = await buildEpub(epub.context, epub.chapters, null);
    const archive = await JSZip.loadAsync(bytes);
    assert.equal(Object.keys(archive.files).filter(path => path.endsWith(".svg")).length, 2);
    const docs = await Promise.all(Object.keys(archive.files).filter(path => path.endsWith(".xhtml")).map(path => archive.file(path)!.async("string")));
    assert.ok(docs.some(text => text.includes("C36")));
    assert.ok(docs.some(text => text.includes('vivlio-manual-ref') && text.includes("図1")));
    if (process.env.VIVLIO_MANUAL_OUTPUT) await writeFile(`${process.env.VIVLIO_MANUAL_OUTPUT}/manual.epub`, bytes);
    process.stdout.write("ok manual EPUB: embedded figures, reference labels and final table row\n");
  } finally { await browser.close(); await server.stop(); }
}
void main().catch(error => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
