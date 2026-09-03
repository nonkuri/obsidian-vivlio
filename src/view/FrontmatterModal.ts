import { Modal, Setting, type App, type Editor } from "obsidian";
import type VivlioPlugin from "../main";
import {
  frontmatterKeyChoices,
  frontmatterSnippetFor,
  STANDARD_KEYS,
  type FrontmatterKeyChoice,
} from "../config/yaml";
import type { BookConfig } from "../config/types";
import { t } from "../i18n";

/**
 * Choose which `vivlio-*` properties a note gets (SPEC 5.4, layer 3).
 *
 * The command used to add one fixed list of seven keys. A note that needed an
 * eighth had nowhere to go but the reference file, and a note that needed two
 * of the seven carried five properties it would never use - and every one of
 * them shows in Obsidian's property panel, on every note, forever. Neither
 * "the minimum" nor "everything" is the right list, because the right list is
 * per note.
 *
 * So the note says what it already has, and the writer ticks the rest. What
 * is already there is shown and locked: this command adds properties, and
 * silently rewriting a value the note had set would be a different, much
 * ruder command.
 */
export class FrontmatterModal extends Modal {
  private plugin: VivlioPlugin;
  private editor: Editor;
  /** Properties the note already carries; offered, but not touched. */
  private present: Set<string>;
  private chosen = new Set<keyof BookConfig>();

  constructor(app: App, plugin: VivlioPlugin, editor: Editor) {
    super(app);
    this.plugin = plugin;
    this.editor = editor;
    this.present = existingProperties(editor.getValue());

    for (const key of STANDARD_KEYS) {
      if (!this.present.has(`vivlio-${kebab(key)}`)) this.chosen.add(key);
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vivlio-frontmatter-modal");
    contentEl.createEl("h2", { text: t("frontmatter.title") });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: t("frontmatter.desc"),
    });

    const list = contentEl.createDiv({ cls: "vivlio-frontmatter-list" });
    let group = "";
    for (const choice of frontmatterKeyChoices()) {
      if (choice.group !== group) {
        group = choice.group;
        list.createEl("h4", { text: choice.groupLabel });
      }
      this.row(list, choice);
    }

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText(t("frontmatter.cancel")).onClick(() => this.close()),
      )
      .addButton((button) =>
        button
          .setButtonText(t("frontmatter.add"))
          .setCta()
          .onClick(() => this.insert()),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private row(container: HTMLElement, choice: FrontmatterKeyChoice): void {
    const already = this.present.has(choice.property);
    const setting = new Setting(container)
      .setName(choice.property)
      .setDesc(already ? t("frontmatter.alreadyThere") : choice.description);
    setting.addToggle((toggle) => {
      toggle.setValue(already || this.chosen.has(choice.key));
      if (already) {
        toggle.setDisabled(true);
        return;
      }
      toggle.onChange((value) => {
        if (value) this.chosen.add(choice.key);
        else this.chosen.delete(choice.key);
      });
    });
  }

  /**
   * Write the chosen properties into the note's frontmatter, making the block
   * when the note has none.
   */
  private insert(): void {
    const keys = frontmatterKeyChoices()
      .map((choice) => choice.key)
      .filter((key) => this.chosen.has(key));
    if (keys.length === 0) {
      this.close();
      return;
    }

    const snippet = frontmatterSnippetFor(this.plugin.settings, keys);
    const content = this.editor.getValue();

    if (content.startsWith("---")) {
      const end = content.indexOf("\n---", 3);
      if (end !== -1) {
        const line = content.slice(0, end).split("\n").length;
        this.editor.replaceRange(`${snippet}\n`, { line, ch: 0 });
        this.close();
        return;
      }
    }
    this.editor.replaceRange(`---\n${snippet}\n---\n\n`, { line: 0, ch: 0 });
    this.close();
  }
}

/**
 * The property names already in the note's frontmatter.
 *
 * Read off the text rather than the metadata cache: the cache lags an edit by
 * a moment, and the command may well be run right after one.
 */
function existingProperties(content: string): Set<string> {
  const names = new Set<string>();
  if (!content.startsWith("---")) return names;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return names;

  for (const line of content.slice(3, end).split("\n")) {
    // Only top-level keys: an indented line belongs to the value above it.
    const match = /^([A-Za-z0-9_-]+)\s*:/.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
