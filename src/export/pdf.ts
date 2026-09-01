import type { BuildContext } from "../build/context";
import { warn } from "../build/context";
import { remote, type RemoteWebContentsInstance } from "../util/electron";
import { AbortError, throwIfAborted, waitUntil } from "../util/async";
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
  webview.src = "about:blank";
  document.body.appendChild(webview);

  const abortListener = () => {
    webview.remove();
  };
  signal?.addEventListener("abort", abortListener, { once: true });

  try {
    await once(webview, "dom-ready", context.settings.printTimeoutMs, signal);
    throwIfAborted(signal);

    // Vivliostyle evaluates media queries while laying out, so the media type
    // has to be `print` before the document loads (SPEC 3.5).
    const debuggerHandle = await emulatePrintMedia(context, webview);

    options.onProgress?.("loading");
    const target = `${viewerUrl}#src=${encodeURIComponent(
      publicationUrl,
    )}&bookMode=true&renderAllPages=true&spread=false`;
    await webview.loadURL(target);
    await once(webview, "dom-ready", context.settings.printTimeoutMs, signal);

    options.onProgress?.("typesetting");
    await waitForViewer(webview, context.settings.printTimeoutMs, signal);

    options.onProgress?.("images");
    await waitForImages(webview);

    const toc = (await webview
      .executeJavaScript("JSON.parse(JSON.stringify(window.coreViewer.getTOC() || []))")
      .catch(() => [])) as ViewerTocItem[];
    const layout = await readLayout(webview);

    options.onProgress?.("printing");
    const pdf = await webview.printToPDF({
      margin: { marginType: "custom", top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true,
      preferCSSPageSize: true,
      generateTaggedPDF: context.settings.taggedPdf,
      generateDocumentOutline: false,
    });

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

/** Wait for `window.coreViewer.readyState === "complete"` (SPEC 2.5). */
async function waitForViewer(
  webview: WebviewTag,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  await waitUntil(
    async () => {
      const state = await webview
        .executeJavaScript("window.coreViewer && window.coreViewer.readyState")
        .catch(() => null);
      return state === "complete";
    },
    { timeoutMs, intervalMs: 200, signal, label: "the typesetter" },
  );
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
