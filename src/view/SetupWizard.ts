import { Modal, Notice, Setting, TFile, TFolder, type App } from "obsidian";
import type VivlioPlugin from "../main";
import type { BookConfig, SectionSlot } from "../config/types";
import { AUTO_CAPABLE_SLOTS, INDENT_MODES, SECTION_SLOTS } from "../config/types";
import { configFromSettings } from "../config/resolve";
import { findPreset, PRESETS } from "../config/presets";
import { configToYaml, keyDescription } from "../config/yaml";
import { PAPER_SIZE_CHOICES } from "../config/defaults";
import { themeChoices } from "../build/theme";
import { localFontFamilies } from "../build/fonts";
import { CONFIG_FILE } from "../build/pipeline";
import { isImagePath, joinPosix } from "../util/paths";
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

interface Choice {
  value: string;
  label: string;
}

/**
 * What a row can hold. The keys that need nesting - `sections`, the colophon
 * lines, the embedded fonts - are not asked about as rows, so a row's value is
 * always one of these.
 */
type Scalar = string | number | boolean | null | undefined;

/**
 * Wizard that writes a book's `vivlio.yaml` (SPEC 5.4).
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
  private step: Step = "preset";
  private preset = "bunko";
  private values: Partial<BookConfig> = {};
  private defaults: BookConfig;
  /** Slots the writer asked the wizard to start a note for: slot -> path. */
  private newNotes: Partial<Record<SectionSlot, string>> = {};
  private fontFamilies: string[] = [];

  /**
   * @param existing what the book's `vivlio.yaml` already says, when the
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
    existing?: Partial<BookConfig> | null,
  ) {
    super(app);
    this.plugin = plugin;
    this.bookRoot = bookRoot;
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
    const path = joinPosix(this.bookRoot, CONFIG_FILE);
    const box = container.createDiv({ cls: "vivlio-wizard-destination" });
    box.createEl("p", {
      cls: "vivlio-wizard-path",
      text: t("wizard.destination", { path }),
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
        const { contact, website, date, lang, version, sections } = this.values;
        this.values = {
          ...findPreset(value)?.values,
          sections,
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
          lang,
          version,
        };
      });
    });
  }

  private renderMeta(container: HTMLElement): void {
    this.textRow(container, "colophon.title", "title");
    this.textRow(container, "colophon.subtitle", "subtitle");
    this.textRow(container, "colophon.series", "series");
    this.textRow(container, "colophon.author", "author");
    this.textRow(container, "colophon.translator", "translator");
    this.textRow(container, "colophon.publisher", "publisher");
    this.textRow(container, "colophon.printer", "printer");
    this.textRow(container, "colophon.contact", "contact");
    this.textRow(container, "colophon.website", "website");
    this.textRow(container, "colophon.date", "date");
    this.textRow(container, "colophon.version", "version");
    this.selectRow(container, "settings.lang", "lang", [
      { value: "ja", label: "ja — 日本語" },
      { value: "en", label: "en — English" },
    ]);
  }

  private renderLayout(container: HTMLElement): void {
    this.selectRow(
      container,
      "book.theme",
      "theme",
      themeChoices(this.app, this.values.theme ?? "").map((choice) => ({
        value: choice.value,
        label: choice.label,
      })),
      // The list is the whole answer to "where does a theme of my own go?",
      // so the row says how a stylesheet gets into it.
      t("settings.theme.desc"),
    );
    this.selectRow(
      container,
      "book.size",
      "size",
      PAPER_SIZE_CHOICES.map((size) => ({
        value: size.value,
        label: t(size.labelKey as StringKey),
      })),
    );
    this.selectRow(container, "book.writingMode", "writingMode", [
      { value: "vertical-rl", label: t("settings.writingMode.vertical-rl") },
      { value: "horizontal-tb", label: t("settings.writingMode.horizontal-tb") },
    ]);
    this.numberRow(container, "settings.charsPerLine", "charsPerLine");
    this.numberRow(container, "settings.linesPerPage", "linesPerPage");
    this.numberRow(container, "settings.columns", "columns");
    this.textRow(container, "settings.baseFontSize", "baseFontSize");
    this.textRow(container, "settings.paragraphIndent", "paragraphIndent");
    this.selectRow(
      container,
      "settings.paragraphIndentMode",
      "paragraphIndentMode",
      INDENT_MODES.map((mode) => ({
        value: mode,
        label: t(`settings.paragraphIndentMode.${mode}` as StringKey),
      })),
    );
    this.selectRow(container, "book.footnote", "footnote", [
      { value: "gcpm", label: t("settings.footnote.gcpm") },
      { value: "pandoc", label: t("settings.footnote.pandoc") },
      { value: "dpub", label: t("settings.footnote.dpub") },
    ]);
    this.selectRow(container, "settings.highlight", "highlight", [
      { value: "boten", label: t("settings.highlight.boten") },
      { value: "strong", label: t("settings.highlight.strong") },
      { value: "mark", label: t("settings.highlight.mark") },
      { value: "off", label: t("settings.highlight.off") },
    ]);
    this.boolRow(container, "settings.autoTcy", "autoTcy");
    this.selectRow(container, "settings.imageWidthUnit", "imageWidthUnit", [
      { value: "px", label: t("settings.imageWidthUnit.px") },
      { value: "percent", label: t("settings.imageWidthUnit.percent") },
      { value: "mm", label: t("settings.imageWidthUnit.mm") },
    ]);
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

    this.selectRow(
      container,
      "settings.pageNumbering",
      "pageNumbering",
      (["roman-then-arabic", "continuous", "none"] as const).map((value) => ({
        value,
        label: t(`settings.pageNumbering.${value}` as StringKey),
      })),
    );
    this.numberRow(container, "settings.tocDepth", "tocDepth");
    this.numberRow(container, "settings.startPage", "startPage");
    this.boolRow(container, "settings.includeToc", "includeToc");
  }

  private renderCover(container: HTMLElement): void {
    const images = this.app.vault
      .getFiles()
      .filter((file: TFile) => isImagePath(file.path))
      .slice(0, 500);
    const notes = this.app.vault
      .getMarkdownFiles()
      .filter((file) => !this.bookRoot || file.path.startsWith(`${this.bookRoot}/`));

    this.selectRow(
      container,
      "settings.cover",
      "cover",
      images.map((image) => ({ value: image.path, label: image.path })),
    );
    this.selectRow(
      container,
      "settings.coverPage",
      "coverPage",
      notes.map((note) => ({ value: note.path, label: note.path })),
    );
    this.selectRow(container, "settings.coverFit", "coverFit", [
      { value: "cover", label: t("settings.coverFit.cover") },
      { value: "contain", label: t("settings.coverFit.contain") },
    ]);
    this.boolRow(container, "settings.coverInPdf", "coverInPdf");
  }

  /**
   * Font pickers listing what is installed (SPEC 5.10): typing a family name
   * by hand is the most reliable way to get a silent fallback.
   */
  private renderFonts(container: HTMLElement): void {
    const picker = (
      label: StringKey,
      key: "fontFamily" | "headingFontFamily" | "monospaceFontFamily",
    ) => {
      const setting = new Setting(container)
        .setName(t(label))
        .setDesc(keyDescription(key));
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

    picker("settings.fontFamily", "fontFamily");
    picker("settings.headingFontFamily", "headingFontFamily");
    picker("settings.monospaceFontFamily", "monospaceFontFamily");

    this.textRow(container, "settings.mboxFontFamily", "mboxFontFamily");
    this.textRow(container, "settings.tcyFontFamily", "tcyFontFamily");
    this.textRow(container, "settings.fontFeatureSettings", "fontFeatureSettings");
    this.textRow(container, "settings.rubyFontSize", "rubyFontSize");
  }

  private renderOutput(container: HTMLElement): void {
    this.textRow(container, "settings.output", "output");
    this.boolRow(container, "settings.cropMarks", "cropMarks");
    this.textRow(container, "settings.bleed", "bleed");
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
    label: StringKey,
    key: keyof BookConfig,
    desc?: string,
  ): Setting {
    return new Setting(container).setName(t(label)).setDesc(desc ?? keyDescription(key));
  }

  private textRow(container: HTMLElement, label: StringKey, key: keyof BookConfig): void {
    const current = this.get(key);
    this.row(container, label, key).addText((text) =>
      text
        .setPlaceholder(t("wizard.defaultIs", { value: this.defaultLabel(key) }))
        .setValue(current === undefined || current === null ? "" : String(current))
        .onChange((value) => this.set(key, value.trim() || undefined)),
    );
  }

  private numberRow(
    container: HTMLElement,
    label: StringKey,
    key: keyof BookConfig,
  ): void {
    const current = this.get(key);
    this.row(container, label, key).addText((text) =>
      text
        .setPlaceholder(t("wizard.defaultIs", { value: this.defaultLabel(key) }))
        .setValue(current === undefined || current === null ? "" : String(current))
        .onChange((value) => {
          const number = Number(value.trim());
          this.set(key, value.trim() && Number.isFinite(number) ? number : undefined);
        }),
    );
  }

  private selectRow(
    container: HTMLElement,
    label: StringKey,
    key: keyof BookConfig,
    choices: Choice[],
    desc?: string,
  ): void {
    const current = this.get(key);
    this.row(container, label, key, desc).addDropdown((dropdown) => {
      dropdown.addOption(
        USE_DEFAULT,
        t("wizard.useDefault", { value: this.defaultLabel(key, choices) }),
      );
      for (const choice of choices) dropdown.addOption(choice.value, choice.label);
      // A value that came from a preset, or from a file since renamed, is kept
      // in the list rather than silently replaced by whatever it starts with.
      if (
        current !== undefined &&
        current !== "" &&
        !choices.some((choice) => choice.value === String(current))
      ) {
        dropdown.addOption(String(current), String(current));
      }
      dropdown
        .setValue(current === undefined || current === "" ? USE_DEFAULT : String(current))
        .onChange((value) => this.set(key, value === USE_DEFAULT ? undefined : value));
    });
  }

  private boolRow(container: HTMLElement, label: StringKey, key: keyof BookConfig): void {
    const current = this.get(key);
    this.row(container, label, key).addDropdown((dropdown) => {
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

    const path = joinPosix(this.bookRoot, CONFIG_FILE);
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
