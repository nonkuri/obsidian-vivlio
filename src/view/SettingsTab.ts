import { PluginSettingTab, Setting, type App } from "obsidian";
import type VivlioPlugin from "../main";
import { PRESETS } from "../config/presets";
import { PAPER_SIZES } from "../config/defaults";
import { BUNDLED_THEMES } from "../vendor/assets";
import { localFontFamilies } from "../build/fonts";
import { SECTION_SLOTS, AUTO_CAPABLE_SLOTS, type SyntaxToggles } from "../config/types";
import { t, type StringKey } from "../i18n";

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
    container.createEl("h3", { text: t("settings.heading.general") });

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
    container.createEl("h3", { text: t("settings.heading.typesetting") });

    new Setting(container).setName(t("settings.theme")).addDropdown((dropdown) => {
      for (const theme of Object.keys(BUNDLED_THEMES)) dropdown.addOption(theme, theme);
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
          .addOption("gcpm", "gcpm")
          .addOption("pandoc", "pandoc")
          .addOption("dpub", "dpub")
          .setValue(this.plugin.settings.footnote)
          .onChange(async (value) => {
            this.plugin.settings.footnote = value as "gcpm" | "pandoc" | "dpub";
            await this.save();
          });
      });

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
    container.createEl("h3", { text: t("settings.heading.fonts") });

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
    container.createEl("h3", { text: t("settings.heading.output") });

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
  }

  private syntax(container: HTMLElement): void {
    container.createEl("h3", { text: t("settings.heading.syntax") });

    new Setting(container).setName(t("settings.highlight")).addDropdown((dropdown) => {
      dropdown
        .addOption("boten", "boten")
        .addOption("strong", "strong")
        .addOption("mark", "mark")
        .addOption("off", "off")
        .setValue(this.plugin.settings.highlight)
        .onChange(async (value) => {
          this.plugin.settings.highlight = value as "boten" | "strong" | "mark" | "off";
          await this.save();
        });
    });

    for (const key of SYNTAX_KEYS) {
      new Setting(container).setName(t(`syntax.${key}` as StringKey)).addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syntax[key]).onChange(async (value) => {
          this.plugin.settings.syntax[key] = value;
          await this.save();
        }),
      );
    }
  }

  private structure(container: HTMLElement): void {
    container.createEl("h3", { text: t("settings.heading.structure") });

    for (const slot of SECTION_SLOTS) {
      const setting = new Setting(container).setName(t(`section.${slot}` as StringKey));
      if (!AUTO_CAPABLE_SLOTS.includes(slot)) {
        setting.setDesc("vivlio.yaml");
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

    new Setting(container).setName(t("settings.pageNumbering")).addDropdown((dropdown) => {
      dropdown
        .addOption("roman-then-arabic", "roman-then-arabic")
        .addOption("continuous", "continuous")
        .addOption("none", "none")
        .setValue(this.plugin.settings.pageNumbering)
        .onChange(async (value) => {
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
    container.createEl("h3", { text: t("settings.heading.preview") });

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

    new Setting(container).setName(t("settings.renderAllPages")).addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.renderAllPages).onChange(async (value) => {
        this.plugin.settings.renderAllPages = value;
        await this.save();
      }),
    );
  }

  private pdf(container: HTMLElement): void {
    container.createEl("h3", { text: t("settings.heading.pdf") });

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

    new Setting(container)
      .setName(t("settings.allowDynamicScripts"))
      .setDesc(t("settings.allowDynamicScripts.desc"))
      .addToggle((control) =>
        control.setValue(this.plugin.settings.allowDynamicScripts).onChange(async (value) => {
          this.plugin.settings.allowDynamicScripts = value;
          await this.save();
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
    container.createEl("h3", { text: t("settings.heading.advanced") });

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

    new Setting(container)
      .setName(t("settings.cliPath"))
      .setDesc(t("settings.cliPath.desc"))
      .addText((text) =>
        text.setValue(this.plugin.settings.cliPath).onChange(async (value) => {
          this.plugin.settings.cliPath = value;
          await this.save();
        }),
      );
  }
}

function quote(family: string): string {
  return /^[A-Za-z][A-Za-z0-9 -]*$/.test(family) ? family : `"${family}"`;
}
