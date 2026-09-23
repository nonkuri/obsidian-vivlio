/** Package verified samples after running verse.check.ts. Never attach to a plugin release. */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const output = process.env.VIVLIO_VERSE_OUTPUT || "output/pdf/verse";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const zip = new JSZip();
async function addDirectory(source, dest) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const full = path.join(source, entry.name);
    const target = `${dest}/${entry.name}`;
    if (entry.isDirectory()) await addDirectory(full, target);
    else zip.file(target, await readFile(full));
  }
}
zip.file("README.md", (await readFile("sample/verse-README.md", "utf8")).replaceAll("../docs/", "docs/"));
zip.file("docs/haiku-tanka-theme-direction.md", (await readFile("docs/haiku-tanka-theme-direction.md", "utf8")).replaceAll("../sample/verse-README.md", "../README.md"));
for (const kind of ["haiku", "tanka"]) {
  await addDirectory(`sample/${kind}`, kind);
  for (const count of [1, 2, 3]) zip.file(`examples/${kind}-${count}.pdf`, await readFile(`${output}/${kind}-${count}.pdf`));
  zip.file(`examples/${kind}.epub`, await readFile(`${output}/${kind}.epub`));
}
await mkdir(output, { recursive: true });
const archive = `${output}/vivlio-sample-verse-${version}.zip`;
await writeFile(archive, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
console.log(archive);
