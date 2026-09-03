import { Modal, Notice, Setting, TFile, type App } from "obsidian";
import type VivlioPlugin from "../main";
import type { BookConfig, SectionSlot } from "../config/types";
import { AUTO_CAPABLE_SLOTS, SECTION_SLOTS } from "../config/types";
import { configFromSettings } from "../config/resolve";
import { findPreset, PRESETS } from "../config/presets";
import { configToYaml } from "../config/yaml";
import { PAPER_SIZES } from "../config/defaults";
import { localFontFamilies } from "../build/fonts";
import { CONFIG_FILE } from "../build/pipeline";
import { isImagePath, joinPosix } from "../util/paths";
import { t, type StringKey } from "../i18n";

type Step = "preset" | "meta" | "layout" | "sections" | "cover" | "fonts";

const STEPS: Step[] = ["preset", "meta", "layout", "sections", "cover", "fonts"];

/**
 * Wizard that writes a book's `vivlio.yaml` (SPEC 5.4).
 *
 * There are roughly forty settings; asking anyone to hand-write them is how a
 * feature goes unused. The file it writes carries only what differs from the
 * defaults, so the book follows the plugin as its defaults change.
 */
export class SetupWizard extends Modal {
  private plugin: VivlioPlugin;
  private bookRoot: string;
  private step: Step = "preset";
  private preset = "bunko";
  private values: Partial<BookConfig> = {};
  private fontFamilies: string[] = [];

