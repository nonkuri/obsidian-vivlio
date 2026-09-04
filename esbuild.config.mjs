import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import path from "path";
import { fileURLToPath } from "url";
import { refractorPlugin, vivlioAssetsPlugin } from "./esbuild/assets.mjs";
import { shimsPlugin } from "./esbuild/shims.mjs";

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
  plugins: [vivlioAssetsPlugin(dirname), refractorPlugin(dirname), shimsPlugin(dirname)],
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
