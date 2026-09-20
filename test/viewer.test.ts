import assert from "node:assert/strict";
import vm from "node:vm";
import { DEFAULT_SETTINGS } from "../src/config/defaults";
import { normalizeViewerPreferences, rememberViewerPreferences, type ViewerPreferences } from "../src/config/viewer";
import { settingsToYaml } from "../src/config/yaml";
import { configFromSettings } from "../src/config/resolve";
import { PreviewServer } from "../src/server/static";
import { VIEWER_SETTINGS_MESSAGE, VIEWER_SETTINGS_SCRIPT } from "../src/server/viewerPreferences";

const defaults = normalizeViewerPreferences({});
assert.deepEqual(defaults, { viewerSpread: "false", viewerZoom: 1, viewerFitToScreen: true });
assert.deepEqual(normalizeViewerPreferences({ viewerZoom: NaN }), defaults);

const settings = { ...DEFAULT_SETTINGS };
const originalYaml = settingsToYaml(settings);
const originalBook = configFromSettings(settings);
const prefs = { viewerSpread: "true", viewerZoom: 1.5, viewerFitToScreen: false } as const;
assert.equal(rememberViewerPreferences(settings, { ...prefs, allowDynamicScripts: false }), true);
assert.equal(settings.allowDynamicScripts, DEFAULT_SETTINGS.allowDynamicScripts);
assert.equal(rememberViewerPreferences(settings, prefs), false);
assert.equal(settingsToYaml(settings), originalYaml);
assert.deepEqual(configFromSettings(settings), originalBook);
// The persisted JSON restores the same preferences on the next plugin load.
assert.deepEqual(normalizeViewerPreferences(JSON.parse(JSON.stringify(settings)) as ViewerPreferences), prefs);
assert.equal(rememberViewerPreferences(settings, { ...prefs, viewerFitToScreen: true, viewerZoom: 1 }), true);
assert.equal(settings.viewerZoom, 1.5);
for (const viewerZoom of [NaN, Infinity, 0, -1, 0.09, 10.01, "1.5"]) {
  assert.equal(rememberViewerPreferences(settings, { ...prefs, viewerZoom }), false);
}
assert.equal(rememberViewerPreferences(settings, { ...prefs, viewerSpread: "invalid" }), false);
assert.equal(rememberViewerPreferences(settings, null), false);
settings.rememberViewerSettings = false;
const before = { ...settings };
assert.equal(rememberViewerPreferences(settings, prefs), false);
assert.deepEqual(settings, before);

const server = new PreviewServer();
const url = server.bookViewerUrl("http://localhost/book.json", { renderAllPages: false, viewer: prefs, viewId: "7" });
assert.ok(url.includes("spread=true") && url.includes("zoom=1.5") && url.includes("vivlioViewId=7"));
assert.ok(!server.bookViewerUrl("book", { renderAllPages: false, viewer: defaults }).includes("zoom="));
const exportUrl = server.bookViewerUrl("book", { renderAllPages: true });
assert.ok(exportUrl.includes("spread=false") && exportUrl.includes("renderAllPages=true"));
assert.ok(!exportUrl.includes("zoom=") && !exportUrl.includes("vivlioViewId="));

// Execute the actual injected script, including replaceState (no hashchange)
// and the hashchange fallback. Page turns must not generate setting writes.
function bridge(hash: string) {
  const location = { hash };
  const messages: { type: string; viewId: string; preferences: typeof defaults }[] = [];
  const listeners = new Map<string, () => void>();
  const history = {
    replaceState(this: void, _data: unknown, _unused: string, url: string) {
      location.hash = url.slice(url.indexOf("#"));
      return 42;
    },
  };
  const original = history.replaceState;
  vm.runInNewContext(VIEWER_SETTINGS_SCRIPT, {
    URLSearchParams, location, history,
    parent: { postMessage: (message: (typeof messages)[number]) => messages.push(message) },
    window: { addEventListener: (name: string, callback: () => void) => listeners.set(name, callback) },
  });
  return { location, messages, listeners, history, original };
}
const frame = bridge("#src=book&spread=false&vivlioViewId=7");
assert.equal(frame.messages.length, 0);
assert.equal(frame.history.replaceState(null, "", "#src=book&spread=false&vivlioViewId=7&f=epubcfi()"), 42);
assert.equal(frame.messages.length, 0);
frame.history.replaceState(null, "", "#src=book&spread=true&zoom=1.5&vivlioViewId=7");
assert.deepEqual(JSON.parse(JSON.stringify(frame.messages[0])), {
  type: VIEWER_SETTINGS_MESSAGE, viewId: "7", preferences: prefs,
});
frame.history.replaceState(null, "", "#src=book&vivlioViewId=7");
assert.equal(frame.messages[1].preferences.viewerSpread, "auto");
assert.equal(frame.messages[1].preferences.viewerFitToScreen, true);
frame.location.hash = "#src=book&spread=false&zoom=2&vivlioViewId=7";
frame.listeners.get("hashchange")?.();
assert.equal(frame.messages[2].preferences.viewerZoom, 2);
frame.listeners.get("hashchange")?.();
assert.equal(frame.messages.length, 3);
const pdfFrame = bridge("#src=book&spread=false&renderAllPages=true");
assert.equal(pdfFrame.history.replaceState, pdfFrame.original);
assert.equal(pdfFrame.listeners.size, 0);
process.stdout.write("all viewer preference checks passed\n");
