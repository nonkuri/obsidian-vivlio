import { FileView, Notice, TextFileView, type TFile } from "obsidian";
import { openPath, showInFolder } from "../util/electron";
import { vaultBasePath } from "../export/run";
import { t } from "../i18n";
import { log } from "../util/log";

/**
 * Views for the files this plugin makes a writer keep, and Obsidian does not
 * show them.
 *
 * The file explorer lists only the extensions some view has claimed - Markdown,
 * canvas, images, audio, video, PDF - unless "Detect all file extensions" is
 * turned on, which most vaults leave alone. A `vivlio.yaml` written into the
 * book's folder was therefore invisible from the moment it was created: the
 * writer had a configuration file they could not see, could not click, and had
 * no reason to believe existed.
 *
 * Claiming the extensions is what puts them in the sidebar; the views below
 * are what makes the click that follows worth anything. The text one edits
 * (a book configuration and a stylesheet are both things to change by hand),
 * the binary one hands the file to the application that can actually read it.
 */

export const VIEW_TYPE_TEXT = "vivlio-text";
export const VIEW_TYPE_BINARY = "vivlio-binary";

/** Text files the plugin asks a writer to keep: the book configuration, themes. */
export const TEXT_EXTENSIONS = ["yaml", "yml", "css"];

/** What the plugin writes and only another application can open. */
export const BINARY_EXTENSIONS = ["epub"];

/**
 * A plain-text editor, for a `vivlio.yaml` or a theme of one's own.
 *
 * Deliberately a textarea and not CodeMirror: Obsidian's editor is built
 * around Markdown, and what this needs is somewhere to fix an indent without
 * leaving the vault. Anything more is what a text editor is for, which the
 * button in the corner opens.
 */
export class VivlioTextFileView extends TextFileView {
  private editor: HTMLTextAreaElement | null = null;

  getViewType(): string {
    return VIEW_TYPE_TEXT;
  }

  getDisplayText(): string {
    return this.file?.name ?? "Vivlio";
  }

  getIcon(): string {
    return "file-code";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("vivlio-file-view");

    externalActions(this, this.contentEl);

    this.editor = this.contentEl.createEl("textarea", { cls: "vivlio-file-editor" });
    this.editor.spellcheck = false;
    this.editor.value = this.data ?? "";
    this.registerDomEvent(this.editor, "input", () => {
      this.data = this.editor?.value ?? "";
      this.requestSave();
    });
  }

  getViewData(): string {
    return this.editor?.value ?? this.data ?? "";
  }

  setViewData(data: string, clear: boolean): void {
    this.data = data;
    if (!this.editor) return;
    this.editor.value = data;
    // A different file: the caret and the scroll belonged to the old one.
    if (clear) this.editor.setSelectionRange(0, 0);
  }

  clear(): void {
    this.data = "";
    if (this.editor) this.editor.value = "";
  }
}

/** An EPUB: named, measured, and handed to whatever reads EPUBs here. */
export class VivlioBinaryFileView extends FileView {
  getViewType(): string {
    return VIEW_TYPE_BINARY;
  }

  getDisplayText(): string {
    return this.file?.name ?? "Vivlio";
  }

  getIcon(): string {
    return "book-open";
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("vivlio-file-view");

    const card = this.contentEl.createDiv({ cls: "vivlio-binary-card" });
    card.createEl("p", { cls: "vivlio-binary-name", text: file.name });
    card.createEl("p", {
      cls: "setting-item-description",
      text: t("fileView.binary.desc", { size: humanSize(file.stat.size) }),
    });
    externalActions(this, card);
  }

  async onUnloadFile(): Promise<void> {
    this.contentEl.empty();
  }
}

/**
 * "Open in the default app" and "show in the folder", for a view whose file
 * the writer will sooner or later want outside Obsidian.
 */
function externalActions(view: FileView, container: HTMLElement): void {
  const bar = container.createDiv({ cls: "vivlio-file-actions" });

  const act = (label: string, run: (absolute: string) => void) => {
    const button = bar.createEl("button", { text: label });
    view.registerDomEvent(button, "click", () => {
      const file = view.file;
      const base = vaultBasePath(view.app);
      if (!file || !base) {
        new Notice(t("notice.desktopOnly"));
        return;
      }
      run(`${base}/${file.path}`);
    });
  };

  act(t("fileView.openExternally"), (absolute) => void openPath(absolute));
  act(t("fileView.showInFolder"), (absolute) => showInFolder(absolute));
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/**
 * Claim the extensions, so the file explorer lists them.
 *
 * One at a time and each in its own try: another plugin may already own an
 * extension, and Obsidian refuses the second claim. Losing `css` to a theme
 * editor is not a reason to also lose `yaml`, which is the one this plugin
 * cannot do without.
 */
export function claimExtensions(
  register: (extensions: string[], viewType: string) => void,
): void {
  for (const extension of TEXT_EXTENSIONS) {
    try {
      register([extension], VIEW_TYPE_TEXT);
    } catch (error) {
      log.info(`.${extension} is already claimed by something else`, error);
    }
  }
  for (const extension of BINARY_EXTENSIONS) {
    try {
      register([extension], VIEW_TYPE_BINARY);
    } catch (error) {
      log.info(`.${extension} is already claimed by something else`, error);
    }
  }
}
