import path from "path";

/**
 * Replace two polyfills JSZip drags in, both of which are answers to
 * questions Chromium stopped asking.
 *
 * `lie` is a Promise implementation, reached from `jszip/lib/external.js`,
 * which picks the native `Promise` when there is one and falls back to `lie`
 * when there is not. There always is one here - the plugin is desktop-only and
 * runs in Electron - but the fallback is a `require` inside an `if`, which
 * esbuild must bundle because it cannot know the branch is dead.
 *
 * `setimmediate` installs a global `setImmediate`, which `jszip/lib/utils.js`
 * calls, so that one is genuinely needed and is reimplemented below rather
 * than dropped. What is not needed is the ladder of fallbacks it ships with:
 * its oldest rung schedules work by creating a `<script>` element and waiting
 * for `onreadystatechange`, a trick for Internet Explorer 8 that is dead code
 * in every browser Obsidian has ever run in. `lie`'s scheduler, `immediate`,
 * carries the same rung.
 *
 * Dead or not, a security scanner reading main.js sees script elements being
 * built at runtime and has no way to know the branch is unreachable. Neither
 * does a person reading the bundle. Taking them out costs nothing and makes
 * the bundle answerable.
 *
 * Reaching them at all takes one more step. JSZip's `browser` field redirects
 * its own entry point to `dist/jszip.min.js`, a copy with both polyfills
 * already baked in, so a substitution made at the package level would never
 * fire. The entry is therefore resolved back to `lib/index.js` and the
 * package is bundled from its source, which is where the two `require` calls
 * are still visible.
 *
 * That source asks one more question the dist copy had already answered:
 * `support.js` reads `require("readable-stream").Readable` at load time to
 * decide whether Node streams are available, and JSZip's browser build of
 * that module forwards to Node's own `stream`. The plugin packs an EPUB with
 * `generateAsync({ type: "uint8array" })` and never asks for a stream, so the
 * honest answer here is that there are none - which is what the third shim
 * says, and it keeps a `require("stream")` out of the bundle.
 */

/** `lie`, as the native Promise that `external.js` would have preferred. */
const LIE = `
"use strict";
module.exports = Promise;
`;

/**
 * `setimmediate`, on the MessageChannel the real package reaches for first in
 * any browser of this century. Side-effect only, like the original: it
 * installs the global and exports nothing.
 */
const SETIMMEDIATE = `
"use strict";
if (typeof globalThis.setImmediate !== "function") {
  const tasks = new Map();
  let nextId = 1;
  const channel = new MessageChannel();
  channel.port1.onmessage = (event) => {
    const task = tasks.get(event.data);
    if (!task) return;
    tasks.delete(event.data);
    task.fn(...task.args);
  };
  globalThis.setImmediate = (fn, ...args) => {
    const id = nextId++;
    tasks.set(id, { fn, args });
    channel.port2.postMessage(id);
    return id;
  };
  globalThis.clearImmediate = (id) => {
    tasks.delete(id);
  };
}
`;

/**
 * `readable-stream`, answering the only question JSZip asks of it. Leaving
 * `Readable` undefined sets `support.nodestream` false, which is the truth
 * about this bundle: nothing in it asks JSZip for a stream.
 */
const READABLE_STREAM = `
"use strict";
module.exports = { Readable: undefined };
`;

const SHIMS = new Map([
  ["lie", LIE],
  ["setimmediate", SETIMMEDIATE],
  ["readable-stream", READABLE_STREAM],
]);

export function shimsPlugin(root) {
  return {
    name: "vivlio-shims",
    setup(build) {
      build.onResolve({ filter: /^jszip$/ }, () => ({
        path: path.join(root, "node_modules", "jszip", "lib", "index.js"),
      }));
      build.onResolve({ filter: /^(lie|setimmediate|readable-stream)$/ }, (args) => ({
        path: args.path,
        namespace: "vivlio-shim",
      }));
      build.onLoad({ filter: /.*/, namespace: "vivlio-shim" }, (args) => ({
        contents: SHIMS.get(args.path),
        loader: "js",
      }));
    },
  };
}
