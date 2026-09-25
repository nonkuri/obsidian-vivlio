import assert from "node:assert/strict";
import { MarkdownView, TFile, type Editor, type WorkspaceLeaf } from "obsidian";
import { VivlioPreviewView } from "../src/view/PreviewView";
import type VivlioPlugin from "../src/main";
import type { SourceBlock } from "../src/build/sourceMap";

async function main() {
  const file = Object.assign(new TFile(), { path: "note.md" });
  const text = "# Note\n\nFirst paragraph.\n\nSecond paragraph.";
  let current = text;
  let cursor = { line: 4, ch: 5 };
  let scrollLine = -1;
  let focusCount = 0;
  let newTabCount = 0;
  let mode = "source";
  let existing = true;
  const editor = {
    getValue: () => current, getCursor: () => cursor,
    setCursor: (position: typeof cursor) => { cursor = position; },
    scrollIntoView: (range: { from: typeof cursor }) => { scrollLine = range.from.line; },
    focus: () => { focusCount++; },
  } as unknown as Editor;
  const markdown = Object.assign(new MarkdownView({} as WorkspaceLeaf), { file, editor, getMode: () => mode });
  const leaf = { view: markdown, openFile: async () => {},
    setViewState: async () => { mode = "source"; } };
  const sent: { url?: string; enabled: boolean }[] = [];
  const plugin = { settings: { debounceMs: 1 }, server: { origin: "http://localhost" } } as VivlioPlugin;
  const preview = new VivlioPreviewView({} as WorkspaceLeaf, plugin);
  // Exercise the view's integration with Obsidian's editor/leaf API, without a UI.
  const state = preview as unknown as {
    app: unknown; frame: unknown; sourceBlocks: SourceBlock[]; sourceTexts: Map<string, string>;
    sourceEditor: { file: TFile; editor: Editor }; lastFollow: string; syncEnabled: boolean;
    controller: AbortController | null; viewerGeneration: number;
    sendFollow(): void; selectSource(block: SourceBlock): Promise<void>;
  };
  state.app = { vault: { getFileByPath: () => file, cachedRead: async () => current }, workspace: {
    getLeavesOfType: () => existing ? [leaf] : [],
    getLeaf: (kind: string) => { assert.equal(kind, "tab"); newTabCount++; return leaf; },
    setActiveLeaf: (chosen: unknown) => assert.equal(chosen, leaf),
  } };
  state.frame = { contentWindow: { postMessage: (message: (typeof sent)[number]) => sent.push(message) } };
  state.sourceTexts = new Map([[file.path, text]]);
  state.sourceEditor = { file, editor };
  const block = { path: file.path, start: 4, end: 4, url: "http://localhost/ch.html#second", key: "second" };
  state.sourceBlocks = [block];
  state.sendFollow();
  assert.equal(sent.at(-1)?.url, block.url);
  state.sendFollow();
  assert.equal(sent.length, 1, "moving within one paragraph does not turn pages again");
  current = `New line\n${text}`;
  state.sendFollow();
  assert.equal(sent.at(-1)?.url, undefined, "dirty editor does not navigate using old source lines");
  await state.selectSource(block);
  assert.equal(focusCount, 0, "stale preview cannot move the editor");
  current = text;
  state.controller = new AbortController();
  await state.selectSource(block);
  assert.equal(focusCount, 0, "rebuild suspends reverse navigation");
  state.controller = null;
  mode = "preview";
  await state.selectSource(block);
  assert.deepEqual(cursor, { line: 4, ch: 0 });
  assert.equal(scrollLine, 4);
  assert.equal(mode, "source", "reading view switches to editing");
  assert.equal(newTabCount, 0, "reuse the existing source tab");
  const afterClick = sent.length;
  state.sendFollow();
  assert.equal(sent.length, afterClick, "reverse navigation does not bounce the preview back");
  existing = false;
  await state.selectSource(block);
  assert.equal(newTabCount, 1, "a missing editor opens in a new tab without splitting the workspace");
  state.syncEnabled = false;
  state.sendFollow();
  assert.equal(sent.at(-1)?.enabled, false);
  const focused = focusCount;
  await state.selectSource(block);
  assert.equal(focusCount, focused);
  process.stdout.write("all source synchronization view checks passed\n");
}
void main().catch((error: unknown) => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
