/**
 * Keep the three places a version is written from drifting apart.
 *
 * `npm version` has already put the new number in package.json by the time
 * this runs; the manifest is copied from there, and versions.json gains a row
 * saying which Obsidian this build needs. Run it through npm, not by hand:
 *
 *   npm version patch|minor|major
 */
import { readFileSync, writeFileSync } from "node:fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = version;
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

// The map is read newest-last by Obsidian, so append rather than re-sort: a
// released row's minAppVersion is history and must not move.
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[version] = manifest.minAppVersion;
writeFileSync("versions.json", `${JSON.stringify(versions, null, 2)}\n`);
