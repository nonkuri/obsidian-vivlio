import { PluginSettingTab, Setting, type App } from "obsidian";
import type VivlioPlugin from "../main";
import { PRESETS } from "../config/presets";
import { PAPER_SIZES } from "../config/defaults";
import { themeChoices } from "../build/theme";
import { localFontFamilies } from "../build/fonts";
import {
  SECTION_SLOTS,
  AUTO_CAPABLE_SLOTS,
  INDENT_MODES,
  type IndentMode,
  type SyntaxToggles,
} from "../config/types";
import { en } from "../i18n/en";
import { t, type StringKey } from "../i18n";

/** Lets a row ask whether a string exists before it shows one. */
const EN_STRINGS: Record<string, unknown> = en;

/**
 * The preprocessing stages offered under "Syntax", in reading order.
 *
 * `stripLeadingSpace` is deliberately not here: it only means anything beside
 * the indent settings it exists to serve, so the typesetting section shows it.
 */
const SYNTAX_KEYS: (keyof SyntaxToggles)[] = [
  "embed",
  "dynamic",
  "boten",
  "aozoraRuby",
  "tcy",
  "autoTcy",
  "highlight",
  "imageEmbed",
  "wikilink",
  "callout",
  "taskList",
  "keepTags",
  "pageBreak",
  "blankLines",
  "stripComments",
  "stripBlockIds",
];

/** The vault-wide defaults: layer 1 of the three (SPEC 5.4, 5.5). */
export class VivlioSettingTab extends PluginSettingTab {
  private plugin: VivlioPlugin;
  private fontFamilies: string[] = [];

  constructor(app: App, plugin: VivlioPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    void this.loadFonts();

    this.general(containerEl);
    this.typesetting(containerEl);
    this.fonts(containerEl);
    this.output(containerEl);
    this.syntax(containerEl);
    this.structure(containerEl);
    this.preview(containerEl);
    this.pdf(containerEl);
    this.advanced(containerEl);
  }

  private async loadFonts(): Promise<void> {
    if (this.fontFamilies.length > 0) return;
    this.fontFamilies = await localFontFamilies();
    if (this.fontFamilies.length > 0) this.display();
  }

  private async save(): Promise<void> {
    await this.plugin.saveSettings();
  }

  private general(container: HTMLElement): void {
    new Setting(container).setName(t("settings.heading.general")).setHeading();

    new Setting(container)
      .setName(t("settings.defaultPreset"))
      .setDesc(t("settings.defaultPreset.desc"))
      .addDropdown((dropdown) => {
        for (const preset of PRESETS) {
          dropdown.addOption(preset.id, t(preset.labelKey as StringKey));
        }
        dropdown.setValue(this.plugin.settings.defaultPreset).onChange(async (value) => {
          this.plugin.settings.defaultPreset = value;
          await this.save();
        });
      });

    new Setting(container).setName(t("settings.language")).addDropdown((dropdown) => {
      dropdown
        .addOption("auto", "Obsidian")
        .addOption("ja", "日本語")
        .addOption("en", "English")
        .setValue(this.plugin.settings.language)
        .onChange(async (value) => {
          this.plugin.settings.language = value as "auto" | "ja" | "en";
          await this.save();
          this.display();
        });
    });
  }

