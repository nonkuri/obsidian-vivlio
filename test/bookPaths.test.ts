import assert from "node:assert/strict";
import { TFile, type App } from "obsidian";
import { resolveBookFile } from "../src/build/bookPaths";
import { buildCover } from "../src/build/cover";
import { planSections } from "../src/build/sections";
import { baseBookConfig, DEFAULT_SETTINGS } from "../src/config/defaults";
import type { BuildContext } from "../src/build/context";
import { Workspace } from "../src/build/workspace";

const files = new Map<string, TFile>();
for (const path of ["essay/images/cover.png", "images/cover.png", "other/images/cover.png", "essay/pages/title.md", "pages/title.md"]) {
  files.set(path, Object.assign(new TFile(), { path, name: path.split("/").at(-1), extension: path.split(".").at(-1) }));
}
let fallbackCalls = 0;
const wrongCover = files.get("other/images/cover.png")!;
const app = {
  vault: { getFileByPath: (path: string) => files.get(path) ?? null },
  metadataCache: { getFirstLinkpathDest: () => { fallbackCalls++; return wrongCover; } },
} as unknown as App;
const ownCover = files.get("essay/images/cover.png")!;
assert.equal(resolveBookFile(app, "essay", "images/cover.png"), ownCover);
assert.equal(resolveBookFile(app, "essay", "images\\cover.png"), ownCover);
assert.equal(resolveBookFile(app, "essay", "./images/cover.png"), ownCover);
assert.equal(resolveBookFile(app, "essay", "essay/images/cover.png"), ownCover);
assert.equal(resolveBookFile(app, "essay", "/images/cover.png"), files.get("images/cover.png"));
assert.equal(resolveBookFile(app, "essay", "../images/cover.png"), files.get("images/cover.png"));
assert.equal(resolveBookFile(app, "", "images/cover.png"), files.get("images/cover.png"));
assert.equal(resolveBookFile(app, "essay", "./missing/cover.png"), null);
assert.equal(resolveBookFile(app, "essay", "missing/cover.png"), null);
assert.equal(resolveBookFile(app, "essay", "../../images/cover.png"), null);
assert.equal(resolveBookFile(app, "essay", "pages/title", true), files.get("essay/pages/title.md"));
assert.equal(fallbackCalls, 0, "directory-qualified paths never use fuzzy matching");
assert.equal(resolveBookFile(app, "essay", "cover.png"), wrongCover, "legacy short names may still use Obsidian matching");

const config = baseBookConfig();
config.cover = "images/cover.png";
config.backCover = "images/cover.png";
const context = {
  app, config, settings: DEFAULT_SETTINGS, bookRoot: "essay", mode: "preview",
  workspace: new Workspace("book-paths"), warnings: [], imageSizes: new Map(),
  vaultBase: "http://localhost/vault/", workspaceBase: "http://localhost/workspace/",
} as unknown as BuildContext;
assert.equal(buildCover(context)?.asset.vaultPath, ownCover.path);
assert.equal(buildCover(context, true)?.asset.vaultPath, ownCover.path);
config.sections.preface = "pages/title";
assert.equal(planSections(context).find(section => section.slot === "preface")?.file, files.get("essay/pages/title.md"));
files.delete(ownCover.path);
assert.equal(resolveBookFile(app, "essay", "images/cover.png"), files.get("images/cover.png"), "exact vault-root paths remain supported");
assert.equal(resolveBookFile(app, "essay", "./images/cover.png"), null, "explicit relative path never falls back to root");
process.stdout.write("book resource paths: collision, explicit relative/root, missing, legacy, covers and sections passed\n");
