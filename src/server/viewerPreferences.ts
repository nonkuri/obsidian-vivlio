export const VIEWER_SETTINGS_MESSAGE = "vivlio:viewer-settings";

/**
 * The bundled Viewer writes spread/zoom through history.replaceState (which
 * does not fire hashchange). Observe those public URL values, not private UI
 * observables. Missing spread means auto; missing zoom means fit to screen.
 * Only preview URLs opt in. PDF viewers do not install this bridge.
 */
export const VIEWER_SETTINGS_SCRIPT = `
(function () {
  var params = new URLSearchParams(location.hash.slice(1));
  var viewId = params.get("vivlioViewId");
  if (!viewId) return;
  function read() {
    var params = new URLSearchParams(location.hash.slice(1));
    var spread = params.get("spread") || "auto";
    var zoom = params.get("zoom");
    return {
      viewerSpread: spread,
      viewerFitToScreen: !zoom,
      viewerZoom: zoom ? Number(zoom) : 1
    };
  }
  var previous = JSON.stringify(read());
  function report() {
    var preferences = read();
    var current = JSON.stringify(preferences);
    if (current === previous) return;
    previous = current;
    parent.postMessage({ type: ${JSON.stringify(VIEWER_SETTINGS_MESSAGE)}, viewId: viewId, preferences: preferences }, "*");
  }
  var replaceState = history.replaceState;
  history.replaceState = function () {
    var result = replaceState.apply(this, arguments);
    report();
    return result;
  };
  window.addEventListener("hashchange", report);
})();
`.trim();
