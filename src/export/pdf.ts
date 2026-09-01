import type { BuildContext } from "../build/context";
import { warn } from "../build/context";
import { remote, type RemoteWebContentsInstance } from "../util/electron";
import { AbortError, isAbortError, throwIfAborted, waitUntil } from "../util/async";
import { log } from "../util/log";

/** A table-of-contents entry as the viewer reports it. */
export interface ViewerTocItem {
  id?: string;
  title?: string;
  href?: string;
  children?: ViewerTocItem[];
}

export interface RenderResult {
  pdf: Uint8Array;
  toc: ViewerTocItem[];
  pageCount: number;
  /** Element id -> zero-based page index, read off the laid-out document. */
  anchorPages: Record<string, number>;
  /** What each page is, in order, for `/PageLabels`. */
  pageClasses: PageClass[];
}

export type PageClass = "cover" | "front" | "body";

interface WebviewTag extends HTMLElement {
  src: string;
  nodeintegration: boolean;
  disablewebsecurity: boolean;
  useragent: string;
  allowpopups: boolean;
  getWebContentsId(): number;
  loadURL(url: string): Promise<void>;
  executeJavaScript(code: string): Promise<unknown>;
  printToPDF(options: Record<string, unknown>): Promise<Uint8Array>;
  reload(): void;
}

/**
 * Render a built book to PDF.
 *
 * This is the same route vivliostyle-cli takes - wait for the viewer to finish
 * laying out, then print - except that Obsidian already ships the Chromium
 * doing the work, so no browser has to be downloaded (SPEC 2.5, 3.4).
 */
export async function renderPdf(
  context: BuildContext,
  publicationUrl: string,
  viewerUrl: string,
  options: { onProgress?: (message: string) => void } = {},
): Promise<RenderResult> {
  const signal = context.signal;
  const webview = document.createElement("webview") as WebviewTag;
  webview.addClass("vivlio-print-webview");
  webview.nodeintegration = false;
  // Belt and braces with the CSS: this reaches the guest even when
  // `electron.remote` is unavailable, and it is set before the first load,
  // which is the only time web preferences are read.
  webview.setAttribute("webpreferences", "backgroundThrottling=false");
  webview.src = "about:blank";

  // The listener goes on before the element is attached, because attaching is
  // what starts the load: registering afterwards can miss `dom-ready`.
  const firstReady = once(webview, "dom-ready", context.settings.printTimeoutMs, signal);
  const failures: string[] = [];
  webview.addEventListener("did-fail-load", (event) => {
    const detail = event as unknown as { errorCode?: number; errorDescription?: string };
    // -3 is ABORTED, which a normal in-page navigation also reports.
    if (detail.errorCode === -3) return;
    failures.push(`${detail.errorDescription ?? "load failed"} (${detail.errorCode})`);
  });
  document.body.appendChild(webview);

  const abortListener = () => {
    webview.remove();
  };
  signal?.addEventListener("abort", abortListener, { once: true });

  try {
    await firstReady;
    throwIfAborted(signal);
    log.debug("print webview ready");

    // Vivliostyle evaluates media queries while laying out, so the media type
    // has to be `print` before the document loads (SPEC 3.5).
    const debuggerHandle = await emulatePrintMedia(context, webview);

    options.onProgress?.("loading");
    const target = `${viewerUrl}#src=${encodeURIComponent(
      publicationUrl,
    )}&bookMode=true&renderAllPages=true&spread=false`;
    const ready = once(webview, "dom-ready", context.settings.printTimeoutMs, signal);
    await webview.loadURL(target);
    await ready;
    log.debug("viewer loaded");

    options.onProgress?.("typesetting");
    await waitForViewer(webview, context.settings.printTimeoutMs, signal, failures);

    options.onProgress?.("images");
    await waitForImages(webview);

    const toc = (await webview
      .executeJavaScript("JSON.parse(JSON.stringify(window.coreViewer.getTOC() || []))")
      .catch(() => [])) as ViewerTocItem[];
    const layout = await readLayout(webview);

    options.onProgress?.("printing");
    // `margins` takes inches, and the key is `margins` - the older
    // `margin: { marginType }` form is silently ignored, which leaves the
    // default one-centimetre margin around a page the theme already sized.
    const pdf = await webview.printToPDF({
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true,
      preferCSSPageSize: true,
      generateTaggedPDF: context.settings.taggedPdf,
      generateDocumentOutline: false,
    });
    log.debug(`printed ${pdf.byteLength} bytes`);

    detach(debuggerHandle);
    return {
      pdf,
      toc,
      pageCount: layout.pageClasses.length,
      anchorPages: layout.anchorPages,
      pageClasses: layout.pageClasses,
    };
  } finally {
    signal?.removeEventListener("abort", abortListener);
    webview.remove();
  }
}

