import { dump as dumpYaml } from "js-yaml";
import { DEFAULT_SETTINGS } from "./defaults";
import { camelToKebab, configFromSettings } from "./resolve";
import { SECTION_SLOTS, type BookConfig, type VivlioSettings } from "./types";
import { detectLocale } from "../i18n";

type Locale = "ja" | "en";

interface KeyDoc {
  ja: string;
  en: string;
  /** Keys that need nesting are only valid in vivlio.yaml (SPEC 5.4). */
  yamlOnly?: boolean;
  group: string;
}

/**
 * Documentation for every configuration key.
 *
 * `vivlio.yaml` can carry comments, which makes a generated file the reference
 * itself - nobody has to go looking for documentation (SPEC 5.4).
 */
const KEY_DOCS: Partial<Record<keyof BookConfig, KeyDoc>> = {
  title: { group: "book", ja: "書名", en: "Book title" },
  subtitle: { group: "book", ja: "副題", en: "Subtitle" },
  author: { group: "book", ja: "著者", en: "Author" },
  publisher: { group: "book", ja: "発行者", en: "Publisher" },
  date: { group: "book", ja: "発行日", en: "Publication date" },
  lang: { group: "book", ja: "言語", en: "Language" },
  version: { group: "book", ja: "版", en: "Edition" },

  theme: {
    group: "layout",
    ja: "bunko | techbook | academic | base | Vault 内の css パス",
    en: "bunko | techbook | academic | base | a CSS path inside the vault",
  },
  writingMode: {
    group: "layout",
    ja: "vertical-rl（縦組み）| horizontal-tb（横組み）",
    en: "vertical-rl | horizontal-tb",
  },
  size: {
    group: "layout",
    ja: "A4 | A5 | B5 | JIS-B6 | 文庫 | 新書 | \"128mm 188mm\"",
    en: "A4 | A5 | B5 | JIS-B6 | 文庫 | 新書 | \"128mm 188mm\"",
  },
  charsPerLine: { group: "layout", ja: "1 行の字数", en: "Characters per line" },
  linesPerPage: { group: "layout", ja: "1 ページの行数", en: "Lines per page" },
  baseFontSize: { group: "layout", ja: "基準の文字サイズ", en: "Base font size" },
  paragraphIndent: {
    group: "layout",
    ja: "段落の字下げ。原稿が全角スペースで字下げ済みなら 0（空ならテーマ任せ）",
    en: "Paragraph indent; use 0 when the manuscript already indents with an ideographic space (empty leaves it to the theme)",
  },
  footnote: {
    group: "layout",
    ja: "gcpm（ページ下）| pandoc（章末）| dpub",
    en: "gcpm (bottom of page) | pandoc (end of chapter) | dpub",
  },
  highlight: {
    group: "layout",
    ja: "==ハイライト== の扱い: boten | strong | mark | off",
    en: "What ==highlight== becomes: boten | strong | mark | off",
  },
  autoTcy: {
    group: "layout",
    ja: "2 桁の半角数字を自動で縦中横にする",
    en: "Turn 2-digit numbers upright in vertical writing",
  },
  imageWidthUnit: {
    group: "layout",
    ja: "![[fig.png|300]] の 300 の解釈: px | percent | mm",
    en: "How the 300 in ![[fig.png|300]] is read: px | percent | mm",
  },

  cover: { group: "cover", ja: "表紙画像", en: "Cover image" },
  coverPage: {
    group: "cover",
    ja: "表紙として組むノート（cover より優先）",
    en: "Note used as the cover page (wins over `cover`)",
  },
  coverFit: { group: "cover", ja: "cover（裁ち落とし）| contain", en: "cover | contain" },
  coverInPdf: { group: "cover", ja: "PDF に表紙を含める", en: "Include the cover in the PDF" },

  fontFamily: { group: "fonts", ja: "本文フォント", en: "Body font" },
  headingFontFamily: { group: "fonts", ja: "見出しフォント", en: "Heading font" },
  monospaceFontFamily: { group: "fonts", ja: "等幅フォント", en: "Monospace font" },
  mboxFontFamily: { group: "fonts", ja: "ノンブル・柱のフォント", en: "Running head font" },
  tcyFontFamily: { group: "fonts", ja: "縦中横のフォント", en: "Font used for upright numbers" },
  fontFeatureSettings: {
    group: "fonts",
    ja: "OpenType 機能（縦組みで 'vert' 1 等）",
    en: "OpenType features (e.g. 'vert' 1 for vertical writing)",
  },
  rubyFontSize: { group: "fonts", ja: "ルビの文字サイズ", en: "Ruby font size" },
  embedFonts: {
    group: "fonts",
    yamlOnly: true,
    ja: "Vault 内のフォントファイルを埋め込む: [{ family, src, weight }]",
    en: "Embed font files from the vault: [{ family, src, weight }]",
  },

  sections: {
    group: "structure",
    yamlOnly: true,
    ja: "前付け・後付け。auto | ノートパス | off",
    en: "Front and back matter. auto | note path | off",
  },
  pageNumbering: {
    group: "structure",
    ja: "roman-then-arabic | continuous | none",
    en: "roman-then-arabic | continuous | none",
  },
  tocDepth: { group: "structure", ja: "目次に拾う見出しの深さ", en: "Table of contents depth" },
  includeToc: {
    group: "structure",
    ja: "目次ノート自身を本文に含める",
    en: "Include the table-of-contents note in the body",
  },

  output: {
    group: "output",
    ja: "書き出し先（Vault 相対 / 絶対パス）",
    en: "Output path (vault-relative or absolute)",
  },
  cropMarks: { group: "output", ja: "トンボを付ける", en: "Add crop marks" },
  bleed: { group: "output", ja: "塗り足し（例 3mm）", en: "Bleed (e.g. 3mm)" },

  css: {
    group: "output",
    yamlOnly: true,
    ja: "追加 CSS（テーマの後に注入）",
    en: "Extra CSS, injected after the theme",
  },
};