  private typesetting(container: HTMLElement): void {
    new Setting(container).setName(t("settings.heading.typesetting")).setHeading();

    new Setting(container)
      .setName(t("settings.theme"))
      .setDesc(t("settings.theme.desc"))
      .addDropdown((dropdown) => {
        for (const choice of themeChoices(this.app, this.plugin.settings.theme)) {
          dropdown.addOption(choice.value, choice.label);
        }
        dropdown.setValue(this.plugin.settings.theme).onChange(async (value) => {
          this.plugin.settings.theme = value;
          await this.save();
        });
      });

    new Setting(container).setName(t("settings.size")).addDropdown((dropdown) => {
      for (const size of Object.keys(PAPER_SIZES)) dropdown.addOption(size, size);
      dropdown.setValue(this.plugin.settings.size).onChange(async (value) => {
        this.plugin.settings.size = value;
        await this.save();
      });
    });

    new Setting(container).setName(t("settings.writingMode")).addDropdown((dropdown) => {
      dropdown
        .addOption("vertical-rl", "vertical-rl")
        .addOption("horizontal-tb", "horizontal-tb")
        .setValue(this.plugin.settings.writingMode)
        .onChange(async (value) => {
          this.plugin.settings.writingMode = value as "vertical-rl" | "horizontal-tb";
          await this.save();
        });
    });

    new Setting(container)
      .setName(t("settings.footnote"))
      .setDesc(t("settings.footnote.desc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("gcpm", t("settings.footnote.gcpm"))
          .addOption("pandoc", t("settings.footnote.pandoc"))
          .addOption("dpub", t("settings.footnote.dpub"))
          .setValue(this.plugin.settings.footnote)
          .onChange(async (value) => {
            this.plugin.settings.footnote = value as "gcpm" | "pandoc" | "dpub";
            await this.save();
          });
      });

    new Setting(container)
      .setName(t("settings.paragraphIndent"))
      .setDesc(t("settings.paragraphIndent.desc"))
      .addText((text) =>
        text
          .setPlaceholder(t("settings.paragraphIndent.placeholder"))
          .setValue(this.plugin.settings.paragraphIndent)
          .onChange(async (value) => {
            this.plugin.settings.paragraphIndent = value.trim();
            await this.save();
          }),
      );

    new Setting(container)
      .setName(t("settings.paragraphIndentMode"))
      .setDesc(t("settings.paragraphIndentMode.desc"))
      .addDropdown((dropdown) => {
        for (const mode of INDENT_MODES) {
          dropdown.addOption(mode, t(`settings.paragraphIndentMode.${mode}` as StringKey));
        }
        dropdown
          .setValue(this.plugin.settings.paragraphIndentMode)
          .onChange(async (value) => {
            this.plugin.settings.paragraphIndentMode = value as IndentMode;
            await this.save();
          });
      });

    // The space the manuscript indents with and the indent the stylesheet
    // draws are two halves of one decision, so they are settled in one place.
    this.syntaxToggle(container, "stripLeadingSpace");

    new Setting(container)
      .setName(t("settings.extraCss"))
      .setDesc(t("settings.extraCss.desc"))
      .addText((text) =>
        text.setValue(this.plugin.settings.extraCssPath).onChange(async (value) => {
          this.plugin.settings.extraCssPath = value;
          await this.save();
        }),
      );
  }

