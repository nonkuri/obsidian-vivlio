import {
  Modal,
  Setting,
  type App,
  type ButtonComponent,
  type Editor,
  type ToggleComponent,
} from "obsidian";
import type VivlioPlugin from "../main";
import {
  frontmatterKeyChoices,
  frontmatterPatch,
  frontmatterValueFor,
  readFrontmatterProperties,
  STANDARD_KEYS,
  writeScalar,
  type FrontmatterEdit,
  type FrontmatterKeyChoice,
  type NoteKey,
  type NoteProperty,
} from "../config/yaml";
import { keyControl } from "./keyControl";
import { t, type StringKey } from "../i18n";

/** What ticking, unticking or typing would do to one property. */
type Operation = "add" | "change" | "remove";

interface Edit {
  choice: FrontmatterKeyChoice;
  operation: Operation;
  value: string;
}

/**
 * Set the `vivlio-*` properties of one note (SPEC 5.4, layer 3).
 *
 * The command used to add one fixed list of seven keys. A note that needed an
 * eighth had nowhere to go but the reference file, and a note that needed two
 * of the seven carried five properties it would never use - and every one of
 * them shows in Obsidian's property panel, on every note, forever. Neither
 * "the minimum" nor "everything" is the right list, because the right list is
 * per note. So the note says what it already has, and the writer ticks the
 * rest.
 *
 * The values are set here too, rather than only in the property panel. The
 * panel shows a property as a name and a box: what `paragraph-indent-mode`
 * may hold, and which of `manuscript` and `brackets` describes this
 * manuscript, is written in `KEY_DOCS` and nowhere the panel can reach. A
 * writer who can add a property but not correct it has to know every key by
 * heart to fix a value they mistyped.
 *
 * So the rows carry the same controls as the setup wizard - the same names,
 * the same lists, the same sentences - and a property the note already has is
 * shown with its value, editable, with unticking it meaning "take it off this
 * note". The two commands differ in what they write, not in what they ask.
 */
export class FrontmatterModal extends Modal {
  private plugin: VivlioPlugin;
  private editor: Editor;
  /** Properties the note carries now: property name -> value as written. */
  private present: Map<string, NoteProperty>;
  /** Keys the note should carry when this is done. */
  private chosen = new Set<NoteKey>();
  /** The value each key would be written with. */
  private values = new Map<NoteKey, string>();
  private toggles = new Map<NoteKey, ToggleComponent>();
  private filter = "";
  private listEl!: HTMLElement;
  private summaryEl!: HTMLElement;
  private changesEl!: HTMLElement;
  private applyButton?: ButtonComponent;

