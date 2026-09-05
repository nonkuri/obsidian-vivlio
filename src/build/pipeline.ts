import { TFile, type App, type Component } from "obsidian";
import { load as loadYaml } from "js-yaml";
import type { BookConfig, VivlioSettings } from "../config/types";
import { extractFrontmatterConfig, resolveConfig } from "../config/resolve";
import type { PreviewServer } from "../server/static";
import { Workspace } from "./workspace";
import {
  warn,
  type BuildContext,
  type BuildMode,
  type BuildWarning,
  type Chapter,
} from "./context";
import {
  bookRootOf,
  collectNotes,
  headingsOf,
  isTocNote,
  titleOf,
  type BuildTarget,
} from "./collect";
import { collectImageSizes } from "./imageSizes";
import { bookStylesheet, themeUrlFor } from "./css";
import { resolveVaultTheme, THEME_STYLESHEET } from "./theme";
import { BOOK_STYLESHEET, convertChapter } from "./vfm";
import { buildCover } from "./cover";
import {
  colophonDocument,
  halfTitleDocument,
  planSections,
  roleFor,
  titlePageDocument,
} from "./sections";
import { tocDocument } from "./toc";
import { publicationManifest } from "./manifest";
import { throwIfAborted } from "../util/async";
import { joinPosix, stripExtension } from "../util/paths";
import { log } from "../util/log";
import { t } from "../i18n";

export const CONFIG_FILE = "vivlio.yaml";

export interface BuildRequest {
  app: App;
  settings: VivlioSettings;
  server: PreviewServer;
  component: Component;
  target: BuildTarget;
  mode: BuildMode;
  /** Reuse a workspace so the preview keeps the same URL across rebuilds. */
  workspace?: Workspace;
  /** Applied on top of the three configuration layers, for one run only. */
  overrides?: Partial<BookConfig>;
  signal?: AbortSignal;
}

export interface BuildResult {
  context: BuildContext;
  workspace: Workspace;
  chapters: Chapter[];
  warnings: BuildWarning[];
  /** URL of `publication.json`, which is what the viewer is pointed at. */
  publicationUrl: string;
}