interface LayoutInfo {
  anchorPages: Record<string, number>;
  pageClasses: PageClass[];
}

/**
 * Read where things ended up on paper.
 *
 * Vivliostyle renders each page into its own `[data-vivliostyle-page-container]`,
 * so walking those containers gives both the page an anchor landed on (for
 * bookmarks) and what kind of page it is (for page labels) - neither of which
 * can be known before the book is laid out.
 */
async function readLayout(webview: WebviewTag): Promise<LayoutInfo> {
  const result = await webview
    .executeJavaScript(
      `(() => {
         const pages = Array.from(
           document.querySelectorAll('[data-vivliostyle-page-container]')
         );
         const anchorPages = {};
         const pageClasses = pages.map((page) => {
           for (const element of page.querySelectorAll('[id]')) {
             if (anchorPages[element.id] === undefined) {
               anchorPages[element.id] = pages.indexOf(page);
             }
           }
           if (page.querySelector('.cover, [role="doc-cover"]')) return 'cover';
           if (page.querySelector('.vivlio-front')) return 'front';
           return 'body';
         });
         return { anchorPages, pageClasses };
       })()`,
    )
    .catch(() => null);

  const info = result as LayoutInfo | null;
  return {
    anchorPages: info?.anchorPages ?? {},
    pageClasses: info?.pageClasses ?? [],
  };
}

/**
 * Switch the webview to print media over the Chrome DevTools Protocol.
 *
 * Without this the theme's `@media screen` rules take part in the layout and
 * the PDF differs from the printed design. If the debugger cannot be attached
 * the export still runs, with a warning, rather than failing outright.
 */
async function emulatePrintMedia(
  context: BuildContext,
  webview: WebviewTag,
): Promise<RemoteWebContentsInstance | null> {
  const webContents = remote()?.webContents;
  if (!webContents) {
    warn(context, {
      kind: "unsupported",
      message: "could not switch to print media; screen styles may leak into the PDF",
    });
    return null;
  }
  try {
    const target = webContents.fromId(webview.getWebContentsId());
    if (!target) return null;

    // Vivliostyle lays out across `setTimeout` callbacks, and Chromium clamps
    // timers to about one a second in a page it considers hidden - which a
    // webview parked off-screen is. Left throttled, a book of any size never
    // finishes composing.
    target.setBackgroundThrottling?.(false);

    if (!target.debugger.isAttached()) target.debugger.attach("1.3");
    await target.debugger.sendCommand("Emulation.setEmulatedMedia", { media: "print" });
    return target;
  } catch (error) {
    log.error("could not emulate print media", error);
    warn(context, {
      kind: "unsupported",
      message: "could not switch to print media; screen styles may leak into the PDF",
    });
    return null;
  }
}

function detach(handle: RemoteWebContentsInstance | null): void {
  try {
    if (handle?.debugger.isAttached()) handle.debugger.detach();
  } catch (error) {
    log.debug("debugger detach failed", error);
  }
}

/**
 * Wait for `window.coreViewer.readyState === "complete"` (SPEC 2.5).
 *
 * Reports the last state it saw, so a timeout says whether the viewer never
 * loaded at all or simply had not finished composing.
 */
async function waitForViewer(
  webview: WebviewTag,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  failures: string[],
): Promise<void> {
  let last: unknown = "(no viewer)";
  try {
    await waitUntil(
      async () => {
        last = await webview
          .executeJavaScript("(window.coreViewer && window.coreViewer.readyState) || null")
          .catch((error: unknown) => `(unreadable: ${String(error)})`);
        log.debug(`viewer readyState: ${String(last)}`);
        return last === "complete";
      },
      { timeoutMs, intervalMs: 250, signal, label: "the typesetter" },
    );
  } catch (error) {
    if (isAbortError(error)) throw error;
    const reason = failures.length > 0 ? `; page errors: ${failures.join(", ")}` : "";
    throw new Error(
      `the typesetter did not finish (last state: ${String(last)})${reason}`,
    );
  }
}

/**
 * Let every image finish decoding before printing.
 *
 * Page breaks are decided from the laid-out boxes; an image that arrives after
 * the split lands on the wrong page (SPEC 5.8(5)).
 */
async function waitForImages(webview: WebviewTag): Promise<void> {
  await webview
    .executeJavaScript(
      `(async () => {
         const images = Array.from(document.images || []);
         await Promise.all(images.map((image) => image.decode().catch(() => {})));
         return true;
       })()`,
    )
    .catch(() => undefined);
}

function once(
  target: HTMLElement,
  event: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(event, onEvent);
      signal?.removeEventListener("abort", onAbort);
      clearTimeout(timer);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new AbortError());
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);

    target.addEventListener(event, onEvent, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
