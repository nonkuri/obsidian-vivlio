/**
 * Keep the reader's place across a rebuild (SPEC 5.12).
 *
 * A rebuild replaces the iframe's `src`, which reloads the viewer, which
 * starts at page one. Editing a note in the middle of a book therefore sent
 * the preview back to the cover on every keystroke that settled.
 *
 * The plugin serves the viewer itself, so it can put a small script beside it.
 * The script speaks only to `window.coreViewer`, the `CoreViewer` the viewer
 * exposes: `nav` reports the source CFI as the reader turns pages. The
 * viewer's public `f` parameter restores that CFI; `navigateToPage` handles
 * the legacy fallback. This does not reach into the viewer's own markup,
 * whose element ids are its private business.
 *
 * The source position travels through the parent rather than through storage
 * inside the frame: only the preview knows whether it is rebuilding the same
 * book or showing a different one, and only it should decide when a
 * remembered position still means anything. The viewer accepts the CFI again
 * through its public `f` URL parameter. Unlike an epage, a CFI does not change
 * its meaning while lazy pagination discovers more pages.
 */

/** Name of the fragment parameter carrying the page to restore. */
export const EPAGE_PARAM = "vivlioEpage";

/** Name of the viewer's public fragment parameter carrying an EPUB CFI. */
export const CFI_PARAM = "f";

/** What the frame posts to the preview, and what the preview listens for. */
export const POSITION_MESSAGE = "vivlio:position";

/**
 * The script served with the viewer.
 *
 * A CFI identifies the publication source position. The fallback `epage` is
 * zero-based over the whole publication, rather than a printed page number
 * that may restart at the body or use roman numerals.
 */
export const KEEP_PAGE_SCRIPT = `
(function () {
  var MESSAGE = ${JSON.stringify(POSITION_MESSAGE)};
  var EPAGE = ${JSON.stringify(EPAGE_PARAM)};
  var CFI = ${JSON.stringify(CFI_PARAM)};
  // How long the book may go without growing before the page it has
  // reached is taken as the whole of it.
  var SETTLE_MS = 2500;

  function parameter(name) {
    // The digit class is spelt out rather than abbreviated: this lives in a
    // template literal, where a backslash belongs to the literal before the
    // regexp ever sees it.
    var match = new RegExp("[#&]" + name + "=([^&]+)").exec(location.hash);
    return match ? match[1] : "";
  }

  function wantedPage() {
    var value = parameter(EPAGE);
    return /^[0-9]+$/.test(value) ? parseInt(value, 10) : 0;
  }

  function start(viewer) {
    // The f parameter is consumed by the viewer itself while it loads the publication.
    // The epage machinery below is retained only as a fallback for a nav
    // payload that did not contain a CFI.
    var hasCfi = parameter(CFI) !== "";
    var target = hasCfi ? 0 : wantedPage();
    var pending = target > 0;
    var known = 0;
    var settle = null;

    function go(page) {
      pending = false;
      if (settle) { clearTimeout(settle); settle = null; }
      if (page > 0) viewer.navigateToPage("epage", page);
    }

    viewer.addListener("nav", function (payload) {
      if (!payload) return;

      if (pending) {
        var count = payload.epageCount;
        if (typeof count === "number" && count > 0) {
          // Wait for the book to reach the page before going to it. Going on
          // the first word from the viewer lands on page one, because at that
          // point one page is all there is.
          if (target <= count - 1) { go(target); return; }

          // With no CFI this can only approximate the old location. Let the
          // estimate settle before deciding that its last known page is the
          // closest available fallback.
          if (count > known) {
            known = count;
            if (settle) clearTimeout(settle);
            settle = setTimeout(function () { go(known - 1); }, SETTLE_MS);
          }
        }
        return;
      }

      // A nav notification with a CFI is the coherent pair for the page that
      // is actually on screen. Pagination-progress notifications may carry
      // only an approximate epage, so never let one overwrite it.
      if (typeof payload.cfi === "string" && payload.cfi) {
        try {
          parent.postMessage({
            type: MESSAGE,
            cfi: payload.cfi,
            epage: payload.epage
          }, "*");
        } catch (e) {
          /* The preview is not listening; nothing here depends on it. */
        }
      } else if (typeof payload.epage === "number" && !hasCfi) {
        try {
          parent.postMessage({ type: MESSAGE, epage: payload.epage }, "*");
        } catch (e) {
          /* The preview is not listening; nothing here depends on it. */
        }
      }
    });
  }

  // The viewer creates its CoreViewer while this script is being parsed, so
  // wait for it rather than assume it.
  var tries = 0;
  (function poll() {
    if (window.coreViewer && typeof window.coreViewer.addListener === "function") {
      start(window.coreViewer);
    } else if (tries++ < 200) {
      setTimeout(poll, 50);
    }
  })();
})();
`.trim();

/** Put the script into the viewer's page, just before it closes. */
export function withKeepPageScript(html: string): string {
  const script = `<script>${KEEP_PAGE_SCRIPT}</script>`;
  const close = html.lastIndexOf("</body>");
  if (close === -1) return `${html}\n${script}`;
  return `${html.slice(0, close)}${script}\n${html.slice(close)}`;
}
