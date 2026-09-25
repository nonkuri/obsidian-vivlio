/** Run the layout check, render its PDF, and visually review all pages first.
 * node test/package-vertical-magazine.mjs
 * Uses an explicit allowlist; no generated workspace or unrelated assets ship.
 */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const base = 'sample/css/vertical-magazine';
const name = 'vivlio-sample-vertical-magazine-0.17.4.zip';
const entries = [
  'README.md', 'SOURCES.md', 'LICENSE', 'vertical-magazine.css',
  'vertical-magazine.pdf', 'preview.png', 'book/vivlio.yaml',
  'book/01-rain.md', 'book/02-repair.md',
  'book/images/cover.svg', 'book/images/rain.svg',
  'book/images/repair.svg', 'book/images/detail.svg',
];
await fs.copyFile('LICENSE', `${base}/LICENSE`);
await fs.copyFile('output/vertical-magazine/vertical-magazine.pdf', `${base}/vertical-magazine.pdf`);
const archive = new JSZip();
const date = new Date('2026-09-24T00:00:00Z');
for (const file of entries) {
  const bytes = await fs.readFile(`${base}/${file}`);
  assert.ok(bytes.length > 0, file);
  archive.file(`vertical-magazine/${file}`, bytes, { date });
}
const zip = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
const reopened = await JSZip.loadAsync(zip, { checkCRC32: true });
for (const file of entries) {
  assert.deepEqual(await reopened.file(`vertical-magazine/${file}`).async('nodebuffer'), await fs.readFile(`${base}/${file}`), file);
}
assert.equal(Object.values(reopened.files).filter(f => !f.dir).length, entries.length);
await fs.mkdir('sample/downloads', { recursive: true });
await fs.writeFile(`sample/downloads/${name}`, zip);
await fs.writeFile(`sample/downloads/${name}.sha256`, `${createHash('sha256').update(zip).digest('hex')}  ${name}\n`);
console.log(`PASS archive: ${entries.length} files; ${zip.length} bytes; CRC and round-trip content verified`);
