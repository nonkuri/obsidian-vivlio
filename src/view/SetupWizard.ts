import { Modal, Notice, Setting, TFolder, type App } from "obsidian";
import type VivlioPlugin from "../main";
import type { BookConfig, SectionSlot } from "../config/types";
import { AUTO_CAPABLE_SLOTS, SECTION_SLOTS } from "../config/types";
import { configFromSettings } from "../config/resolve";
import { findPreset, PRESETS } from "../config/presets";
import { configToYaml, keyDescription, keyLabel } from "../config/yaml";
import { BOTEN_MARK_CHOICES } from "../config/defaults";
import { keyChoices, type Choice } from "./keyControl";
import { localFontFamilies } from "../build/fonts";
import { joinPosix } from "../util/paths";
import { t, type StringKey } from "../i18n";

type Step = "preset" | "meta" | "layout" | "sections" | "cover" | "fonts" | "output";

const STEPS: Step[] = [
  "preset",
  "meta",
  "layout",
  "sections",
  "cover",
  "fonts",
  "output",
];

/**
 * The dropdown entry standing for "this book does not decide it".
 *
 * A value the configuration itself could never take, because the wizard has
 * to tell "the writer chose the same thing the vault defaults to" apart from
 * "the writer left it alone" - only the second follows the vault as its
 * defaults change.
 */
const USE_DEFAULT = "__vivlio-default__";

/** The section entry standing for a note the wizard has yet to create. */
const NEW_NOTE = "__vivlio-new-note__";

/**
 * What a row can hold. The keys that need nesting - `sections`, the colophon
 * lines, the embedded fonts - are not asked about as rows, so a row's value is
 * always one of these.
 */
type Scalar = string | number | boolean | null | undefined;

/**
 * Wizard that writes a book configuration YAML (SPEC 5.4).
 *
 * Every key the file may carry is asked about here, because a setting nobody
 * is shown is a setting nobody uses; each one may be left at "use the
 * default", which is what most of them will be. The file it writes carries
 * every key too, but only the chosen ones as YAML - the rest are written as
 * comments, so the file reads as the reference for what else this book could
 * say while the book still follows the plugin as its defaults change.
 */
export class SetupWizard extends Modal {
  private plugin: VivlioPlugin;
  private bookRoot: string;
  private configPath: string;
  private step: Step = "preset";
  private preset = "bunko";
  private values: Partial<BookConfig> = {};
  private defaults: BookConfig;
  /** Slots the writer asked the wizard to start a note for: slot -> path. */
  private newNotes: Partial<Record<SectionSlot, string>> = {};
  private fontFamilies: string[] = [];

  /**
   * @param configPath the YAML file this run reads and writes
   * @param existing what the selected configuration already says, when the
   * wizard was opened on one. Running the wizard again on a book that has been
   * set up is how a writer changes several things at once, and starting it
   * from a preset would have thrown away every answer they gave the first
   * time. The preset drops to `custom`, because the file is now the starting
   * point and no preset describes it.
   */
  constructor(
    app: App,
    plugin: VivlioPlugin,
    bookRoot: string,
    configPath: string,
    existing?: Partial<BookConfig> | null,
  ) {
    super(app);
    this.plugin = plugin;
    this.bookRoot = bookRoot;
    this.configPath = configPath;
    this.defaults = configFromSettings(plugin.settings);
    this.preset = plugin.settings.defaultPreset;
    this.values = { ...findPreset(this.preset)?.values };
    this.values.title = bookRoot.split("/").pop() || app.vault.getName();
    // A book is published on the day it is made, until someone says otherwise.
    this.values.date = today();

    if (existing && Object.keys(existing).length > 0) {
      this.preset = "custom";
      this.values = { ...existing };
    }
  }

