import { Modal, Notice, Setting, type App } from "obsidian";
import type VivlioPlugin from "../main";
import type { BuildTarget } from "../build/collect";
import { resolveOutputPath, runExport, type ExportFormat } from "../export/run";
import type { PreflightIssue } from "../export/preflight";
import { showSaveDialog } from "../util/electron";
import { isAbortError } from "../util/async";
import { describe, writeDiagnostics } from "../util/diagnostics";
import { t } from "../i18n";
import { log } from "../util/log";

/**
 * Export settings, then the pre-export findings.
 *
 * The checks are shown before anything is written, because the things they
 * catch - an image that will print at 120 dpi, a font this machine does not
 * have - are only worth knowing while the file can still be fixed.
 */
export class ExportModal extends Modal {
  private plugin: VivlioPlugin;
  private target: BuildTarget;
  private format: ExportFormat;
  private destination = "";
  private includeCover: boolean;
  private controller = new AbortController();
  private statusEl: HTMLElement | null = null;

  constructor(app: App, plugin: VivlioPlugin, target: BuildTarget, format: ExportFormat) {
    super(app);
    this.plugin = plugin;
    this.target = target;
    this.format = format;
    this.includeCover = plugin.settings.coverInPdf;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vivlio-export-modal");
    this.setTitle(t("export.title"));

    // Only seeded once: re-rendering the dialog must not discard a path the
    // user typed or picked.
    if (!this.destination) {
      this.destination = resolveOutputPath(
        {
          app: this.app,
          settings: this.plugin.settings,
          server: this.plugin.server,
          component: this.plugin,
          target: this.target,
          format: this.format,
        },
        "",
        this.defaultTitle(),
      ).display;
    }

    new Setting(contentEl).setName(t("export.format")).addDropdown((dropdown) => {
      dropdown
        .addOption("pdf", "PDF")
        .addOption("epub", "EPUB")
        .setValue(this.format)
        .onChange((value) => {
          this.format = value as ExportFormat;
          this.destination = this.destination.replace(/\.(pdf|epub)$/i, `.${this.format}`);
          this.onOpen();
        });
    });

    new Setting(contentEl)
      .setName(t("export.destination"))
      .addText((text) => {
        text.setValue(this.destination).onChange((value) => {
          this.destination = value;
        });
        text.inputEl.addClass("vivlio-path-input");
      })
      .addButton((button) =>
        button.setButtonText(t("export.browse")).onClick(async () => {
          const chosen = await showSaveDialog({
            title: t("export.title"),
            defaultPath: this.destination,
            extension: this.format,
          });
          if (chosen) {
            this.destination = chosen;
            this.onOpen();
          }
        }),
      );

    if (this.format === "pdf") {
      new Setting(contentEl).setName(t("export.includeCover")).addToggle((toggle) =>
        toggle.setValue(this.includeCover).onChange((value) => {
          this.includeCover = value;
        }),
      );
    }

    this.statusEl = contentEl.createDiv({ cls: "vivlio-export-status" });

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText(t("export.run"))
          .setCta()
          .onClick(() => void this.run()),
      )
      .addButton((button) =>
        button.setButtonText(t("export.cancel")).onClick(() => {
          this.controller.abort();
          this.close();
        }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private defaultTitle(): string {
    if (this.target.kind === "folder") return this.target.folder.name;
    return this.target.file.basename;
  }

  private async run(): Promise<void> {
    this.setStatus(t("notice.exporting"));
    // `ensureServer` releases its own hold when it fails, so the release below
    // must only run when the hold was actually taken.
    let holdsServer = false;
    try {
      await this.plugin.ensureServer();
      holdsServer = true;
      await runExport({
        app: this.app,
        settings: this.plugin.settings,
        server: this.plugin.server,
        component: this.plugin,
        target: this.target,
        format: this.format,
        outputPath: this.destination,
        includeCover: this.includeCover,
        signal: this.controller.signal,
        onProgress: (message) => this.setStatus(message),
        onPreflight: (issues) => this.confirmIssues(issues),
      });
      this.close();
    } catch (error) {
      if (isAbortError(error)) {
        new Notice(t("notice.cancelled"));
        this.close();
        return;
      }
      log.error("export failed", error);
      await this.showFailure(error);
    } finally {
      if (holdsServer) await this.plugin.releaseServer();
    }
  }

  /**
   * Keep a failure on screen.
   *
   * A notice is gone in a few seconds, which is not long enough to read a
   * stack trace, so the message stays in the dialog and the run is written to
   * a log file that can be attached to a bug report.
   */
  private async showFailure(error: unknown): Promise<void> {
    const path = await writeDiagnostics(this.app, `export ${this.format}`, error);
    this.setStatus("");

    const box = this.contentEl.createDiv({ cls: "vivlio-failure" });
    box.createEl("p", { text: t("notice.printFailed", { message: "" }) });
    box.createEl("pre", { text: describe(error) });
    if (path) box.createEl("p", { cls: "vivlio-failure-path", text: t("export.logWritten", { path }) });

    // Zero keeps the notice up until it is clicked away.
    new Notice(t("notice.printFailed", { message: shortMessage(error) }), 0);
  }

  private setStatus(message: string): void {
    this.statusEl?.setText(message);
  }

  /** Show the findings and let the user decide whether to carry on. */
  private confirmIssues(issues: PreflightIssue[]): Promise<boolean> {
    if (issues.length === 0) return Promise.resolve(true);

    return new Promise((resolve) => {
      const { contentEl } = this;
      contentEl.empty();
      this.setTitle(t("export.preflight"));

      const list = contentEl.createEl("ul", { cls: "vivlio-preflight" });
      for (const issue of issues) {
        list.createEl("li", { text: issue.message, cls: `vivlio-${issue.level}` });
      }

      new Setting(contentEl)
        .addButton((button) =>
          button
            .setButtonText(t("export.run"))
            .setCta()
            .onClick(() => {
              contentEl.empty();
              this.statusEl = contentEl.createDiv({ cls: "vivlio-export-status" });
              this.setStatus(t("notice.exporting"));
              resolve(true);
            }),
        )
        .addButton((button) =>
          button.setButtonText(t("export.cancel")).onClick(() => resolve(false)),
        );
    });
  }
}

/** First line of an error, for the notice. */
function shortMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0].slice(0, 200);
}
