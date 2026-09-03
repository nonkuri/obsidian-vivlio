import {
  Notice,
  Plugin,
  TFile,
  TFolder,
  normalizePath,
  type Editor,
  type WorkspaceLeaf,
} from "obsidian";
import { load as loadYaml } from "js-yaml";
import { DEFAULT_SETTINGS } from "./config/defaults";
import { findPreset } from "./config/presets";
import type { VivlioSettings } from "./config/types";
import {
  referenceYaml,
  settingsFromYaml,
  settingsToYaml,
} from "./config/yaml";
import { PreviewServer } from "./server/static";
import { CONFIG_FILE } from "./build/pipeline";
import type { BuildTarget } from "./build/collect";
import { VivlioPreviewView, VIEW_TYPE_PREVIEW } from "./view/PreviewView";
import {
  claimExtensions,
  VivlioBinaryFileView,
  VivlioTextFileView,
  VIEW_TYPE_BINARY,
  VIEW_TYPE_TEXT,
} from "./view/FileViews";
import { ExportModal } from "./view/ExportModal";
import { SetupWizard } from "./view/SetupWizard";
import { FrontmatterModal } from "./view/FrontmatterModal";
import { VivlioSettingTab } from "./view/SettingsTab";
import type { ExportFormat } from "./export/run";
import { vaultBasePath } from "./export/run";
import { setLanguage, t } from "./i18n";
import { setLogLevel } from "./util/log";
import { log } from "./util/log";
import { joinPosix } from "./util/paths";
import { writeDiagnostics } from "./util/diagnostics";

const PORT_RETRIES = 3;

