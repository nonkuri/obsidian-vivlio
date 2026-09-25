/** Package reviewed artifacts after horizontal-magazine.check.ts and visual QA.
 * node test/package-horizontal-magazine.mjs
 * Keep the versioned ZIP name stable until a new sample version is published.
 */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const base = 'sample/css/horizontal-magazine';
const name = 'vivlio-sample-horizontal-magazine-0.17.4.zip';
const entries = [
  'README.md', 'SOURCES.md', 'LICENSE', 'horizontal-magazine.css',
  'horizontal-magazine.pdf', 'preview.png', 'book/vivlio.yaml',
  'book/01-river.md', 'book/02-workshop.md',
  'book/images/cover.svg', 'book/images/river.svg',
  'book/images/workshop.svg', 'book/images/plan.svg',
];
await fs.copyFile('LICENSE', `${base}/LICENSE`);
await fs.copyFile('output/horizontal-magazine/horizontal-magazine.pdf', `${base}/horizontal-magazine.pdf`);
const archive = new JSZip();
const date = new Date('2026-09-24T00:00:00Z');
for (const file of entries) {
  const bytes = await fs.readFile(`${base}/${file}`);
  assert.ok(bytes.length > 0, file);
  archive.file(`horizontal-magazine/${file}`, bytes, { date });
}
const zip = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
const reopened = await JSZip.loadAsync(zip, { checkCRC32: true });
for (const file of entries) {
  assert.deepEqual(await reopened.file(`horizontal-magazine/${file}`).async('nodebuffer'), await fs.readFile(`${base}/${file}`), file);
}
assert.equal(Object.values(reopened.files).filter(f => !f.dir).length, entries.length);
await fs.mkdir('sample/downloads', { recursive: true });
await fs.writeFile(`sample/downloads/${name}`, zip);
const hash = createHash('sha256').update(zip).digest('hex');
await fs.writeFile(`sample/downloads/${name}.sha256`, `${hash}  ${name}\n`);
console.log(`${entries.length} files; ${zip.length} bytes; SHA-256 ${hash}`);