  private fonts(container: HTMLElement): void {
    new Setting(container).setName(t("settings.heading.fonts")).setHeading();

    const picker = (
      label: StringKey,
      key: "fontFamily" | "headingFontFamily" | "monospaceFontFamily",
    ) => {
      const setting = new Setting(container).setName(t(label));
      if (this.fontFamilies.length > 0) {
        setting.addDropdown((dropdown) => {
          dropdown.addOption("", "—");
          for (const family of this.fontFamilies) dropdown.addOption(family, family);
          dropdown.onChange(async (value) => {
            if (!value) return;
            const rest = this.plugin.settings[key].split(",").slice(1).join(",");
            this.plugin.settings[key] = `${quote(value)},${rest}`;
            await this.save();
            this.display();
          });
        });
      }
      setting.addTextArea((text) => {
        text.setValue(this.plugin.settings[key]).onChange(async (value) => {
          this.plugin.settings[key] = value;
          await this.save();
        });
        text.inputEl.rows = 2;
        text.inputEl.addClass("vivlio-font-stack");
      });
    };

    picker("settings.fontFamily", "fontFamily");
    picker("settings.headingFontFamily", "headingFontFamily");
    picker("settings.monospaceFontFamily", "monospaceFontFamily");

    new Setting(container)
      .setName(t("settings.fontFolder"))
      .setDesc(t("settings.fontFolder.desc"))
      .addText((text) =>
        text.setValue(this.plugin.settings.fontFolder).onChange(async (value) => {
          this.plugin.settings.fontFolder = value;
          await this.save();
        }),
      );

    new Setting(container).setName(t("settings.warnMissingFonts")).addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.warnMissingFonts).onChange(async (value) => {
        this.plugin.settings.warnMissingFonts = value;
        await this.save();
      }),
    );

    new Setting(container)
      .setName(t("settings.embedFontsInEpub"))
      .setDesc(t("settings.embedFontsInEpub.desc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.embedFontsInEpub).onChange(async (value) => {
          this.plugin.settings.embedFontsInEpub = value;
          await this.save();
        }),
      );
  }

  private output(container: HTMLElement): void {
    new Setting(container).setName(t("settings.heading.output")).setHeading();

    new Setting(container)
      .setName(t("settings.outputFolder"))
      .setDesc(t("settings.outputFolder.desc"))
      .addText((text) =>
        text.setValue(this.plugin.settings.outputFolder).onChange(async (value) => {
          this.plugin.settings.outputFolder = value;
          await this.save();
        }),
      );

    new Setting(container).setName(t("settings.openAfterExport")).addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.openAfterExport).onChange(async (value) => {
        this.plugin.settings.openAfterExport = value;
        await this.save();
      }),
    );

    new Setting(container)
      .setName(t("settings.showPluginFiles"))
      .setDesc(t("settings.showPluginFiles.desc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showPluginFiles).onChange(async (value) => {
          this.plugin.settings.showPluginFiles = value;
          await this.save();
        }),
      );
  }

  /**
   * One preprocessing stage, with its explanation where it has one.
   *
   * Shared with the typesetting section, which shows `stripLeadingSpace`.
   */
  private syntaxToggle(container: HTMLElement, key: keyof SyntaxToggles): void {
    const setting = new Setting(container).setName(t(`syntax.${key}` as StringKey));
    const desc = `syntax.${key}.desc` as StringKey;
    if (desc in EN_STRINGS) setting.setDesc(t(desc));
    setting.addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.syntax[key]).onChange(async (value) => {
        this.plugin.settings.syntax[key] = value;
        await this.save();
      }),
    );
  }

  private syntax(container: HTMLElement): void {
    new Setting(container).setName(t("settings.heading.syntax")).setHeading();

    // Two settings are shown against the switch they qualify rather than in a
    // section of their own: what a highlight becomes says nothing without the
    // switch that converts it, and running scripts is the sharp edge of the
    // same switch that draws dataview and mermaid.
    for (const key of SYNTAX_KEYS) {
      this.syntaxToggle(container, key);

      if (key === "dynamic") {
        new Setting(container)
          .setName(t("settings.allowDynamicScripts"))
          .setDesc(t("settings.allowDynamicScripts.desc"))
          .addToggle((control) =>
            control
              .setValue(this.plugin.settings.allowDynamicScripts)
              .onChange(async (value) => {
                this.plugin.settings.allowDynamicScripts = value;
                await this.save();
              }),
          );
      }

      if (key === "highlight") {
        new Setting(container)
          .setName(t("settings.highlight"))
          .setDesc(t("settings.highlight.desc"))
          .addDropdown((dropdown) => {
            for (const mode of ["boten", "strong", "mark", "off"] as const) {
              dropdown.addOption(mode, t(`settings.highlight.${mode}` as StringKey));
            }
            dropdown.setValue(this.plugin.settings.highlight).onChange(async (value) => {
              this.plugin.settings.highlight = value as
                | "boten"
                | "strong"
                | "mark"
                | "off";
              await this.save();
            });
          });
      }
    }
  }

  private structure(container: HTMLElement): void {
    new Setting(container).setName(t("settings.heading.structure")).setHeading();
    // Said once, above the rows: seven parts point at vivlio.yaml, and
    // repeating what that file is on each of them would drown the section.
    container.createEl("p", {
      text: t("settings.heading.structure.desc"),
      cls: "setting-item-description",
    });

    for (const slot of SECTION_SLOTS) {
      const setting = new Setting(container).setName(t(`section.${slot}` as StringKey));
      // A part the plugin cannot write itself has nothing to switch on: it is
      // out of the book until a vivlio.yaml names the note that fills it.
      if (!AUTO_CAPABLE_SLOTS.includes(slot)) {
        setting.setDesc(t("settings.section.yamlOnly"));
        continue;
      }
      setting.addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.sectionDefaults[slot] === "auto")
          .onChange(async (value) => {
            this.plugin.settings.sectionDefaults[slot] = value ? "auto" : "off";
            await this.save();
          }),
      );
    }

    new Setting(container)
      .setName(t("settings.pageNumbering"))
      .setDesc(t("settings.pageNumbering.desc"))
      .addDropdown((dropdown) => {
        for (const mode of ["roman-then-arabic", "continuous", "none"] as const) {
          dropdown.addOption(mode, t(`settings.pageNumbering.${mode}` as StringKey));
        }
        dropdown.setValue(this.plugin.settings.pageNumbering).onChange(async (value) => {
          this.plugin.settings.pageNumbering = value as
            | "roman-then-arabic"
            | "continuous"
            | "none";
          await this.save();
        });
      });

    new Setting(container).setName(t("settings.tocDepth")).addSlider((slider) =>
      slider
        .setLimits(1, 6, 1)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.tocDepth)
        .onChange(async (value) => {
          this.plugin.settings.tocDepth = value;
          await this.save();
        }),
    );
  }

  private preview(container: HTMLElement): void {
    new Setting(container).setName(t("settings.heading.preview")).setHeading();

    new Setting(container).setName(t("settings.autoRefresh")).addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.autoRefresh).onChange(async (value) => {
        this.plugin.settings.autoRefresh = value;
        await this.save();
      }),
    );

    new Setting(container).setName(t("settings.debounceMs")).addText((text) =>
      text.setValue(String(this.plugin.settings.debounceMs)).onChange(async (value) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) {
          this.plugin.settings.debounceMs = parsed;
          await this.save();
        }
      }),
    );

    new Setting(container)
      .setName(t("settings.renderAllPages"))
      .setDesc(t("settings.renderAllPages.desc"))
      .addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.renderAllPages).onChange(async (value) => {
        this.plugin.settings.renderAllPages = value;
        await this.save();
      }),
    );
  }

  private pdf(container: HTMLElement): void {
    new Setting(container).setName(t("settings.heading.pdf")).setHeading();

    const toggle = (label: StringKey, key: "taggedPdf" | "pdfOutline" | "pdfMetadata" | "coverInPdf" | "downloadRemoteImages" | "allowOutsideVaultPaths") => {
      new Setting(container).setName(t(label)).addToggle((control) =>
        control.setValue(this.plugin.settings[key]).onChange(async (value) => {
          this.plugin.settings[key] = value;
          await this.save();
        }),
      );
    };

    toggle("settings.taggedPdf", "taggedPdf");
    toggle("settings.pdfOutline", "pdfOutline");
    toggle("settings.pdfMetadata", "pdfMetadata");
    toggle("settings.coverInPdf", "coverInPdf");
    toggle("settings.downloadRemoteImages", "downloadRemoteImages");
    toggle("settings.allowOutsideVaultPaths", "allowOutsideVaultPaths");

    new Setting(container)
      .setName(t("settings.dpiWarnThreshold"))
      .setDesc(t("settings.dpiWarnThreshold.desc"))
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.dpiWarnThreshold))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed >= 0) {
              this.plugin.settings.dpiWarnThreshold = parsed;
              await this.save();
            }
          }),
      );

    new Setting(container).setName(t("settings.printTimeout")).addText((text) =>
      text.setValue(String(this.plugin.settings.printTimeoutMs)).onChange(async (value) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
          this.plugin.settings.printTimeoutMs = parsed;
          await this.save();
        }
      }),
    );
  }

  private advanced(container: HTMLElement): void {
    new Setting(container).setName(t("settings.heading.advanced")).setHeading();

    new Setting(container)
      .setName(t("settings.fixedPort"))
      .setDesc(t("settings.fixedPort.desc"))
      .addText((text) =>
        text.setValue(String(this.plugin.settings.fixedPort)).onChange(async (value) => {
          const parsed = Number(value);
          if (Number.isFinite(parsed) && parsed >= 0 && parsed < 65536) {
            this.plugin.settings.fixedPort = parsed;
            await this.save();
          }
        }),
      );

    new Setting(container).setName(t("settings.logLevel")).addDropdown((dropdown) => {
      dropdown
        .addOption("silent", "silent")
        .addOption("error", "error")
        .addOption("info", "info")
        .addOption("debug", "debug")
        .setValue(this.plugin.settings.logLevel)
        .onChange(async (value) => {
          this.plugin.settings.logLevel = value as "silent" | "error" | "info" | "debug";
          await this.save();
        });
    });
  }
}

function quote(family: string): string {
  return /^[A-Za-z][A-Za-z0-9 -]*$/.test(family) ? family : `"${family}"`;
}
