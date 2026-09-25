import {
  ItemView,
  MarkdownView,
  Notice,
  TFile,
  TFolder,
  setIcon,
  type WorkspaceLeaf,
  type Editor,
} from "obsidian";
import type VivlioPlugin from "../main";
import type { BuildTarget } from "../build/collect";
import { buildBook } from "../build/pipeline";
import { Workspace } from "../build/workspace";
import type { BuildWarning } from "../build/context";
import { themeChoices } from "../build/theme";
import { debounce, isAbortError, type Debounced } from "../util/async";
import { t } from "../i18n";
import { writeDiagnostics } from "../util/diagnostics";
import { POSITION_MESSAGE } from "../server/keepPage";
import { VIEWER_SETTINGS_MESSAGE } from "../server/viewerPreferences";
import { rememberViewerPreferences } from "../config/viewer";
import { log } from "../util/log";
import { targetForActiveFile } from "../build/target";
import { blockAtLine, collectSourceBlocks, type SourceBlock } from "../build/sourceMap";
import { SOURCE_SYNC_MESSAGE } from "../server/sourceSync";

export const VIEW_TYPE_PREVIEW = "vivlio-preview";

/**
 * The typeset preview.
 *
 * The book is rendered by the bundled Vivliostyle viewer inside an iframe
 * pointed at the local server (SPEC 3.2): the same engine, the same
 * stylesheet and the same page composition the PDF will use, so what is on
 * screen is what gets printed.
 */
export class VivlioPreviewView extends ItemView {
  private plugin: VivlioPlugin;
  private frame: HTMLIFrameElement | null = null;
  private statusEl: HTMLElement | null = null;
  private warningEl: HTMLElement | null = null;
  private workspace = new Workspace();
  private target: BuildTarget | null = null;
  private controller: AbortController | null = null;
  private scheduleRebuild: Debounced<[]>;
  /** The view holds one reference to the server, not one per rebuild. */
  private holdsServer = false;
  /**
   * Where the reader had got to in the publication source.
   *
   * A rebuild reloads the frame, which would otherwise land back on the
   * cover; the frame reports a CFI as the reader turns pages, and gets it back
   * in the URL. Unlike the epage fallback, it remains exact while lazy
   * pagination discovers more pages. Both are cleared whenever the book being
   * shown changes, because a position means nothing in a different book.
   */
  private cfi = "";
  private epage = 0;
  private viewerGeneration = 0;
  private syncEnabled = true;
  private sourceBlocks: SourceBlock[] = [];
  private sourceTexts = new Map<string, string>();
  private lastFollow = "";
  private sourceEditor: { file: TFile; editor: Editor } | null = null;
  private selectingSource = false;
  private scheduleFollow = debounce(() => this.sendFollow(), 150);

  constructor(leaf: WorkspaceLeaf, plugin: VivlioPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.scheduleRebuild = debounce(() => void this.rebuild(), plugin.settings.debounceMs);
  }

  getViewType(): string {
    return VIEW_TYPE_PREVIEW;
  }

  getDisplayText(): string {
    return t("view.title");
  }

  getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("vivlio-preview");

    this.buildToolbar(container);

    this.frame = container.createEl("iframe", { cls: "vivlio-preview-frame" });
    this.frame.setAttribute("sandbox", "allow-scripts allow-same-origin");

    // The frame is served from loopback and the app is not, so the page it is
    // on cannot be read from here; it says so instead.
    this.registerDomEvent(window, "message", (event: MessageEvent) => {
      if (event.source !== this.frame?.contentWindow) return;
      // `origin`, not `base`: base carries the session path as well, and a
      // MessageEvent's origin is only ever scheme, host and port.
      if (event.origin !== this.plugin.server.origin) return;
      const data = event.data as { type?: string; cfi?: string; epage?: number; viewId?: string; preferences?: unknown; action?: string; key?: string } | null;
      if (data?.type === SOURCE_SYNC_MESSAGE) {
        if (data.viewId !== String(this.viewerGeneration)) return;
        if (data.action === "ready") {
          this.lastFollow = "";
          this.sendFollow();
        } else if (data.action === "select" && this.syncEnabled && !this.controller) {
          const block = this.sourceBlocks.find(block => block.key === data.key);
          if (block) void this.selectSource(block).catch((error: unknown) => log.error("source navigation failed", error));
        }
        return;
      }
      if (data?.type === VIEWER_SETTINGS_MESSAGE) {
        if (data.viewId !== String(this.viewerGeneration) ||
          !rememberViewerPreferences(this.plugin.settings, data.preferences)) return;
        void this.plugin.saveSettings().catch((error: unknown) => log.error("viewer settings save failed", error));
        return;
      }
      if (!data || data.type !== POSITION_MESSAGE) return;
      if (typeof data.cfi === "string" && /^epubcfi\(.+\)$/.test(data.cfi)) {
        this.cfi = data.cfi;
      }
      if (typeof data.epage === "number" && Number.isFinite(data.epage) && data.epage >= 0) {
        this.epage = data.epage;
      }
    });