/** Read `vivlio.yaml` for a book (SPEC 5.4, layer 2). */
export async function readBookYaml(
  app: App,
  bookRoot: string,
): Promise<Record<string, unknown> | null> {
  const path = joinPosix(bookRoot, CONFIG_FILE);
  const file = app.vault.getFileByPath(path);
  if (!file) return null;
  try {
    const parsed = loadYaml(await app.vault.cachedRead(file));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch (error) {
    log.error(`could not parse ${path}`, error);
    return null;
  }
}

/**
 * The note whose frontmatter acts as layer 3 for a whole book: the table of
 * contents note for a folder, the note itself for a single-note export.
 */
function primaryNote(app: App, target: BuildTarget): TFile | null {
  if (target.kind !== "folder") return target.file;
  for (const child of target.folder.children) {
    if (child instanceof TFile && child.extension === "md" && isTocNote(app, child, target.folder)) {
      return child;
    }
  }
  return null;
}

/**
 * Build a book: collect the notes, convert them, and lay the result out in a
 * workspace the local server can hand to Vivliostyle.
 */
export async function buildBook(request: BuildRequest): Promise<BuildResult> {
  const { app, settings, server, target, mode, signal } = request;
  throwIfAborted(signal);

  const bookRoot = bookRootOf(target);
  const yaml = await readBookYaml(app, bookRoot);
  const primary = primaryNote(app, target);
  const frontmatter = primary
    ? extractFrontmatterConfig(
        app.metadataCache.getFileCache(primary)?.frontmatter,
      )
    : null;

  const { config, issues } = resolveConfig({ settings, yaml, frontmatter });
  Object.assign(config, request.overrides ?? {});

  const workspace = request.workspace ?? new Workspace();
  workspace.clear();
  server.addWorkspace(workspace);

  const context: BuildContext = {
    app,
    settings,
    config,
    workspace,
    mode,
    bookRoot,
    chapters: [],
    chapterByPath: new Map(),
    headings: new Map(),
    imageSizes: new Map(),
    warnings: [],
    component: request.component,
    workspaceBase: `${server.base}/w/${workspace.id}/`,
    vaultBase: `${server.base}/vault/`,
    themeBase: `${server.base}/themes/`,
    signal,
  };

  for (const issue of issues) {
    warn(context, { kind: "config", message: `${issue.key}: ${issue.message}` });
  }

  const { notes } = await collectNotes(app, target, { includeToc: config.includeToc });
  throwIfAborted(signal);

  if (!config.title) {
    config.title =
      target.kind === "folder"
        ? target.folder.name || t("book.untitled")
        : titleOf(app, target.file);
  }

  for (const note of notes) context.headings.set(note.path, headingsOf(app, note));

  const chapters = planChapters(context, notes);
  context.chapters = chapters;
  for (const chapter of chapters) {
    if (chapter.file) context.chapterByPath.set(chapter.file.path, chapter);
  }

  // Every picture is measured before any of them is laid out. The transform
  // that sizes a picture is synchronous and cannot read a file, and the box
  // it has to compute depends on the picture's shape (SPEC 5.8(3)).
  const coverFile = config.cover
    ? app.metadataCache.getFirstLinkpathDest(config.cover, `${bookRoot}/`)
    : null;
  context.imageSizes = await collectImageSizes(
    app,
    notes,
    coverFile ? [coverFile] : [],
    signal,
  );
  throwIfAborted(signal);

  // A theme of the writer's own is resolved into the workspace before the
  // stylesheet that imports it, so `themeUrlFor` can point at the resolved
  // copy rather than at the file in the vault (SPEC 5.10).
  const vaultTheme = await resolveVaultTheme(context);
  if (vaultTheme !== null) workspace.putText(THEME_STYLESHEET, vaultTheme);

  // The stylesheet is written next: every document links to it by name.
  workspace.putText(BOOK_STYLESHEET, bookStylesheet(context, themeUrlFor(context)));

  for (const chapter of chapters) {
    throwIfAborted(signal);
    if (!chapter.file) continue;
    const markdown = await app.vault.cachedRead(chapter.file);
    const html = await convertChapter(context, chapter, chapter.file, markdown);
    workspace.putText(chapter.docName, html);
  }

  // Generated parts come last: the table of contents needs every chapter's
  // headings, and the cover needs the asset table.
  for (const chapter of chapters) {
    throwIfAborted(signal);
    if (chapter.file) continue;
    const html = chapter.html ?? generateDocument(context, chapter, chapters);
    if (html) workspace.putText(chapter.docName, html);
  }

  // The extra stylesheet from the settings tab is appended after the theme.
  await appendExtraCss(context);

  workspace.putText("publication.json", publicationManifest(context, chapters));

  return {
    context,
    workspace,
    chapters,
    warnings: context.warnings,
    publicationUrl: `${context.workspaceBase}publication.json`,
  };
}

/**
 * Assemble the spine (SPEC 5.2, 5.9, 5.11): cover, front matter in canonical
 * order, body chapters, then back matter.
 */
function planChapters(context: BuildContext, notes: TFile[]): Chapter[] {
  const { app, config } = context;
  const chapters: Chapter[] = [];

  // --- cover -------------------------------------------------------------
  const includeCover = context.mode === "epub" || config.coverInPdf || context.mode === "preview";
  if (includeCover) {
    if (config.coverPage) {
      const file = app.metadataCache.getFirstLinkpathDest(
        config.coverPage,
        `${context.bookRoot}/`,
      );
      if (file) {
        context.headings.set(file.path, []);
        chapters.push({
          docName: "cover.html",
          file,
          title: config.title,
          role: "doc-cover",
          slot: null,
          isBody: false,
          isFrontMatter: false,
        });
      } else {
        warn(context, { kind: "config", message: `coverPage: ${config.coverPage} not found` });
      }
    } else if (config.cover) {
      const cover = buildCover(context);
      if (cover) {
        chapters.push({
          docName: "cover.html",
          file: null,
          title: config.title,
          role: "doc-cover",
          slot: null,
          isBody: false,
          isFrontMatter: false,
          html: cover.html,
        });
      }
    }
  }

  const plans = planSections(context);
  const front = plans.filter((plan) => plan.isFrontMatter);
  const back = plans.filter((plan) => !plan.isFrontMatter);

  // A note named as the preface, the afterword or the cover is already in the
  // book once. It is usually a note in the book's own folder, which is also
  // where the body comes from, so without this it would be set twice - once
  // in its part and once as a chapter of the body.
  const spoken = new Set<string>();
  for (const chapter of chapters) if (chapter.file) spoken.add(chapter.file.path);
  for (const plan of plans) if (plan.file) spoken.add(plan.file.path);

  for (const plan of front) {
    if (plan.file) context.headings.set(plan.file.path, headingsOf(app, plan.file));
    chapters.push({
      docName: `${plan.slot.toLowerCase()}.html`,
      file: plan.file,
      title: t(`section.${plan.slot}` as never),
      role: plan.role,
      slot: plan.slot,
      isBody: false,
      isFrontMatter: true,
    });
  }

  // --- body --------------------------------------------------------------
  notes.filter((file) => !spoken.has(file.path)).forEach((file, index) => {
    chapters.push({
      docName: `ch${String(index + 1).padStart(2, "0")}.html`,
      file,
      title: titleOf(app, file),
      role: null,
      slot: null,
      isBody: true,
      isFrontMatter: false,
      // Roman front matter means the body has to start counting again.
      startPage:
        index === 0 && config.pageNumbering === "roman-then-arabic"
          ? config.startPage ?? 1 : undefined,
    });
  });

  for (const plan of back) {
    if (plan.file) context.headings.set(plan.file.path, headingsOf(app, plan.file));
    chapters.push({
      docName: `${plan.slot.toLowerCase()}.html`,
      file: plan.file,
      title: t(`section.${plan.slot}` as never),
      role: plan.role,
      slot: plan.slot,
      isBody: false,
      isFrontMatter: false,
    });
  }

  // In continuous mode startPage belongs to the first numbered leaf, not to
  // the first body chapter. The cover is outside the pagination; a title page,
  // contents page or inserted blank before the preface is part of it.
  if (config.pageNumbering === "continuous" && config.startPage !== null) {
    const firstNumbered = chapters.find((chapter) => chapter.role !== "doc-cover");
    if (firstNumbered) firstNumbered.startPage = config.startPage;
  }

  return chapters;
}

/** Markup for the parts the plugin can generate on its own. */
function generateDocument(
  context: BuildContext,
  chapter: Chapter,
  chapters: Chapter[],
): string | null {
  switch (chapter.slot) {
    case "halfTitle":
      return halfTitleDocument(
        context,
        context.config.pageNumbering === "roman-then-arabic" && chapter.startPage !== undefined,
      );
    case "titlePage":
      return titlePageDocument(
        context,
        context.config.pageNumbering === "roman-then-arabic" && chapter.startPage !== undefined,
      );
    case "toc":
      return tocDocument(
        context,
        chapters,
        context.config.pageNumbering === "roman-then-arabic" && chapter.startPage !== undefined,
      );
    case "colophon":
      return colophonDocument(
        context,
        context.config.pageNumbering === "roman-then-arabic" && chapter.startPage !== undefined,
      );
    default:
      return null;
  }
}

/** Extra CSS from the settings tab, imported after the theme (SPEC 5.5). */
async function appendExtraCss(context: BuildContext): Promise<void> {
  const path = context.settings.extraCssPath.trim();
  if (!path) return;
  const file = context.app.vault.getFileByPath(path);
  if (!file) {
    warn(context, { kind: "config", message: `extra stylesheet not found: ${path}` });
    return;
  }
  const css = await context.app.vault.cachedRead(file);
  const current = context.workspace.getFile(BOOK_STYLESHEET)?.text ?? "";
  context.workspace.putText(
    BOOK_STYLESHEET,
    `${current}\n\n/* ${stripExtension(file.name)} */\n${css}`,
  );
}