const GROUP_TITLES: Record<string, { ja: string; en: string }> = {
  book: { ja: "本の情報", en: "Book information" },
  layout: { ja: "組版", en: "Typesetting" },
  cover: { ja: "表紙", en: "Cover" },
  fonts: { ja: "フォント", en: "Fonts" },
  structure: { ja: "前付け・後付け", en: "Front and back matter" },
  output: { ja: "出力", en: "Output" },
};

function locale(): Locale {
  return detectLocale();
}

function scalar(value: unknown): string {
  return dumpYaml(value, { lineWidth: -1, quotingType: '"' }).trimEnd();
}

function emit(key: string, value: unknown, indent = ""): string {
  if (value !== null && typeof value === "object") {
    const block = dumpYaml({ [key]: value }, { lineWidth: -1, quotingType: '"' }).trimEnd();
    return block
      .split("\n")
      .map((line) => `${indent}${line}`)
      .join("\n");
  }
  return `${indent}${key}: ${scalar(value)}`;
}

/**
 * `vivlio.yaml` with every key, its default and a comment.
 *
 * Written on request as a reference; the wizard writes the short version.
 */
export function referenceYaml(settings: VivlioSettings): string {
  const language = locale();
  const config = configFromSettings(settings);
  const lines: string[] = [
    language === "ja"
      ? "# Vivlio の本の設定。既定値と説明つきの全キー一覧です。"
      : "# Vivlio book configuration: every key, with its default and a note.",
    "",
  ];

  let currentGroup = "";
  for (const [key, doc] of Object.entries(KEY_DOCS) as [keyof BookConfig, KeyDoc][]) {
    if (doc.group !== currentGroup) {
      currentGroup = doc.group;
      lines.push("", `# --- ${GROUP_TITLES[currentGroup]?.[language] ?? currentGroup} ---`);
    }
    lines.push(`# ${doc[language]}${doc.yamlOnly ? (language === "ja" ? "（vivlio.yaml 専用）" : " (vivlio.yaml only)") : ""}`);

    if (key === "sections") {
      lines.push("sections:");
      for (const slot of SECTION_SLOTS) {
        lines.push(`  ${slot}: ${settings.sectionDefaults[slot] ?? "off"}`);
      }
      continue;
    }
    lines.push(emit(key, config[key] as unknown));
  }

  return `${lines.join("\n")}\n`;
}

