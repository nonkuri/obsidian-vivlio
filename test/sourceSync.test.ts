import assert from "node:assert/strict";
import vm from "node:vm";
import { blockAtLine, markSource, sourcePropertiesPlugin, type SourceBlock } from "../src/build/sourceMap";
import { SOURCE_SYNC_MESSAGE, SOURCE_SYNC_SCRIPT } from "../src/server/sourceSync";
import type { UNode } from "../src/util/tree";

const blocks: SourceBlock[] = [
  { path: "a.md", start: 4, end: 12, key: "quote", url: "quote" },
  { path: "a.md", start: 5, end: 6, key: "paragraph", url: "paragraph" },
  { path: "a.md", start: 9, end: 11, key: "next", url: "next" },
  { path: "b.md", start: 5, end: 6, key: "other", url: "other" },
];
assert.equal(blockAtLine(blocks, "a.md", 6)?.key, "paragraph");
assert.equal(blockAtLine(blocks, "a.md", 10)?.key, "next");
assert.equal(blockAtLine(blocks, "a.md", 14)?.key, "quote");
assert.equal(blockAtLine(blocks, "b.md", 5)?.key, "other");
assert.equal(blockAtLine(blocks, "a.md", 0), undefined);
assert.equal(blockAtLine(blocks, "missing.md", 8), undefined);
const node: UNode = { type: "paragraph", position: { start: { line: 2 }, end: { line: 4 } } };
markSource(node, "embedded.md", 4);
sourcePropertiesPlugin()(node);
assert.deepEqual(node.data, { hProperties: { dataVivlioSource: "embedded.md", dataVivlioStart: 5, dataVivlioEnd: 7 } });

// Execute the shipped bridge: generation/source checks, pending navigation,
// opt-out, links, selection, and export isolation.
const messages: { action: string; key?: string }[] = [];
const navigations: string[] = [];
const events = new Map<string, (event: unknown) => void>();
const readyEvents = new Map<string, () => void>();
const clicks = new Map<string, (event: unknown) => void>();
const parent = { postMessage: (data: { action: string }) => messages.push(data) };
const viewer = {
  readyState: "loading",
  addListener: (name: string, callback: () => void) => readyEvents.set(name, callback),
  navigateToInternalUrl: (url: string) => navigations.push(url),
};
let selected = "";
const sandbox = {
  URL, URLSearchParams, parent,
  location: { hash: "#src=http://localhost/w/book/publication.json&vivlioViewId=3", href: "http://localhost/viewer/" },
  window: { coreViewer: viewer, getSelection: () => selected,
    addEventListener: (name: string, callback: (event: unknown) => void) => events.set(name, callback) },
  document: { addEventListener: (name: string, callback: (event: unknown) => void) => clicks.set(name, callback) },
};
vm.runInNewContext(SOURCE_SYNC_SCRIPT, sandbox);
const follow = (overrides = {}, source: unknown = parent) => events.get("message")!({ source,
  data: { type: SOURCE_SYNC_MESSAGE, action: "follow", viewId: "3", enabled: true,
    url: "http://localhost/w/book/ch01.html#target", ...overrides } });
follow({}, {});
follow({ viewId: "old" });
assert.equal(navigations.length, 0);
follow();
assert.equal(navigations.length, 0);
viewer.readyState = "interactive";
readyEvents.get("readystatechange")!();
assert.equal(messages[0].action, "ready");
assert.deepEqual(navigations, ["http://localhost/w/book/ch01.html#target"]);
follow({ url: "http://other.test/w/book/ch01.html#target" });
follow({ url: "http://localhost/w/other/ch01.html#target" });
assert.equal(navigations.length, 1);
const click = (link = false) => clicks.get("click")!({ button: 0, target: {
  closest: (selector: string) => selector === "[data-vivlio-sync]"
    ? { getAttribute: () => "chapter:1" } : link ? {} : null,
} });
click();
assert.equal(messages.at(-1)?.key, "chapter:1");
const count = messages.length;
click(true);
selected = "selected text";
click();
selected = "";
follow({ enabled: false });
click();
assert.equal(messages.length, count);
const exportSandbox = { ...sandbox, location: { ...sandbox.location, hash: "#src=book" }, window: {}, document: {} };
vm.runInNewContext(SOURCE_SYNC_SCRIPT, exportSandbox);
process.stdout.write("all source synchronization checks passed\n");
