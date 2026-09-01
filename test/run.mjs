/**
 * Bundle and run a test file outside Obsidian.
 *
 * The plugin imports `obsidian`, which only exists inside the app, so the
 * module is redirected to the stub next to this script.
 */
import esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import fs from "fs";
import os from "os";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dirname, "..");
const entry = process.argv[2];

if (!entry) {
  console.error("usage: node test/run.mjs <test file>");
  process.exit(1);
}

const outfile = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "vivlio-test-")),
  "bundle.cjs",
);

const obsidianStub = {
  name: "obsidian-stub",
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({
      path: path.join(dirname, "obsidian-stub.ts"),
    }));
  },
};

const refractorPlugin = {
  name: "refractor-lite",
  setup(build) {
    build.onResolve({ filter: /^refractor$/ }, () => ({
      path: path.join(root, "src", "vendor", "refractor-lite.ts"),
    }));
  },
};

const assetsStub = {
  name: "vivlio-assets-stub",
  setup(build) {
    build.onResolve({ filter: /^virtual:vivlio-assets$/ }, (args) => ({
      path: args.path,
      namespace: "vivlio-assets",
    }));
    build.onLoad({ filter: /.*/, namespace: "vivlio-assets" }, () => ({
      contents:
        "export const viewerAssets = {};\n" +
        "export const themeAssets = { '@vivliostyle/theme-bunko/theme.css': { text: '' } };\n",
      loader: "js",
    }));
  },
};

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  // CJS, because VFM reaches `vfile@4`, which requires `path` at runtime -
  // the same reason the plugin bundle keeps the node builtins external.
  format: "cjs",
  platform: "node",
  target: "node22",
  outfile,
  plugins: [obsidianStub, refractorPlugin, assetsStub],
  logLevel: "warning",
});

createRequire(import.meta.url)(outfile);
