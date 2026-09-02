import fs from "fs";
import path from "path";

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
 *
 * Shared with the test harness: a test that stubs these out cannot tell
 * whether the viewer actually loads.
 */
export function vivlioAssetsPlugin(root) {
  return {
    name: "vivlio-assets",
    setup(build) {
      build.onResolve({ filter: /^virtual:vivlio-assets$/ }, (args) => ({
        path: args.path,
        namespace: "vivlio-assets",
      }));
      build.onLoad({ filter: /.*/, namespace: "vivlio-assets" }, () => {
        const scope = path.join(root, "node_modules", "@vivliostyle");

        const viewer = collect(
          path.join(scope, "viewer", "lib"),
          (rel) => !rel.endsWith(".map"),
        );

        const themes = {};

        // The plugin's own themes sit next to the bundled ones, so a relative
        // `@import` reaches theme-base the same way.
        const own = collect(path.join(root, "src", "themes"), (rel) => rel.endsWith(".css"));
        for (const [rel, value] of Object.entries(own)) themes[`vivlio/${rel}`] = value;

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
}

/**
 * Swap the bare `refractor` import (which registers ~270 Prism grammars, and
 * several megabytes with them) for a curated set. Sub-path imports such as
 * `refractor/core.js` must keep resolving normally, so this matches the bare
 * specifier only - the `alias` option would rewrite the sub-paths too.
 */
export function refractorPlugin(root) {
  return {
    name: "refractor-lite",
    setup(build) {
      build.onResolve({ filter: /^refractor$/ }, () => ({
        path: path.join(root, "src", "vendor", "refractor-lite.ts"),
      }));
    },
  };
}
