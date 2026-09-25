export const SOURCE_SYNC_MESSAGE = "vivlio:source-sync";

/** Preview-only bridge. A click returns an opaque key, never a vault path. */
export const SOURCE_SYNC_SCRIPT = `
(function () {
  var params = new URLSearchParams(location.hash.slice(1));
  var viewId = params.get("vivlioViewId");
  if (!viewId) return;
  var MESSAGE = ${JSON.stringify(SOURCE_SYNC_MESSAGE)};
  var enabled = false;
  var viewer = null;
  var pending = null;
  var ready = false;
  function send(action, key) {
    parent.postMessage({ type: MESSAGE, viewId: viewId, action: action, key: key }, "*");
  }
  function flush() {
    if (!viewer || viewer.readyState === "loading") return;
    if (!ready) { ready = true; send("ready"); }
    if (enabled && pending) {
      var url = pending;
      pending = null;
      viewer.navigateToInternalUrl(url);
    }
  }
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.source !== parent || !data || data.type !== MESSAGE || data.viewId !== viewId) return;
    if (data.action !== "follow" || typeof data.enabled !== "boolean") return;
    enabled = data.enabled;
    pending = null;
    if (enabled && typeof data.url === "string") {
      try {
        var url = new URL(data.url);
        var publication = new URL(params.get("src"), location.href);
        if (url.origin === publication.origin && url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1) ===
            publication.pathname.slice(0, publication.pathname.lastIndexOf("/") + 1)) pending = url.href;
      } catch (e) { /* Ignore malformed destinations. */ }
    }
    flush();
  });
  document.addEventListener("click", function (event) {
    if (!enabled || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (window.getSelection && String(window.getSelection()).length) return;
    var target = event.target;
    if (!target || typeof target.closest !== "function") return;
    // Links and viewer controls retain their ordinary actions.
    if (target.closest("a,button,input,select,textarea")) return;
    var block = target.closest("[data-vivlio-sync]");
    if (block) send("select", block.getAttribute("data-vivlio-sync"));
  });
  var tries = 0;
  (function poll() {
    if (window.coreViewer) {
      viewer = window.coreViewer;
      viewer.addListener("readystatechange", flush);
      flush();
    } else if (tries++ < 200) setTimeout(poll, 50);
  })();
})();
`.trim();
