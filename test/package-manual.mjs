/** Package the verified outputs from test/manual.check.ts with their sources.
 * Run from the repository root: node test/package-manual.mjs */
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import JSZip from "jszip";

const { version } = JSON.parse(await readFile("manifest.json", "utf8"));
const zip = new JSZip();
async function addSources(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await addSources(path);
    else zip.file(path.slice("sample/".length), await readFile(path));
  }
}
await addSources("sample/manual");
const readme = await readFile("sample/manual-README.md");
zip.file("README.md", readme);
zip.file("manual-README.md", readme);
zip.file("LICENSE", await readFile("LICENSE"));
for (const extension of ["pdf", "epub"]) {
  zip.file(`manual.${extension}`, await readFile(`output/manual/manual.${extension}`));
}
const output = `sample/vivlio-sample-manual-${version}.zip`;
await writeFile(output, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
const reopened = await JSZip.loadAsync(await readFile(output));
for (const file of ["README.md", "LICENSE", "manual/vivlio.yaml", "manual/04-checklist.md", "manual.pdf", "manual.epub"]) {
  assert.ok(reopened.file(file), `Missing ${file}`);
}
process.stdout.write(`${output}: ${Object.values(reopened.files).filter(file => !file.dir).length} files\n`);