  constructor(app: App, plugin: VivlioPlugin, bookRoot: string) {
    super(app);
    this.plugin = plugin;
    this.bookRoot = bookRoot;
    this.preset = plugin.settings.defaultPreset;
    this.values = { ...findPreset(this.preset)?.values };
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
    contentEl.createEl("h2", { text: t("wizard.title") });

    const index = STEPS.indexOf(this.step);
    contentEl.createEl("p", {
      cls: "vivlio-wizard-step",
      text: `${index + 1} / ${STEPS.length} — ${t(`wizard.step.${this.step}` as StringKey)}`,
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

  private renderPreset(container: HTMLElement): void {
    new Setting(container).setName(t("wizard.step.preset")).addDropdown((dropdown) => {
      for (const preset of PRESETS) {
        dropdown.addOption(preset.id, t(preset.labelKey as StringKey));
      }
      dropdown.setValue(this.preset).onChange((value) => {
        this.preset = value;
        // Book information the user already typed is kept.
        const { title, subtitle, author, publisher, date } = this.values;
        this.values = {
          ...findPreset(value)?.values,
          title,
          subtitle,
          author,
          publisher,
          date,
        };
      });
    });
  }

  private renderMeta(container: HTMLElement): void {
    const folderName = this.bookRoot.split("/").pop() ?? this.app.vault.getName();
    this.text(container, "colophon.title", "title", this.values.title ?? folderName);
    this.text(container, "wizard.step.meta", "subtitle", this.values.subtitle ?? "");
    this.text(container, "colophon.author", "author", this.values.author ?? "");
    this.text(container, "colophon.publisher", "publisher", this.values.publisher ?? "");
    this.text(
      container,
      "colophon.date",
      "date",
      this.values.date ?? new Date().toISOString().slice(0, 10),
    );
  }

  private renderLayout(container: HTMLElement): void {
    const defaults = configFromSettings(this.plugin.settings);

    new Setting(container).setName(t("settings.size")).addDropdown((dropdown) => {
      for (const size of Object.keys(PAPER_SIZES)) dropdown.addOption(size, size);
      dropdown
        .setValue(this.values.size ?? defaults.size)
        .onChange((value) => (this.values.size = value));
    });

    new Setting(container).setName(t("settings.writingMode")).addDropdown((dropdown) => {
      dropdown
        .addOption("vertical-rl", "vertical-rl")
        .addOption("horizontal-tb", "horizontal-tb")
        .setValue(this.values.writingMode ?? defaults.writingMode)
        .onChange((value) => (this.values.writingMode = value as BookConfig["writingMode"]));
    });

    new Setting(container).setName("charsPerLine").addText((text) =>
      text
        .setValue(String(this.values.charsPerLine ?? ""))
        .onChange((value) => (this.values.charsPerLine = value ? Number(value) : null)),
    );
    new Setting(container).setName("linesPerPage").addText((text) =>
      text
        .setValue(String(this.values.linesPerPage ?? ""))
        .onChange((value) => (this.values.linesPerPage = value ? Number(value) : null)),
    );

    new Setting(container).setName(t("settings.footnote")).addDropdown((dropdown) => {
      dropdown
        .addOption("gcpm", "gcpm")
        .addOption("pandoc", "pandoc")
        .addOption("dpub", "dpub")
        .setValue(this.values.footnote ?? defaults.footnote)
        .onChange((value) => (this.values.footnote = value as BookConfig["footnote"]));
    });
  }

  /**
   * Front and back matter. Parts the plugin cannot generate offer a note
   * picker instead of `auto` (SPEC 5.11).
   */
  private renderSections(container: HTMLElement): void {
    const sections: Partial<Record<SectionSlot, string>> = {
      ...this.plugin.settings.sectionDefaults,
      ...this.values.sections,
    };
    this.values.sections = sections;

    const notes = this.app.vault
      .getMarkdownFiles()
      .filter((file) => !this.bookRoot || file.path.startsWith(`${this.bookRoot}/`));

    for (const slot of SECTION_SLOTS) {
      const setting = new Setting(container).setName(t(`section.${slot}` as StringKey));

      if (AUTO_CAPABLE_SLOTS.includes(slot)) {
        setting.addToggle((toggle) =>
          toggle
            .setValue(sections[slot] === "auto")
            .onChange((value) => (sections[slot] = value ? "auto" : "off")),
        );
        continue;
      }

      setting.addDropdown((dropdown) => {
        dropdown.addOption("off", "off");
        for (const note of notes) dropdown.addOption(note.path, note.path);
        dropdown
          .setValue(sections[slot] ?? "off")
          .onChange((value) => (sections[slot] = value));
      });
    }
  }

  private renderCover(container: HTMLElement): void {
    const images = this.app.vault
      .getFiles()
      .filter((file: TFile) => isImagePath(file.path))
      .slice(0, 500);

    new Setting(container).setName(t("wizard.step.cover")).addDropdown((dropdown) => {
      dropdown.addOption("", "—");
      for (const image of images) dropdown.addOption(image.path, image.path);
      dropdown
        .setValue(this.values.cover ?? "")
        .onChange((value) => (this.values.cover = value));
    });

    new Setting(container).setName("coverFit").addDropdown((dropdown) => {
      dropdown
        .addOption("cover", "cover")
        .addOption("contain", "contain")
        .setValue(this.values.coverFit ?? "cover")
        .onChange((value) => (this.values.coverFit = value as BookConfig["coverFit"]));
    });
  }

  /**
   * Font pickers listing what is installed (SPEC 5.10): typing a family name
   * by hand is the most reliable way to get a silent fallback.
   */
  private renderFonts(container: HTMLElement): void {
    const defaults = configFromSettings(this.plugin.settings);

    const picker = (
      label: StringKey,
      key: "fontFamily" | "headingFontFamily" | "monospaceFontFamily",
    ) => {
      const setting = new Setting(container).setName(t(label));
      if (this.fontFamilies.length > 0) {
        setting.addDropdown((dropdown) => {
          dropdown.addOption("", "—");
          for (const family of this.fontFamilies) dropdown.addOption(family, family);
          dropdown.onChange((value) => {
            if (!value) return;
            const fallback = defaults[key].split(",").slice(1).join(",");
            this.values[key] = `${quote(value)},${fallback}`;
          });
        });
      }
      setting.addText((text) =>
        text
          .setPlaceholder(defaults[key])
          .setValue(this.values[key] ?? "")
          .onChange((value) => (this.values[key] = value)),
      );
    };

    picker("settings.fontFamily", "fontFamily");
    picker("settings.headingFontFamily", "headingFontFamily");
    picker("settings.monospaceFontFamily", "monospaceFontFamily");
  }

  private text(
    container: HTMLElement,
    label: StringKey,
    key: keyof BookConfig,
    initial: string,
  ): void {
    (this.values as Record<string, unknown>)[key] = initial;
    new Setting(container).setName(t(label)).addText((text) =>
      text.setValue(initial).onChange((value) => {
        (this.values as Record<string, unknown>)[key] = value;
      }),
    );
  }

  private async finish(): Promise<void> {
    const path = joinPosix(this.bookRoot, CONFIG_FILE);
    const yaml = configToYaml(this.values, configFromSettings(this.plugin.settings));

    const existing = this.app.vault.getFileByPath(path);
    if (existing) await this.app.vault.modify(existing, yaml);
    else await this.app.vault.create(path, yaml);

    new Notice(t("notice.configWritten", { path }));
    this.close();
  }
}

function quote(family: string): string {
  return /^[A-Za-z][A-Za-z0-9 -]*$/.test(family) ? family : `"${family}"`;
}
