/**
 * Keep the reader's place across a rebuild (SPEC 5.12).
 *
 * A rebuild replaces the iframe's `src`, which reloads the viewer, which
 * starts at page one. Editing a note in the middle of a book therefore sent
 * the preview back to the cover on every keystroke that settled.
 *
 * The plugin serves the viewer itself, so it can put a small script beside it.
 * The script speaks only to `window.coreViewer`, the `CoreViewer` the viewer
 * exposes: `nav` reports the page as the reader turns it, and
 * `navigateToPage` puts them back. Both are the published API of
 * `@vivliostyle/core`, so this does not reach into the viewer's own markup,
 * whose element ids are its private business.
 *
 * The page travels through the parent rather than through storage inside the
 * frame: only the preview knows whether it is rebuilding the same book or
 * showing a different one, and only it should decide when a remembered page
 * still means anything.
 */

/** Name of the fragment parameter carrying the page to restore. */
export const EPAGE_PARAM = "vivlioEpage";

/** What the frame posts to the preview, and what the preview listens for. */
export const PAGE_MESSAGE = "vivlio:page";

/**
 * The script served with the viewer.
 *
 * `epage` is zero-based and counts the whole publication, which is what makes
 * it the right thing to remember: a page number restarts at the body, and the
 * front matter's roman numerals would not survive the round trip.
 */
export const KEEP_PAGE_SCRIPT = `
(function () {
  var MESSAGE = ${JSON.stringify(PAGE_MESSAGE)};
  var PARAM = ${JSON.stringify(EPAGE_PARAM)};
  // How long the book may go without growing before the page it has
  // reached is taken as the whole of it.
  var SETTLE_MS = 2500;

  function wanted() {
    // [0-9] rather than \d: this lives in a template literal, where a
    // backslash escape belongs to the literal before the regexp sees it.
    var match = new RegExp("[#&]" + PARAM + "=([0-9]+)").exec(location.hash);
    return match ? parseInt(match[1], 10) : 0;
  }

  function start(viewer) {
    var target = wanted();
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

          // The book is still growing. Only when it stops, and has genuinely
          // ended short of the page, is the last page the answer. This runs
          // with the whole book composed (see bookViewerUrl), so a count that
          // has stopped growing is the count.
          if (count > known) {
            known = count;
            if (settle) clearTimeout(settle);
            settle = setTimeout(function () { go(known - 1); }, SETTLE_MS);
          }
        }
        return;
      }

      if (typeof payload.epage === "number") {
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
