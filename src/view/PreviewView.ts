import {
  ItemView,
  Notice,
  TFile,
  TFolder,
  setIcon,
  type WorkspaceLeaf,
} from "obsidian";
import type VivlioPlugin from "../main";
import type { BuildTarget } from "../build/collect";
import { buildBook } from "../build/pipeline";
import { Workspace } from "../build/workspace";
import type { BuildWarning } from "../build/context";
import { BUNDLED_THEMES } from "../vendor/assets";
import { debounce, isAbortError, type Debounced } from "../util/async";
import { t } from "../i18n";
import { writeDiagnostics } from "../util/diagnostics";
import { log } from "../util/log";

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

    // A note being edited elsewhere should show up here (SPEC decision 19).
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!this.plugin.settings.autoRefresh || !this.target) return;
        if (this.affects(file.path)) this.scheduleRebuild();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file || !this.plugin.settings.autoRefresh) return;
        if (this.target?.kind === "note") void this.show({ kind: "note", file });
      }),
    );

    const active = this.app.workspace.getActiveFile();
    if (active) await this.show({ kind: "note", file: active });
    else this.setStatus(t("view.empty"));
  }

  async onClose(): Promise<void> {
    this.scheduleRebuild.cancel();
    this.controller?.abort();
    this.plugin.server.removeWorkspace(this.workspace.id);
    if (this.holdsServer) {
      this.holdsServer = false;
      await this.plugin.releaseServer();
    }
  }

  /** Typeset a note, a folder, or a table-of-contents note. */
  async show(target: BuildTarget): Promise<void> {
    this.target = target;
    await this.rebuild();
  }

  private affects(path: string): boolean {
    if (!this.target) return false;
    if (path.endsWith("vivlio.yaml")) return true;
    if (this.target.kind === "folder") return path.startsWith(`${this.target.folder.path}/`);
    // Any note in the book may have been embedded into the one on screen.
    return true;
  }

  private buildToolbar(container: HTMLElement): void {
    const toolbar = container.createDiv({ cls: "vivlio-toolbar" });

    const rebuild = toolbar.createEl("button", { cls: "vivlio-toolbar-button" });
    setIcon(rebuild.createSpan(), "refresh-cw");
    rebuild.createSpan({ text: t("view.rebuild") });
    rebuild.onclick = () => void this.rebuild();

    const themeSelect = toolbar.createEl("select", { cls: "dropdown" });
    for (const name of Object.keys(BUNDLED_THEMES)) {
      themeSelect.createEl("option", { value: name, text: name });
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

      this.frame.src = this.plugin.server.bookViewerUrl(result.publicationUrl, {
        renderAllPages: this.plugin.settings.renderAllPages,
        cacheBust: true,
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
}

/** Convert whatever the user clicked into a build target. */
export function targetFor(file: TFile | TFolder | null): BuildTarget | null {
  if (file instanceof TFolder) return { kind: "folder", folder: file };
  if (file instanceof TFile && file.extension === "md") return { kind: "note", file };
  return null;
}
