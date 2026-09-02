import { Notice, normalizePath, type App, type Component } from "obsidian";
import type { VivlioSettings } from "../config/types";
import type { PreviewServer } from "../server/static";
import type { BuildTarget } from "../build/collect";
import { buildBook } from "../build/pipeline";
import { materializeAssets } from "../build/materialize";
import { preflight, type PreflightIssue } from "./preflight";
import { renderPdf } from "./pdf";
import { postprocessPdf } from "./pdfPostprocess";
import { buildEpub } from "./epub";
import { buildTocEntries, type TocEntry } from "../build/toc";
import { openPath } from "../util/electron";
import { joinPosix, sanitizeFileName } from "../util/paths";
import { AbortError } from "../util/async";
import { t } from "../i18n";
import { log } from "../util/log";

export type ExportFormat = "pdf" | "epub";

export interface ExportRequest {
  app: App;
  settings: VivlioSettings;
  server: PreviewServer;
  component: Component;
  target: BuildTarget;
  format: ExportFormat;
  /** Absolute path, or vault-relative; resolved from the configuration if absent. */
  outputPath?: string;
  /** Overrides `coverInPdf` for this run. */
  includeCover?: boolean;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  /**
   * Called with the pre-export findings before anything is rendered or
   * written. Returning false cancels the export (SPEC 5.8(6), 5.9, 5.10).
   */
  onPreflight?: (issues: PreflightIssue[]) => Promise<boolean>;
}

export interface ExportResult {
  path: string;
  issues: PreflightIssue[];
}

/**
 * Build a book and write it out.
 *
 * The checks run after the build but before writing, so a warning (a low-dpi
 * image, a font that is not installed) can name the real file that will end up
 * in the output.
 */
export async function runExport(request: ExportRequest): Promise<ExportResult> {
  const { app, settings, server, component, target, format, signal } = request;

  request.onProgress?.(t("notice.exporting"));
  const build = await buildBook({
    app,
    settings,
    server,
    component,
    target,
    mode: format,
    signal,
    // The choice made in the export dialog has to reach the build before the
    // spine is planned; afterwards the cover is already in the book.
    overrides:
      request.includeCover === undefined ? undefined : { coverInPdf: request.includeCover },
  });

  await materializeAssets(build.context, {
    forEpub: format === "epub",
    keepBytes: format === "epub",
  });

  const issues = await preflight(build.context, { forEpub: format === "epub" });
  if (request.onPreflight && !(await request.onPreflight(issues))) {
    server.removeWorkspace(build.workspace.id);
    throw new AbortError();
  }

  const destination = resolveOutputPath(request, build.context.config.output, build.context.config.title);

  const bytes =
    format === "pdf"
      ? await exportPdf(request, build)
      : await buildEpub(build.context, build.chapters, coverAsset(build.context));

  await writeOutput(app, destination, bytes);
  server.removeWorkspace(build.workspace.id);

  if (settings.openAfterExport) await openPath(destination.absolutePath);
  new Notice(t("notice.exported", { path: destination.display }));

  return { path: destination.absolutePath, issues };
}

/**
 * The image the EPUB should advertise as its cover.
 *
 * EPUB readers use it for the shelf thumbnail, so picking the wrong asset is
 * worse than picking none.
 */
function coverAsset(context: Awaited<ReturnType<typeof buildBook>>["context"]) {
  const cover = context.config.cover;
  if (!cover) return null;
  return (
    [...context.workspace.assets.values()].find((asset) => asset.label.endsWith(cover)) ?? null
  );
}

async function exportPdf(
  request: ExportRequest,
  build: Awaited<ReturnType<typeof buildBook>>,
): Promise<Uint8Array> {
  const { settings } = request;
  const rendered = await renderPdf(
    build.context,
    request.server.bookViewerUrl(build.publicationUrl, { renderAllPages: true }),
    { onProgress: request.onProgress },
  );

  return postprocessPdf(rendered.pdf, {
    config: build.context.config,
    toc: outlineEntries(buildTocEntries(build.context, build.chapters)),
    anchorPages: rendered.anchorPages,
    pageClasses: rendered.pageClasses,
    metadata: settings.pdfMetadata,
    outline: settings.pdfOutline,
    pageLabels: build.context.config.pageNumbering !== "none",
  });
}

/**
 * The book's own table of contents, shaped for the PDF outline.
 *
 * `coreViewer.getTOC()` only returns anything once the viewer's TOC box has
 * been opened, so asking it during a headless print yields nothing; the
 * entries the book itself prints are both available and authoritative.
 */
function outlineEntries(entries: TocEntry[]): {
  title: string;
  href: string;
  children: ReturnType<typeof outlineEntries>;
}[] {
  return entries.map((entry) => ({
    title: entry.label,
    href: entry.href,
    children: outlineEntries(entry.children),
  }));
}

interface Destination {
  /** Absolute filesystem path. */
  absolutePath: string;
  /** Vault-relative path when the file lands inside the vault. */
  vaultPath: string | null;
  display: string;
}

/**
 * Where the file goes (SPEC 5.4, decision 16).
 *
 * An explicit `output` wins; otherwise the vault's output folder takes the
 * book's title as the file name.
 */
export function resolveOutputPath(
  request: ExportRequest,
  configured: string,
  title: string,
): Destination {
  const extension = request.format;
  const vaultRoot = vaultBasePath(request.app);

  const explicit = request.outputPath ?? configured;
  if (explicit) {
    if (isAbsolutePath(explicit)) {
      return { absolutePath: explicit, vaultPath: null, display: explicit };
    }
    const vaultPath = normalizePath(explicit);
    return {
      absolutePath: `${vaultRoot}/${vaultPath}`,
      vaultPath,
      display: vaultPath,
    };
  }

  const name = `${sanitizeFileName(title || "book")}.${extension}`;
  const folder = request.settings.outputFolder.trim();
  const vaultPath = normalizePath(folder ? joinPosix(folder, name) : name);
  return { absolutePath: `${vaultRoot}/${vaultPath}`, vaultPath, display: vaultPath };
}

function isAbsolutePath(path: string): boolean {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(path);
}

export function vaultBasePath(app: App): string {
  const adapter = app.vault.adapter as unknown as { getBasePath?: () => string };
  return adapter.getBasePath?.() ?? "";
}

/**
 * Write the result, creating the folder if the destination is in the vault so
 * that a fresh `_output/` does not fail the first export.
 */
async function writeOutput(
  app: App,
  destination: Destination,
  bytes: Uint8Array,
): Promise<void> {
  if (destination.vaultPath) {
    const folder = destination.vaultPath.split("/").slice(0, -1).join("/");
    if (folder && !(await app.vault.adapter.exists(folder))) {
      await app.vault.adapter.mkdir(folder);
    }
    await app.vault.adapter.writeBinary(destination.vaultPath, toArrayBuffer(bytes));
    return;
  }

  const fs = await import("fs");
  const path = await import("path");
  await fs.promises.mkdir(path.dirname(destination.absolutePath), { recursive: true });
  await fs.promises.writeFile(destination.absolutePath, bytes);
  log.info(`wrote ${destination.absolutePath}`);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