  async onOpen(): Promise<void> {
    this.fontFamilies = await localFontFamilies();
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vivlio-wizard");
    this.setTitle(t("wizard.title"));

    const index = STEPS.indexOf(this.step);
    contentEl.createEl("p", {
      cls: "vivlio-wizard-step",
      text: `${index + 1} / ${STEPS.length} — ${t(`wizard.step.${this.step}` as StringKey)}`,
    });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: t(`wizard.step.${this.step}.desc` as StringKey),
    });

    switch (this.step) {
      case "preset":
        this.renderPreset(contentEl);
        break;
      case "meta":
        this.renderMeta(contentEl);
        break;
      case "layout":
        this.renderLayout(contentEl);
        break;
      case "sections":
        this.renderSections(contentEl);
        break;
      case "cover":
        this.renderCover(contentEl);
        break;
      case "fonts":
        this.renderFonts(contentEl);
        break;
      case "output":
        this.renderOutput(contentEl);
        break;
    }

    // The last step is where the wizard stops being a form and becomes a
    // file, so it is where the file has to be named: a writer who is not told
    // the path has nothing to go and look at.
    if (index === STEPS.length - 1) this.renderDestination(contentEl);

    const navigation = new Setting(contentEl);
    if (index > 0) {
      navigation.addButton((button) =>
        button.setButtonText(t("wizard.back")).onClick(() => {
          this.step = STEPS[index - 1];
          this.render();
        }),
      );
    }
    if (index < STEPS.length - 1) {
      navigation.addButton((button) =>
        button
          .setButtonText(t("wizard.next"))
          .setCta()
          .onClick(() => {
            this.step = STEPS[index + 1];
            this.render();
          }),
      );
    } else {
      navigation.addButton((button) =>
        button
          .setButtonText(t("wizard.finish"))
          .setCta()
          .onClick(() => void this.finish()),
      );
    }
  }

  /** Where the wizard is about to write, and how to find it afterwards. */
  private renderDestination(container: HTMLElement): void {
    const box = container.createDiv({ cls: "vivlio-wizard-destination" });
    box.createEl("p", {
      cls: "vivlio-wizard-path",
      text: t("wizard.destination", { path: this.configPath }),
    });
    box.createEl("p", {
      cls: "setting-item-description",
      text: t("wizard.destination.desc"),
    });
  }

  // --- steps ---------------------------------------------------------------

  private renderPreset(container: HTMLElement): void {
    new Setting(container).setName(t("wizard.step.preset")).addDropdown((dropdown) => {
      for (const preset of PRESETS) {
        dropdown.addOption(preset.id, t(preset.labelKey as StringKey));
      }
      dropdown.setValue(this.preset).onChange((value) => {
        this.preset = value;
        // Book information the user already typed is kept.
        const { title, subtitle, series, author, translator, publisher, printer } =
          this.values;
        const { contact, website, date, lang, version, labels, sections } = this.values;
        this.values = {
          ...findPreset(value)?.values,
          title,
          subtitle,
          series,
          author,
          translator,
          publisher,
          printer,
          contact,
          website,
          date,
          version,
          labels,
          ...(sections === undefined ? {} : { sections }),
          ...(lang === undefined ? {} : { lang }),
        };
      });
    });
  }

  private renderMeta(container: HTMLElement): void {
    this.textRow(container, "title");
    this.textRow(container, "subtitle");
    this.textRow(container, "series");
    this.textRow(container, "author");
    this.textRow(container, "translator");
    this.textRow(container, "publisher");
    this.textRow(container, "printer");
    this.textRow(container, "contact");
    this.textRow(container, "website");
    this.textRow(container, "date");
    this.textRow(container, "version");
    this.selectRow(container, "lang");
  }

  private renderLayout(container: HTMLElement): void {
    this.selectRow(
      container,
      "theme",
      // The list is the whole answer to "where does a theme of my own go?",
      // so the row says how a stylesheet gets into it.
      t("settings.theme.desc"),
    );
    this.selectRow(container, "size");
    this.selectRow(container, "writingMode");
    this.numberRow(container, "charsPerLine");
    this.numberRow(container, "linesPerPage");
    this.numberRow(container, "columns");
    this.selectRow(container, "startSide");
    this.textRow(container, "baseFontSize");
    this.textRow(container, "paragraphIndent");
    this.selectRow(container, "paragraphIndentMode");
    this.selectRow(container, "footnote");
    this.selectRow(container, "highlight");
    this.botenMarkRow(container);
    this.boolRow(container, "autoTcy");
    this.selectRow(container, "imageWidthUnit");
  }

  /**
   * Front and back matter (SPEC 5.11).
   *
   * Every slot is one dropdown of the same shape, because the choice really is
   * the same one: leave it to the vault, let the plugin write it, leave it out,
   * or point at a note. The last of those is useless to a writer who has not
   * written the note yet, so the list also offers to start one.
   */
  private renderSections(container: HTMLElement): void {
    const sections = this.values.sections ?? {};
    this.values.sections = sections;

    const notes = this.app.vault
      .getMarkdownFiles()
      .filter((file) => !this.bookRoot || file.path.startsWith(`${this.bookRoot}/`));

    for (const slot of SECTION_SLOTS) {
      const label = t(`section.${slot}` as StringKey);
      const current = sections[slot];

      new Setting(container)
        .setName(label)
        .setDesc(t(`section.${slot}.desc` as StringKey))
        .addDropdown((dropdown) => {
          dropdown.addOption(
            USE_DEFAULT,
            t("wizard.useDefault", {
              value: this.sectionLabel(this.defaults.sections[slot] ?? "off"),
            }),
          );
          if (AUTO_CAPABLE_SLOTS.includes(slot)) {
            dropdown.addOption("auto", t("wizard.section.auto"));
          }
          dropdown.addOption("off", t("wizard.section.off"));
          dropdown.addOption(NEW_NOTE, t("wizard.section.new"));
          for (const note of notes) dropdown.addOption(note.path, note.path);

          dropdown.setValue(current ?? USE_DEFAULT).onChange((value) => {
            if (value === USE_DEFAULT) {
              delete sections[slot];
              delete this.newNotes[slot];
            } else if (value === NEW_NOTE) {
              sections[slot] = NEW_NOTE;
              this.newNotes[slot] = joinPosix(this.bookRoot, `${label}.md`);
            } else {
              sections[slot] = value;
              delete this.newNotes[slot];
            }
            this.render();
          });
        });

      if (current !== NEW_NOTE) continue;
      new Setting(container)
        .setName(t("wizard.section.newPath"))
        .setDesc(t("wizard.section.newPath.desc"))
        .setClass("vivlio-wizard-sub")
        .addText((text) =>
          text
            .setValue(this.newNotes[slot] ?? "")
            .onChange((value) => (this.newNotes[slot] = value)),
        );
    }

    this.selectRow(container, "pageNumbering");
    this.numberRow(container, "tocDepth");
    this.numberRow(container, "startPage");
    this.boolRow(container, "includeToc");
  }

  private renderCover(container: HTMLElement): void {
    // The cover note is one of this book's own: a note from another book in
    // the vault would be typeset into two books at once.
    const notes = this.app.vault
      .getMarkdownFiles()
      .filter((file) => !this.bookRoot || file.path.startsWith(`${this.bookRoot}/`));

    this.selectRow(container, "cover");
    this.selectRow(
      container,
      "coverPage",
      undefined,
      notes.map((note) => ({ value: note.path, label: note.path })),
    );
    this.selectRow(container, "coverFit");
    this.boolRow(container, "coverInPdf");
  }

  /**
   * Font pickers listing what is installed (SPEC 5.10): typing a family name
   * by hand is the most reliable way to get a silent fallback.
   */
  private renderFonts(container: HTMLElement): void {
    const picker = (key: "fontFamily" | "headingFontFamily" | "monospaceFontFamily") => {
      const setting = this.row(container, key);
      if (this.fontFamilies.length > 0) {
        setting.addDropdown((dropdown) => {
          dropdown.addOption("", "—");
          for (const family of this.fontFamilies) dropdown.addOption(family, family);
          dropdown.onChange((value) => {
            if (!value) return;
            const fallback = this.defaults[key].split(",").slice(1).join(",");
            this.values[key] = `${quote(value)},${fallback}`;
            this.render();
          });
        });
      }
      setting.addText((text) =>
        text
          .setPlaceholder(this.defaults[key])
          .setValue(this.values[key] ?? "")
          .onChange((value) => this.set(key, value.trim() || undefined)),
      );
    };

    picker("fontFamily");
    picker("headingFontFamily");
    picker("monospaceFontFamily");

    this.textRow(container, "mboxFontFamily");
    this.textRow(container, "tcyFontFamily");
    this.textRow(container, "fontFeatureSettings");
    this.textRow(container, "rubyFontSize");
  }

  private renderOutput(container: HTMLElement): void {
    this.textRow(container, "output");
    this.boolRow(container, "cropMarks");
    this.textRow(container, "bleed");
  }

  // --- rows ----------------------------------------------------------------

  private get(key: keyof BookConfig): Scalar {
    return (this.values as Record<string, Scalar>)[key];
  }

  private set(key: keyof BookConfig, value: Scalar): void {
    if (value === undefined) delete (this.values as Record<string, Scalar>)[key];
    else (this.values as Record<string, Scalar>)[key] = value;
  }

  private defaultOf(key: keyof BookConfig): Scalar {
    return (this.defaults as unknown as Record<string, Scalar>)[key];
  }

  /** The default as a row can show it: never a blank the writer cannot read. */
  private defaultLabel(key: keyof BookConfig, choices: Choice[] = []): string {
    const value = this.defaultOf(key);
    if (value === "" || value === null || value === undefined) return t("wizard.unset");
    if (typeof value === "boolean") return value ? t("wizard.on") : t("wizard.off");
    const match = choices.find((choice) => choice.value === String(value));
    return match ? match.label : String(value);
  }

  private sectionLabel(value: string): string {
    if (value === "auto") return t("wizard.section.auto");
    if (value === "off" || !value) return t("wizard.section.off");
    return value;
  }

  private row(
    container: HTMLElement,
    key: keyof BookConfig,
    desc?: string,
  ): Setting {
    return new Setting(container).setName(keyLabel(key)).setDesc(desc ?? keyDescription(key));
  }

  private textRow(container: HTMLElement, key: keyof BookConfig): void {
    const current = this.get(key);
    this.row(container, key).addText((text) =>
      text
        .setPlaceholder(t("wizard.defaultIs", { value: this.defaultLabel(key) }))
        .setValue(current === undefined || current === null ? "" : String(current))
        .onChange((value) => this.set(key, value.trim() || undefined)),
    );
  }

  /** A book may follow the vault, pick a traditional mark, or type its own. */
  private botenMarkRow(container: HTMLElement): void {
    const current = this.get("botenMark");
    const effective = current === undefined ? this.defaults.botenMark : String(current);
    const known = BOTEN_MARK_CHOICES.some((choice) => choice.value === effective);
    const custom = "__vivlio-custom-boten-mark__";
    const setting = this.row(container, "botenMark");

    setting.addDropdown((dropdown) => {
      dropdown.addOption(
        USE_DEFAULT,
        t("wizard.useDefault", { value: this.defaultLabel("botenMark") }),
      );
      for (const choice of BOTEN_MARK_CHOICES) {
        dropdown.addOption(
          choice.value,
          `${choice.value} — ${t(choice.labelKey as StringKey)}`,
        );
      }
      dropdown.addOption(custom, t("settings.botenMark.custom"));
      dropdown
        .setValue(current === undefined ? USE_DEFAULT : known ? effective : custom)
        .onChange((value) => {
          if (value === USE_DEFAULT) this.set("botenMark", undefined);
          else if (value !== custom) this.set("botenMark", value);
        });
    });

    setting.addText((input) => {
      input
        .setPlaceholder(t("settings.botenMark.placeholder"))
        .setValue(current === undefined ? "" : String(current))
        .onChange((value) => this.set("botenMark", value || undefined));
      input.inputEl.setAttr("aria-label", t("settings.botenMark.customInput"));
    });
  }

  private numberRow(container: HTMLElement, key: keyof BookConfig): void {
    const current = this.get(key);
    this.row(container, key).addText((text) =>
      text
        .setPlaceholder(t("wizard.defaultIs", { value: this.defaultLabel(key) }))
        .setValue(current === undefined || current === null ? "" : String(current))
        .onChange((value) => {
          const number = Number(value.trim());
          this.set(key, value.trim() && Number.isFinite(number) ? number : undefined);
        }),
    );
  }

  /**
   * A row answered from a list.
   *
   * The list comes from the table the property picker reads, so the two
   * commands offer the same themes and the same paper sizes; `choices` is for
   * the one list that is this wizard's own - the notes of this book.
   */
  private selectRow(
    container: HTMLElement,
    key: keyof BookConfig,
    desc?: string,
    choices?: Choice[],
  ): void {
    const current = this.get(key);
    const options =
      choices ?? keyChoices(this.app, key, current === undefined ? "" : String(current));
    this.row(container, key, desc).addDropdown((dropdown) => {
      dropdown.addOption(
        USE_DEFAULT,
        t("wizard.useDefault", { value: this.defaultLabel(key, options) }),
      );
      for (const choice of options) dropdown.addOption(choice.value, choice.label);
      // A value that came from a preset, or from a file since renamed, is kept
      // in the list rather than silently replaced by whatever it starts with.
      if (
        current !== undefined &&
        current !== "" &&
        !options.some((choice) => choice.value === String(current))
      ) {
        dropdown.addOption(String(current), String(current));
      }
      dropdown
        .setValue(current === undefined || current === "" ? USE_DEFAULT : String(current))
        .onChange((value) => this.set(key, value === USE_DEFAULT ? undefined : value));
    });
  }

  private boolRow(container: HTMLElement, key: keyof BookConfig): void {
    const current = this.get(key);
    this.row(container, key).addDropdown((dropdown) => {
      dropdown
        .addOption(USE_DEFAULT, t("wizard.useDefault", { value: this.defaultLabel(key) }))
        .addOption("true", t("wizard.on"))
        .addOption("false", t("wizard.off"))
        .setValue(current === undefined ? USE_DEFAULT : String(current))
        .onChange((value) =>
          this.set(key, value === USE_DEFAULT ? undefined : value === "true"),
        );
    });
  }

  // --- writing -------------------------------------------------------------

  private async finish(): Promise<void> {
    await this.createSectionNotes();

    const path = this.configPath;
    const yaml = configToYaml(this.values, this.defaults, { complete: true });

    const existing = this.app.vault.getFileByPath(path);
    const file = existing ?? (await this.app.vault.create(path, yaml));
    if (existing) await this.app.vault.modify(existing, yaml);

    new Notice(t("notice.configWritten", { path }));
    this.close();

    // Opening it is the shortest proof that the file is real and where the
    // wizard said it would be. Only when the plugin owns `.yaml`: otherwise
    // Obsidian has no view to open it with.
    if (this.plugin.settings.showPluginFiles) {
      await this.app.workspace.getLeaf("tab").openFile(file);
    }
  }

  /**
   * Start the notes the writer asked for, and point the slots at them.
   *
   * A slot whose note could not be created is left at the vault default rather
   * than pointing at a path that is not there: a dangling `sections` entry is
   * a build warning every time the book is typeset.
   */
  private async createSectionNotes(): Promise<void> {
    const sections = this.values.sections ?? {};
    for (const slot of SECTION_SLOTS) {
      if (sections[slot] !== NEW_NOTE) continue;
      delete sections[slot];

      const raw = (this.newNotes[slot] ?? "").trim();
      if (!raw) continue;
      const path = raw.toLowerCase().endsWith(".md") ? raw : `${raw}.md`;

      try {
        const existing = this.app.vault.getFileByPath(path);
        if (!existing) {
          await this.ensureFolder(path);
          await this.app.vault.create(path, `# ${t(`section.${slot}` as StringKey)}\n\n`);
        }
        sections[slot] = path;
      } catch (error) {
        new Notice(t("notice.noteFailed", { path, message: String(error) }));
      }
    }
  }

  /** Create the folders a path needs, so a note can be written into it. */
  private async ensureFolder(path: string): Promise<void> {
    const folder = path.split("/").slice(0, -1).join("/");
    if (!folder) return;
    if (this.app.vault.getAbstractFileByPath(folder) instanceof TFolder) return;
    await this.app.vault.createFolder(folder).catch(() => undefined);
  }
}

/**
 * Today, by the calendar on this machine.
 *
 * `toISOString()` would answer in UTC, which is yesterday for most of a
 * Japanese morning: a book made at 08:00 in Tokyo would date itself the day
 * before. The date a colophon prints is a local one.
 */
function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function quote(family: string): string {
  return /^[A-Za-z][A-Za-z0-9 -]*$/.test(family) ? family : `"${family}"`;
}
