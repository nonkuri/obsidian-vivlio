import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const prod = process.argv[2] === "production";

const banner = `/*
Vivlio for Obsidian - typeset notes with Vivliostyle.
Copyright (C) 2026 nonkuri

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version. See LICENSE and NOTICE in the source repository.

THIS IS A GENERATED FILE.
*/
`;

const TEXT_EXT = new Set([".html", ".js", ".css", ".svg", ".json", ".txt"]);

/** Recursively collect files under `root`, keyed by their posix-relative path. */
function collect(root, filter = () => true) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (!filter(rel)) continue;
      const ext = path.extname(rel).toLowerCase();
      out[rel] = TEXT_EXT.has(ext)
        ? { text: fs.readFileSync(abs, "utf8") }
        : { base64: fs.readFileSync(abs).toString("base64") };
    }
  };
  walk(root);
  return out;
}

/**
 * Embed the prebuilt Vivliostyle viewer and the CC0 themes in the bundle as a
 * virtual module, so the plugin ships as a single main.js while the local
 * server still has real files to serve.
 */
const assetsPlugin = {
  name: "vivlio-assets",
  setup(build) {
    build.onResolve({ filter: /^virtual:vivlio-assets$/ }, (args) => ({
      path: args.path,
      namespace: "vivlio-assets",
    }));
    build.onLoad({ filter: /.*/, namespace: "vivlio-assets" }, () => {
      const scope = path.join(dirname, "node_modules", "@vivliostyle");

      const viewer = collect(
        path.join(scope, "viewer", "lib"),
        (rel) => !rel.endsWith(".map"),
      );

      const themes = {};
      for (const name of ["theme-base", "theme-bunko", "theme-techbook", "theme-academic"]) {
        const files = collect(path.join(scope, name), (rel) => rel.endsWith(".css"));
        for (const [rel, value] of Object.entries(files)) {
          themes[`@vivliostyle/${name}/${rel}`] = value;
        }
      }

      return {
        contents:
          `export const viewerAssets = ${JSON.stringify(viewer)};\n` +
          `export const themeAssets = ${JSON.stringify(themes)};\n`,
        loader: "js",
      };
    });
  },
};

/**
 * Swap the bare `refractor` import (which registers ~270 Prism grammars, and
 * several megabytes with them) for a curated set. Sub-path imports such as
 * `refractor/core.js` must keep resolving normally, so this matches the bare
 * specifier only - the `alias` option would rewrite the sub-paths too.
 */
const refractorPlugin = {
  name: "refractor-lite",
  setup(build) {
    build.onResolve({ filter: /^refractor$/ }, () => ({
      path: path.join(dirname, "src", "vendor", "refractor-lite.ts"),
    }));
  },
};

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  target: "es2022",
  platform: "browser",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
  outfile: "main.js",
  plugins: [assetsPlugin, refractorPlugin],
  define: { "process.env.NODE_ENV": prod ? '"production"' : '"development"' },
  external: [
    "obsidian",
    "electron",
    "@electron/remote",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
    ...builtins.map((name) => `node:${name}`),
  ],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