export default class VivlioPlugin extends Plugin {
  settings: VivlioSettings = { ...DEFAULT_SETTINGS };
  readonly server = new PreviewServer();
  /** How many previews and exports currently need the server running. */
  private serverUsers = 0;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_PREVIEW,
      (leaf: WorkspaceLeaf) => new VivlioPreviewView(leaf, this),
    );

    // The views are always registered; only the extension claim is optional.
    // A leaf saved in the workspace layout has to find its view type again
    // after a restart, whether or not the sidebar is still listing the file.
    this.registerView(VIEW_TYPE_TEXT, (leaf: WorkspaceLeaf) => new VivlioTextFileView(leaf));
    this.registerView(
      VIEW_TYPE_BINARY,
      (leaf: WorkspaceLeaf) => new VivlioBinaryFileView(leaf),
    );
    if (this.settings.showPluginFiles) {
      claimExtensions((extensions, viewType) => this.registerExtensions(extensions, viewType));
    }

    this.addRibbonIcon("book-open", t("command.openPreview"), () => {
      void this.openPreview();
    });

    this.registerCommands();
    this.registerMenus();
    this.addSettingTab(new VivlioSettingTab(this.app, this));
  }

  async onunload(): Promise<void> {
    // Nothing may keep listening on loopback after the plugin is disabled.
    this.serverUsers = 0;
    await this.server.stop();
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<VivlioSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      syntax: { ...DEFAULT_SETTINGS.syntax, ...stored?.syntax },
      sectionDefaults: {
        ...DEFAULT_SETTINGS.sectionDefaults,
        ...stored?.sectionDefaults,
      },
    };
    // A preset that has since been withdrawn would leave the picker showing
    // one name and the wizard starting from another.
    if (!findPreset(this.settings.defaultPreset)) {
      this.settings.defaultPreset = DEFAULT_SETTINGS.defaultPreset;
    }
    setLanguage(this.settings.language);
    setLogLevel(this.settings.logLevel);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    setLanguage(this.settings.language);
    setLogLevel(this.settings.logLevel);
  }

  /**
   * Start the local server if it is not up, and count the caller as a user.
   *
   * The server only runs while a preview is open or an export is in flight
   * (SPEC 5.12): the vault is reachable over loopback for exactly as long as
   * something needs it.
   */
  async ensureServer(): Promise<void> {
    this.serverUsers += 1;
    if (this.server.running) return;

    let lastError: unknown = null;
    for (let attempt = 0; attempt < PORT_RETRIES; attempt++) {
      try {
        await this.server.start({
          vaultRoot: vaultBasePath(this.app),
          fixedPort: this.settings.fixedPort,
        });
        return;
      } catch (error) {
        lastError = error;
        log.error(`could not bind a port (attempt ${attempt + 1})`, error);
      }
    }
    this.serverUsers = Math.max(0, this.serverUsers - 1);
    new Notice(t("notice.serverFailed"));
    throw lastError ?? new Error("could not start the preview server");
  }

  /** Release one hold on the server, stopping it when nothing is left. */
  async releaseServer(): Promise<void> {
    this.serverUsers = Math.max(0, this.serverUsers - 1);
    if (this.serverUsers === 0) await this.server.stop();
  }

  private registerCommands(): void {
    this.addCommand({
      id: "open-preview",
      name: t("command.openPreview"),
      callback: () => void this.openPreview(),
    });

    this.addCommand({
      id: "export-pdf",
      name: t("command.exportPdf"),
      callback: () => {
        const target = this.activeTarget();
        if (target) this.openExport(target, "pdf");
      },
    });

    this.addCommand({
      id: "export-epub",
      name: t("command.exportEpub"),
      callback: () => {
        const target = this.activeTarget();
        if (target) this.openExport(target, "epub");
      },
    });

    this.addCommand({
      id: "export-folder",
      name: t("command.exportFolder"),
      callback: () => {
        const folder = this.app.workspace.getActiveFile()?.parent;
        if (!folder) {
          new Notice(t("notice.noActiveNote"));
          return;
        }
        this.openExport({ kind: "folder", folder }, "pdf");
      },
    });

    this.addCommand({
      id: "export-from-toc",
      name: t("command.exportFromToc"),
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new Notice(t("notice.noActiveNote"));
          return;
        }
        this.openExport({ kind: "toc", file }, "pdf");
      },
    });

    this.addCommand({
      id: "rebuild",
      name: t("command.rebuild"),
      callback: () => {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PREVIEW)) {
          void (leaf.view as VivlioPreviewView).rebuild();
        }
      },
    });

    this.addCommand({
      id: "create-config",
      name: t("command.createConfig"),
      callback: () => {
        const folder = this.app.workspace.getActiveFile()?.parent;
        new SetupWizard(this.app, this, folder?.path === "/" ? "" : (folder?.path ?? "")).open();
      },
    });

    this.addCommand({
      id: "insert-frontmatter",
      name: t("command.insertFrontmatter"),
      editorCallback: (editor: Editor) => {
        new FrontmatterModal(this.app, this, editor).open();
      },
    });

    this.addCommand({
      id: "write-reference",
      name: t("command.writeReference"),
      callback: () => void this.writeConfig(referenceYaml(this.settings), "vivlio-reference.yaml"),
    });

    this.addCommand({
      id: "settings-to-yaml",
      name: t("command.settingsToYaml"),
      callback: () => void this.writeConfig(settingsToYaml(this.settings), CONFIG_FILE),
    });

    this.addCommand({
      id: "write-log",
      name: t("command.writeLog"),
      callback: () => void this.writeLog(),
    });

    this.addCommand({
      id: "yaml-to-settings",
      name: t("command.yamlToSettings"),
      callback: () => void this.importYaml(),
    });
  }

  private registerMenus(): void {
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFolder) {
          menu.addItem((item) =>
            item
              .setTitle(t("menu.exportFolder"))
              .setIcon("book-open")
              .onClick(() => this.openExport({ kind: "folder", folder: file }, "pdf")),
          );
          return;
        }
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) =>
            item
              .setTitle(t("menu.preview"))
              .setIcon("book-open")
              .onClick(() => void this.openPreview({ kind: "note", file })),
          );
        }
      }),
    );
  }

  private activeTarget(): BuildTarget | null {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice(t("notice.noActiveNote"));
      return null;
    }
    return { kind: "note", file };
  }

  async openPreview(target?: BuildTarget): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_PREVIEW);
    const leaf = leaves[0] ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;

    if (leaves.length === 0) await leaf.setViewState({ type: VIEW_TYPE_PREVIEW, active: true });
    this.app.workspace.revealLeaf(leaf);

    const view = leaf.view as VivlioPreviewView;
    const resolved = target ?? this.activeTarget();
    if (resolved) await view.show(resolved);
  }

  openExport(target: BuildTarget, format: ExportFormat): void {
    new ExportModal(this.app, this, target, format).open();
  }

  /** Used by the preview toolbar. */
  exportBook(target: BuildTarget, format: ExportFormat): void {
    this.openExport(target, format);
  }

  private async writeConfig(contents: string, name: string): Promise<void> {
    const folder = this.app.workspace.getActiveFile()?.parent;
    const root = folder?.path === "/" ? "" : (folder?.path ?? "");
    const path = normalizePath(joinPosix(root, name));

    const existing = this.app.vault.getFileByPath(path);
    if (existing) await this.app.vault.modify(existing, contents);
    else await this.app.vault.create(path, contents);

    new Notice(t("notice.configWritten", { path }));
  }

  /**
   * Write what the plugin has logged so far to a file.
   *
   * Notices vanish and the console needs the developer tools open, so this is
   * the thing to attach to a bug report.
   */
  private async writeLog(): Promise<void> {
    const path = await writeDiagnostics(this.app, "manual", null);
    new Notice(
      path ? t("notice.configWritten", { path }) : t("notice.buildFailed", { message: "log" }),
    );
  }

  /** Take a book's `vivlio.yaml` back into the vault-wide defaults. */
  private async importYaml(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    const folder = file?.parent?.path === "/" ? "" : (file?.parent?.path ?? "");
    const path = normalizePath(joinPosix(folder, CONFIG_FILE));
    const config = this.app.vault.getFileByPath(path);
    if (!config) {
      new Notice(t("preflight.missingAsset", { path }));
      return;
    }

    try {
      const parsed = loadYaml(await this.app.vault.cachedRead(config));
      if (!parsed || typeof parsed !== "object") throw new Error("not a mapping");
      this.settings = settingsFromYaml(parsed as Record<string, unknown>, this.settings);
      await this.saveSettings();
      new Notice(t("notice.configWritten", { path }));
    } catch (error) {
      log.error(`could not read ${path}`, error);
      new Notice(t("notice.buildFailed", { message: String(error) }));
    }
  }
}