/**
 * `vivlio.yaml` holding only what differs from the defaults.
 *
 * Writing every key would freeze today's defaults into the file and make the
 * diff unreadable (SPEC 5.4).
 */
export function configToYaml(
  values: Partial<BookConfig>,
  defaults: BookConfig,
): string {
  const language = locale();
  const lines: string[] = [];

  let currentGroup = "";
  for (const [key, doc] of Object.entries(KEY_DOCS) as [keyof BookConfig, KeyDoc][]) {
    const value = values[key];
    if (value === undefined) continue;
    if (JSON.stringify(value) === JSON.stringify(defaults[key])) continue;
    if (value === "" || value === null) continue;

    if (doc.group !== currentGroup) {
      if (currentGroup) lines.push("");
      currentGroup = doc.group;
      lines.push(`# ${GROUP_TITLES[currentGroup]?.[language] ?? currentGroup}`);
    }
    lines.push(emit(key, value as unknown));
  }

  return `${lines.join("\n")}\n`;
}

/** The frontmatter keys a single-note export is likely to need (SPEC 5.4). */
const MINIMAL_KEYS: (keyof BookConfig)[] = ["theme", "size"];
const STANDARD_KEYS: (keyof BookConfig)[] = [
  "theme",
  "size",
  "writingMode",
  "footnote",
  "highlight",
  "cover",
  "output",
];

/**
 * A flat `vivlio-*` frontmatter block.
 *
 * Obsidian's property editor cannot edit nested YAML, so a note only ever gets
 * flat keys - they show up in the property panel and stay editable there.
 */
export function frontmatterSnippet(
  settings: VivlioSettings,
  level: "minimal" | "standard",
): string {
  const config = configFromSettings(settings);
  const keys = level === "minimal" ? MINIMAL_KEYS : STANDARD_KEYS;
  const lines: string[] = [];
  for (const key of keys) {
    const value = config[key];
    if (value === "" || value === null || value === undefined) continue;
    lines.push(`vivlio-${camelToKebab(key)}: ${scalar(value)}`);
  }
  return lines.join("\n");
}

/** Take a book's `vivlio.yaml` back into the settings tab (SPEC 5.4). */
export function settingsFromYaml(
  yaml: Record<string, unknown>,
  settings: VivlioSettings,
): VivlioSettings {
  const next: VivlioSettings = { ...settings, syntax: { ...settings.syntax } };
  const assign = <K extends keyof VivlioSettings>(key: K, value: unknown): void => {
    if (value === undefined || value === null || value === "") return;
    next[key] = value as VivlioSettings[K];
  };

  assign("theme", yaml.theme);
  assign("size", yaml.size);
  assign("writingMode", yaml.writingMode);
  assign("footnote", yaml.footnote);
  assign("highlight", yaml.highlight);
  assign("fontFamily", yaml.fontFamily);
  assign("headingFontFamily", yaml.headingFontFamily);
  assign("monospaceFontFamily", yaml.monospaceFontFamily);
  assign("pageNumbering", yaml.pageNumbering);
  assign("tocDepth", yaml.tocDepth);
  if (typeof yaml.autoTcy === "boolean") next.syntax.autoTcy = yaml.autoTcy;
  if (yaml.sections && typeof yaml.sections === "object") {
    next.sectionDefaults = {
      ...next.sectionDefaults,
      ...(yaml.sections as VivlioSettings["sectionDefaults"]),
    };
  }
  return next;
}

/**
 * The settings tab as a `vivlio.yaml`, to pin a book to today's defaults.
 *
 * Compared against the factory defaults rather than against the settings, so
 * everything the user changed in the tab is actually written out.
 */
export function settingsToYaml(settings: VivlioSettings): string {
  const config = configFromSettings(settings);
  const values: Partial<BookConfig> = {};
  for (const key of Object.keys(KEY_DOCS) as (keyof BookConfig)[]) {
    (values as Record<string, unknown>)[key] = config[key];
  }
  return configToYaml(values, configFromSettings(DEFAULT_SETTINGS));
}