    // A note being edited elsewhere should show up here (SPEC decision 19).
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!this.plugin.settings.autoRefresh || !this.target) return;
        if (this.affects(file.path)) this.scheduleRebuild();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (this.selectingSource) return;
        if (!file || !this.plugin.settings.autoRefresh) return;
        const target = targetForActiveFile(file);
        if (this.target?.kind === "note" && target) void this.show(target);
      }),
    );

    const active = this.app.workspace.getActiveFile();
    const editorView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (editorView?.file) this.sourceEditor = { file: editorView.file, editor: editorView.editor };
    const target = targetForActiveFile(active);
    if (target) await this.show(target);
    else this.setStatus(t("view.empty"));
  }

  async onClose(): Promise<void> {
    this.viewerGeneration++;
    this.scheduleRebuild.cancel();
    this.scheduleFollow.cancel();
    this.controller?.abort();
    this.plugin.server.removeWorkspace(this.workspace.id);
    if (this.holdsServer) {
      this.holdsServer = false;
      await this.plugin.releaseServer();
    }
  }

  /** Typeset a note, a folder, or a table-of-contents note. */
  async show(target: BuildTarget): Promise<void> {
    // Another book starts at its own beginning: the page held here belongs to
    // the one being left.
    if (!sameTarget(this.target, target)) {
      this.cfi = "";
      this.epage = 0;
    }
    this.target = target;
    await this.rebuild();
  }

  private affects(path: string): boolean {
    if (!this.target) return false;
    if (this.target.kind === "config") {
      return path === this.target.file.path || path.startsWith(`${this.target.folder.path}/`);
    }
    if (path.endsWith("vivlio.yaml")) return true;
    if (this.target.kind === "folder") return path.startsWith(`${this.target.folder.path}/`);
    // Any note in the book may have been embedded into the one on screen.
    return true;
  }

  private buildToolbar(container: HTMLElement): void {
    const toolbar = container.createDiv({ cls: "vivlio-toolbar" });
    const sync = toolbar.createEl("button", { cls: "vivlio-sync-toggle" });
    const updateSyncButton = () => {
      sync.setText(t(this.syncEnabled ? "view.syncOn" : "view.syncOff"));
      sync.setAttribute("aria-pressed", String(this.syncEnabled));
    };
    updateSyncButton();
    sync.setAttribute("title", t("view.syncDescription"));
    sync.onclick = () => {
      this.syncEnabled = !this.syncEnabled;
      updateSyncButton();
      this.lastFollow = "";
      this.sendFollow();
    };

    const rebuild = toolbar.createEl("button", { cls: "vivlio-toolbar-button" });
    setIcon(rebuild.createSpan(), "refresh-cw");
    rebuild.createSpan({ text: t("view.rebuild") });
    rebuild.onclick = () => void this.rebuild();

    const themeSelect = toolbar.createEl("select", { cls: "dropdown" });
    for (const choice of themeChoices(this.app, this.plugin.settings.theme)) {
      themeSelect.createEl("option", { value: choice.value, text: choice.label });
    }
    themeSelect.value = this.plugin.settings.theme;
    themeSelect.onchange = async () => {
      this.plugin.settings.theme = themeSelect.value;
      await this.plugin.saveSettings();
      await this.rebuild();
    };

    const pdf = toolbar.createEl("button", { text: t("view.exportPdf") });
    pdf.onclick = () => {
      if (this.target) void this.plugin.exportBook(this.target, "pdf");
    };

    const epub = toolbar.createEl("button", { text: t("view.exportEpub") });
    epub.onclick = () => {
      if (this.target) void this.plugin.exportBook(this.target, "epub");
    };

    this.warningEl = toolbar.createSpan({ cls: "vivlio-warnings" });
    this.statusEl = toolbar.createSpan({ cls: "vivlio-status" });
  }

  private setStatus(message: string): void {
    if (this.statusEl) this.statusEl.setText(message);
  }

  /**
   * Rebuild and reload the frame.
   *
   * A rebuild that is already running is abandoned rather than queued: the
   * newer request always describes what the user wants to see (SPEC 5.12).
   */
  async rebuild(): Promise<void> {
    if (!this.target || !this.frame) return;

    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.setStatus(t("view.building"));

    try {
      if (!this.holdsServer) {
        await this.plugin.ensureServer();
        this.holdsServer = true;
      }
      const result = await buildBook({
        app: this.app,
        settings: this.plugin.settings,
        server: this.plugin.server,
        component: this,
        target: this.target,
        mode: "preview",
        workspace: this.workspace,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;
      this.showWarnings(result.warnings);
      this.sourceBlocks = collectSourceBlocks(result.context, result.chapters);
      this.sourceTexts = result.context.sourceTexts ?? new Map<string, string>();
      this.lastFollow = "";

      this.frame.src = this.plugin.server.bookViewerUrl(result.publicationUrl, {
        renderAllPages: this.plugin.settings.renderAllPages,
        viewer: this.plugin.settings,
        viewId: String(++this.viewerGeneration),
        cacheBust: true,
        cfi: this.cfi,
        epage: this.epage,
      });
      this.setStatus(
        this.plugin.settings.autoRefresh ? "" : t("view.autoRefreshOff"),
      );
    } catch (error) {
      if (isAbortError(error)) return;
      log.error("preview build failed", error);
      this.setStatus("");
      await writeDiagnostics(this.app, "preview", error);
      // Zero keeps the notice up until it is clicked away.
      new Notice(t("notice.buildFailed", { message: String(error) }), 0);
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  private showWarnings(warnings: BuildWarning[]): void {
    if (!this.warningEl) return;
    this.warningEl.empty();
    if (warnings.length === 0) return;

    const badge = this.warningEl.createSpan({
      cls: "vivlio-warning-badge",
      text: `⚠ ${warnings.length}`,
    });
    badge.setAttribute(
      "title",
      warnings.map((warning) => warning.message).join("\n"),
    );
  }

  followEditor(file: TFile, editor: Editor): void {
    this.sourceEditor = { file, editor };
    if (!this.selectingSource) this.scheduleFollow();
  }

  private sendFollow(): void {
    if (!this.frame || this.controller) return;
    const source = this.sourceEditor;
    const block = this.syncEnabled && source && source.editor.getValue() === this.sourceTexts.get(source.file.path)
      ? blockAtLine(this.sourceBlocks, source.file.path, source.editor.getCursor().line) : undefined;
    const key = `${this.syncEnabled}:${block?.key ?? ""}`;
    if (key === this.lastFollow) return;
    this.lastFollow = key;
    this.frame.contentWindow?.postMessage({ type: SOURCE_SYNC_MESSAGE, action: "follow",
      viewId: String(this.viewerGeneration), enabled: this.syncEnabled, url: block?.url }, this.plugin.server.origin);
  }

  private async selectSource(block: SourceBlock): Promise<void> {
    if (this.selectingSource) return;
    const generation = this.viewerGeneration;
    const file = this.app.vault.getFileByPath(block.path);
    if (!file) return;
    const existing = this.app.workspace.getLeavesOfType("markdown").find(leaf =>
      leaf.view instanceof MarkdownView && leaf.view.file?.path === block.path);
    const current = existing?.view instanceof MarkdownView ? existing.view.editor.getValue() : await this.app.vault.cachedRead(file);
    // A stale preview must never move the cursor to an unrelated line.
    if (current !== this.sourceTexts.get(block.path) || generation !== this.viewerGeneration || !this.syncEnabled || this.controller || this.selectingSource) return;
    this.selectingSource = true;
    this.scheduleFollow.cancel();
    try {
      const leaf = existing ?? this.app.workspace.getLeaf("tab");
      if (!existing) await leaf.openFile(file);
      if (leaf.view instanceof MarkdownView && leaf.view.getMode() === "preview") {
        await leaf.setViewState({ type: "markdown", state: { file: file.path, mode: "source" } });
      }
      if (generation !== this.viewerGeneration || !this.syncEnabled || this.controller || !(leaf.view instanceof MarkdownView)) return;
      const editor = leaf.view.editor;
      if (editor.getValue() !== this.sourceTexts.get(block.path)) return;
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
      const position = { line: block.start, ch: 0 };
      editor.setCursor(position);
      editor.scrollIntoView({ from: position, to: position }, true);
      editor.focus();
      this.sourceEditor = { file, editor };
      // Do not turn the preview back to the start of a split paragraph after clicking its later page.
      this.lastFollow = `${this.syncEnabled}:${blockAtLine(this.sourceBlocks, block.path, block.start)?.key ?? ""}`;
    } finally {
      this.selectingSource = false;
    }
  }
}

/** Convert whatever the user clicked into a build target. */
export function targetFor(file: TFile | TFolder | null): BuildTarget | null {
  if (file instanceof TFolder) return { kind: "folder", folder: file };
  return targetForActiveFile(file);
}

/**
 * Whether two targets name the same book.
 *
 * A note is the same note, a folder the same folder; a note and a folder are
 * never the same even where one holds the other, because the book built from
 * each is a different length.
 */
function sameTarget(a: BuildTarget | null, b: BuildTarget): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === "folder" && b.kind === "folder") return a.folder.path === b.folder.path;
  if (a.kind !== "folder" && b.kind !== "folder") return a.file.path === b.file.path;
  return false;
}
