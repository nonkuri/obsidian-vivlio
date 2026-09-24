/** Integration proof for the distributable sample. Obsidian is stubbed;
 * conversion, asset handling, CSS and the bundled Viewer are real.
 * VIVLIO_PLAYWRIGHT selects an installed Playwright package.
 * node test/run.mjs test/vertical-magazine.check.ts
 * Writes review output under output/vertical-magazine (not the sample).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { TFile, TFolder, Component, type App } from 'obsidian';
import { buildBook } from '../src/build/pipeline';
import { DEFAULT_SETTINGS } from '../src/config/defaults';
import { PreviewServer } from '../src/server/static';

const root = path.resolve('sample/css');
const base = 'vertical-magazine';
const folder = Object.assign(new TFolder(), { path: `${base}/book`, name: 'book', children: [] });
const files = new Map<string, TFile>();
function collect(dir: string) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) { collect(p); continue; }
    const f = Object.assign(new TFile(), { path: p, name: entry.name, basename: path.basename(p, path.extname(p)), extension: path.extname(p).slice(1), parent: folder });
    files.set(p, f);
    if (p.startsWith(`${base}/book/`) && p.endsWith('.md')) folder.children.push(f);
  }
}
collect(base);
const read = (f: TFile) => fs.readFileSync(path.join(root, f.path), 'utf8');
const app = {
  vault: {
    getFileByPath: (p: string) => files.get(p) || null,
    cachedRead: async (f: TFile) => read(f),
    readBinary: async (f: TFile) => { const b = fs.readFileSync(path.join(root, f.path)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
  },
  metadataCache: {
    getFirstLinkpathDest: (p: string, source: string) => files.get(path.posix.join(path.posix.dirname(source), p)) || files.get(p) || null,
    getFileCache: (f: TFile) => ({ headings: [...read(f).matchAll(/^(#+) (.+)$/gm)].map(m => ({ level: m[1].length, heading: m[2] })) }),
  },
} as unknown as App;
const req = createRequire(path.resolve('package.json'));
const { chromium } = req(process.env.VIVLIO_PLAYWRIGHT || 'playwright');
async function main() {
  const out = 'output/vertical-magazine';
  fs.mkdirSync(out, { recursive: true });
  const server = new PreviewServer();
  await server.start({ vaultRoot: root });
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
    await page.emulateMedia({ media: 'print' });
    for (const cropMarks of [true, false]) {
      const build = await buildBook({ app, settings: DEFAULT_SETTINGS, server, component: new Component(), target: { kind: 'folder', folder }, mode: 'pdf', overrides: { cropMarks } });
      assert.deepEqual(build.warnings, [], 'no configuration or asset warnings');
      assert.equal(build.chapters.filter(c => c.isBody).length, 2);
      await page.goto(server.bookViewerUrl(build.publicationUrl, { renderAllPages: true }));
      await page.waitForFunction(() => (window as any).coreViewer?.readyState === 'complete', null, { timeout: 60000 });
      // Measure before print-only presentation changes. All pages share geometry.
      const result = await page.evaluate(() => Array.from(document.querySelectorAll('[data-vivliostyle-page-container]')).map(p => {
        const sheet = p.getBoundingClientRect();
        const rect = (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.x - sheet.x, y: r.y - sheet.y, w: r.width, h: r.height }; };
        return {
          text: p.textContent || '', size: [sheet.width, sheet.height],
          paragraphs: Array.from(p.querySelectorAll('p')).map(e => e.textContent).join(''),
          title: p.querySelector('h1')?.textContent,
          titleRect: p.querySelector('h1') ? rect(p.querySelector('h1')!) : null,
          bleedBox: p.querySelector('[data-vivliostyle-bleed-box]') ? rect(p.querySelector('[data-vivliostyle-bleed-box]')!) : null,
          images: Array.from(p.querySelectorAll('img')).map(e => ({ ...rect(e), loaded: e.complete && e.naturalWidth > 0, src: e.getAttribute('src') })),
          overflow: Array.from(p.querySelectorAll('h1,h2,p,figcaption,.callout-title')).filter(e => {
            if (getComputedStyle(e).display === 'none') return false;
            const range = document.createRange(); range.selectNodeContents(e); const r = range.getBoundingClientRect();
            return r.width > 0 && (r.left < sheet.left - 1 || r.right > sheet.right + 1 || r.top < sheet.top - 1 || r.bottom > sheet.bottom + 1);
          }).map(e => e.textContent),
        };
      }));
      fs.writeFileSync(`${out}/layout-${cropMarks ? 'marks' : 'no-marks'}.json`, JSON.stringify(result, null, 2));
      assert.equal(result.length, 4, 'cover, two-page feature and one-page second article');
      assert.equal(result.flatMap((p: any) => p.images).length, 4);
      assert.ok(result.flatMap((p: any) => p.images).every((i: any) => i.loaded));
      assert.deepEqual(result.flatMap((p: any) => p.overflow), []);
      let actual = result.map((p: any) => p.paragraphs).join('').replace(/\s/g, '');
      // Page floats occur after body nodes in the rendered DOM. Remove the
      // separately verified byline/lead before joining split body paragraphs.
      const openers = (folder.children as TFile[]).flatMap(f => read(f).split(/\n\s*\n/).filter(p => p.trim() && !/^[!#>]/.test(p)).slice(0, 2));
      for (const opener of openers) {
        const text = opener.replace(/\s/g, '');
        assert.ok(actual.includes(text), 'complete opening text');
        actual = actual.replace(text, '');
      }
      for (const f of folder.children as TFile[]) {
        for (const para of read(f).split(/\n\s*\n/).filter(p => p.trim() && !/^[!#>]/.test(p))) {
          if (openers.includes(para)) continue;
          assert.ok(actual.includes(para.replace(/\s/g, '')), `complete paragraph: ${para.slice(0, 30)}`);
        }
      }
      const mm = 96 / 25.4;
      for (const p of result) {
        if (p.titleRect) assert.ok(p.titleRect.h > p.titleRect.w, 'vertical title');
        for (const img of p.images) {
        if (img.src?.includes('detail')) {
          assert.ok(Math.abs(img.w / mm - 42) < .2, 'inset illustration retains its 42 mm width');
          continue;
        }
        assert.ok(Math.abs(img.w / mm - 216) < .2, 'artwork covers the 216 mm bleed width');
        const inset = cropMarks ? 13 * mm : 0; // Core's marked sheet: 16 mm trim inset minus 3 mm bleed.
        assert.ok(Math.abs(img.x - inset) < 1 && Math.abs(img.y - inset) < 1, 'art reaches left and top bleed edges');
        assert.ok(Math.abs(p.size[0] - img.x - img.w - inset) < 1, 'art reaches right bleed edge');
        if (img.src?.includes('cover')) {
          assert.ok(Math.abs(img.h / mm - 303) < .2, 'cover height includes top and bottom bleed');
          assert.ok(Math.abs(p.size[1] - img.y - img.h - inset) < 1, 'cover reaches bottom bleed edge');
        }
        }
      }
      const allText = result.map((p: any) => p.text).join('').replace(/\s/g, '');
      for (const f of folder.children as TFile[]) {
        for (const line of read(f).split('\n').filter(l => l.startsWith('> ') && !l.startsWith('> [!'))) {
          assert.ok(allText.includes(line.slice(2).replace(/\s/g, '')), 'complete callout text');
        }
      }
      if (cropMarks) {
        await page.pdf({ path: `${out}/vertical-magazine.pdf`, printBackground: true, preferCSSPageSize: true });
      }
      console.log(`PASS ${cropMarks ? 'marks' : 'no marks'}: ${result.length} pages; complete text, images and bleed width`);
    }
  } finally { await browser?.close(); await server.stop(); }
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