  constructor(app: App, plugin: VivlioPlugin, editor: Editor) {
    super(app);
    this.plugin = plugin;
    this.editor = editor;
    this.present = readFrontmatterProperties(editor.getValue());
    this.reset();
    // A note with nothing of ours on it is the one case with no answer to
    // start from, so it starts from the most common answer instead.
    if (this.chosen.size === 0) this.selectStandard();
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vivlio-frontmatter-modal");
    this.setTitle(t("frontmatter.title"));
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: t("frontmatter.desc"),
    });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: t("frontmatter.desc.pick"),
    });

    new Setting(contentEl)
      .setClass("vivlio-frontmatter-controls")
      .addSearch((search) =>
        search.setPlaceholder(t("frontmatter.filter")).onChange((value) => {
          this.filter = value.trim().toLowerCase();
          this.renderList();
        }),
      )
      .addButton((button) =>
        button.setButtonText(t("frontmatter.standard")).onClick(() => {
          this.selectStandard();
          this.renderList();
          this.updateSummary();
        }),
      )
      .addButton((button) =>
        button.setButtonText(t("frontmatter.reset")).onClick(() => {
          this.reset();
          this.renderList();
          this.updateSummary();
        }),
      );

    this.listEl = contentEl.createDiv({ cls: "vivlio-frontmatter-list" });
    this.renderList();

    const summary = contentEl.createDiv({ cls: "vivlio-frontmatter-summary" });
    this.summaryEl = summary.createEl("p", { cls: "setting-item-description" });
    this.changesEl = summary.createEl("pre", { cls: "vivlio-frontmatter-snippet" });

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText(t("frontmatter.cancel")).onClick(() => this.close()),
      )
      .addButton((button) => {
        this.applyButton = button;
        button
          .setButtonText(t("frontmatter.apply"))
          .setCta()
          .onClick(() => this.apply());
      });

    this.updateSummary();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** Back to what the note says, which is where every run starts. */
  private reset(): void {
    this.chosen.clear();
    this.values.clear();
    for (const choice of frontmatterKeyChoices()) {
      const property = this.present.get(choice.property);
      if (property?.editable) {
        this.chosen.add(choice.key);
        this.values.set(choice.key, property.value);
        continue;
      }
      this.values.set(choice.key, frontmatterValueFor(this.plugin.settings, choice.key));
    }
  }

  /** The answer a note with none of ours on it most often wants (SPEC 5.4). */
  private selectStandard(): void {
    for (const key of STANDARD_KEYS) this.chosen.add(key);
  }

  private renderList(): void {
    // Rebuilding the rows must not throw away where the writer was reading.
    const scroll = this.listEl.scrollTop;
    this.listEl.empty();
    this.toggles.clear();

    const choices = frontmatterKeyChoices().filter((choice) => this.matches(choice));
    if (choices.length === 0) {
      this.listEl.createEl("p", {
        cls: "setting-item-description",
        text: t("frontmatter.noMatch", { filter: this.filter }),
      });
      return;
    }

    let group = "";
    for (const choice of choices) {
      if (choice.group !== group) {
        group = choice.group;
        this.listEl.createEl("h4", { text: choice.groupLabel });
      }
      this.row(this.listEl, choice);
    }
    this.listEl.scrollTop = scroll;
  }

  /**
   * Filtering reads the words too, not just the key.
   *
   * A writer looking for the emphasis mark knows it as 傍点, not as
   * `botenMark`, and the sentence under each row is where that word is.
   */
  private matches(choice: FrontmatterKeyChoice): boolean {
    if (!this.filter) return true;
    const haystack = `${choice.label} ${choice.property} ${choice.description}`;
    return haystack.toLowerCase().includes(this.filter);
  }

  private row(container: HTMLElement, choice: FrontmatterKeyChoice): void {
    const property = this.present.get(choice.property);
    // A property written as a nested block is not one this row can rewrite.
    const locked = property !== undefined && !property.editable;

    const setting = new Setting(container).setName(choice.label);
    setting.nameEl.createSpan({
      cls: "vivlio-frontmatter-property",
      text: choice.property,
    });
    setting.setDesc(this.describe(choice, property, locked));
    if (!locked) this.valueControl(setting, choice);

    setting.addToggle((toggle) => {
      this.toggles.set(choice.key, toggle);
      toggle.setValue(locked || this.chosen.has(choice.key));
      if (locked) {
        toggle.setDisabled(true);
        return;
      }
      toggle.onChange((value) => {
        if (value) this.chosen.add(choice.key);
        else this.chosen.delete(choice.key);
        this.updateSummary();
      });
    });
  }

  /** What the key means, and where the value beside it came from. */
  private describe(
    choice: FrontmatterKeyChoice,
    property: NoteProperty | undefined,
    locked: boolean,
  ): DocumentFragment {
    const fragment = createFragment();
    fragment.createDiv({ text: choice.description });
    fragment.createDiv({
      cls: "vivlio-frontmatter-note",
      text: locked
        ? t("frontmatter.nested")
        : property
          ? t("frontmatter.inNote")
          : t("frontmatter.fromVault"),
    });
    return fragment;
  }

  /**
   * The control that answers this key, as the wizard would ask it.
   *
   * Typing into it ticks the row: a writer who fills a value in has said what
   * they want the note to say, and making them tick a box as well would only
   * be a way of losing the value they just typed.
   */
  private valueControl(setting: Setting, choice: FrontmatterKeyChoice): void {
    const key = choice.key;
    const value = this.values.get(key) ?? "";
    const control = keyControl(this.app, key, value);
    const commit = (next: string) => {
      this.values.set(key, next.trim());
      this.chosen.add(key);
      this.toggles.get(key)?.setValue(true);
      this.updateSummary();
    };

    if (control.kind === "bool") {
      setting.addDropdown((dropdown) =>
        dropdown
          .addOption("true", t("wizard.on"))
          .addOption("false", t("wizard.off"))
          .setValue(value === "true" ? "true" : "false")
          .onChange(commit),
      );
      return;
    }

    if (control.kind === "select") {
      setting.addDropdown((dropdown) => {
        dropdown.addOption("", t("wizard.unset"));
        for (const option of control.choices) dropdown.addOption(option.value, option.label);
        if (value && !control.choices.some((option) => option.value === value)) {
          dropdown.addOption(value, value);
        }
        dropdown.setValue(value).onChange(commit);
      });
      if (!control.custom) return;
    }

    setting.addText((text) =>
      text
        .setPlaceholder(t("wizard.unset"))
        .setValue(value)
        .onChange(commit),
    );
  }

  /**
   * What pressing the button would do, key by key.
   *
   * A property the note already has and nobody touched is not an edit: the
   * command rewrites the lines it was asked to and leaves the rest, including
   * whatever order and comments the note's own frontmatter is in.
   */
  private edits(): Edit[] {
    const edits: Edit[] = [];
    for (const choice of frontmatterKeyChoices()) {
      const property = this.present.get(choice.property);
      if (property && !property.editable) continue;

      const chosen = this.chosen.has(choice.key);
      const value = this.values.get(choice.key) ?? "";
      if (!property && chosen) edits.push({ choice, operation: "add", value });
      else if (property && !chosen) edits.push({ choice, operation: "remove", value: "" });
      else if (property && chosen && property.value !== value) {
        edits.push({ choice, operation: "change", value });
      }
    }
    return edits;
  }

  /**
   * The edits about to be made, in the words of the note they are made to.
   *
   * The wizard names the file it is about to write for the same reason: a
   * command whose result is invisible until afterwards is a command nobody
   * runs twice - and this one can now remove a line as well as add one.
   */
  private updateSummary(): void {
    const edits = this.edits();
    this.summaryEl.setText(
      edits.length > 0
        ? t("frontmatter.summary", { count: edits.length })
        : t("frontmatter.summaryEmpty"),
    );
    // An empty block hides itself in CSS, so nothing has to be toggled here.
    this.changesEl.setText(edits.map((edit) => summaryLine(edit)).join("\n"));
    this.applyButton?.setDisabled(edits.length === 0);
  }

  /** Write the edits into the note's frontmatter, making the block if needed. */
  private apply(): void {
    const edits: FrontmatterEdit[] = this.edits().map((edit) => ({
      property: edit.choice.property,
      value: edit.operation === "remove" ? null : writeScalar(edit.value),
    }));
    if (edits.length === 0) {
      this.close();
      return;
    }

    const patch = frontmatterPatch(this.editor.getValue(), edits);
    if (!patch) {
      this.close();
      return;
    }

    const last = this.editor.lastLine();
    const to =
      patch.toLine <= last
        ? { line: patch.toLine, ch: 0 }
        : { line: last, ch: this.editor.getLine(last).length };
    this.editor.replaceRange(patch.text, { line: patch.fromLine, ch: 0 }, to);
    this.close();
  }
}

/** `add vivlio-theme: novel`, in the interface language. */
function summaryLine(edit: Edit): string {
  const word = t(`frontmatter.op.${edit.operation}` as StringKey);
  if (edit.operation === "remove") return `${word} ${edit.choice.property}`;
  return `${word} ${edit.choice.property}:${edit.value ? ` ${writeScalar(edit.value)}` : ""}`;
}
