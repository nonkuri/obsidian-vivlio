/**
 * Types shared by the three configuration layers (SPEC 5.4):
 *   1. the settings tab  (vault-wide defaults)
 *   2. vivlio.yaml       (per book, nesting allowed)
 *   3. frontmatter       (per note, flat `vivlio-*` keys only)
 *
 * A lower layer overrides a higher one (1 < 2 < 3).
 */

export type ThemeName = "bunko" | "techbook" | "academic" | "base";
export type WritingMode = "vertical-rl" | "horizontal-tb";
export type FootnoteMode = "gcpm" | "pandoc" | "dpub";
export type HighlightMode = "boten" | "strong" | "mark" | "off";
export type ImageWidthUnit = "px" | "percent" | "mm";
export type PageNumbering = "roman-then-arabic" | "continuous" | "none";
export type CoverFit = "cover" | "contain";
export type Language = "ja" | "en" | "auto";

/** Front/back matter slots, in the canonical order they are laid out (SPEC 5.11). */
export const SECTION_SLOTS = [
  "halfTitle",
  "titlePage",
  "dedication",
  "epigraph",
  "toc",
  "preface",
  // --- body ---
  "afterword",
  "appendix",
  "bibliography",
  "acknowledgments",
  "colophon",
] as const;

export type SectionSlot = (typeof SECTION_SLOTS)[number];

/** Slots whose content the plugin can generate on its own. */
export const AUTO_CAPABLE_SLOTS: SectionSlot[] = [
  "halfTitle",
  "titlePage",
  "toc",
  "colophon",
];

/** Slots that belong before the body. Everything else is back matter. */
export const FRONT_MATTER_SLOTS: SectionSlot[] = [
  "halfTitle",
  "titlePage",
  "dedication",
  "epigraph",
  "toc",
  "preface",
];

/** `auto` | note path | `off` */
export type SectionValue = "auto" | "off" | string;

export interface EmbedFont {
  family: string;
  /** Vault-relative path, or an absolute path outside the vault. */
  src: string;
  weight?: string | number;
  style?: string;
}

/** The 15 preprocessing stages of SPEC 5.3, individually switchable. */
export interface SyntaxToggles {
  /** #1 `![[Note]]` embedding */
  embed: boolean;
  /** #2 dataview / mermaid rendering through MarkdownRenderer */
  dynamic: boolean;
  /** #3 `《《text》》` emphasis dots */
  boten: boolean;
  /** #4 `｜kanji《kana》` ruby */
  aozoraRuby: boolean;
  /** #5 `^^10^^` tate-chu-yoko */
  tcy: boolean;
  /** #6 automatic tate-chu-yoko for 2-digit numbers */
  autoTcy: boolean;
  /** #7 `==highlight==` */
  highlight: boolean;
  /** #8 `![[image.png]]` */
  imageEmbed: boolean;
  /** #9 `[[Note]]` */
  wikilink: boolean;
  /** #10 `> [!note]` callouts */
  callout: boolean;
  /** #11 `- [ ]` task lists */
  taskList: boolean;
  /** #12 `#tag` (false = strip) */
  keepTags: boolean;
  /** #13 `%%comment%%` */
  stripComments: boolean;
  /** #14 `^block-id` */
  stripBlockIds: boolean;
}

/**
 * A fully resolved book configuration. Every field is required here; the
 * layers above hand in `Partial<BookConfig>` and `resolveConfig` fills the
 * gaps from the settings tab.
 */
export interface BookConfig {
  // bibliographic
  title: string;
  subtitle: string;
  author: string;
  publisher: string;
  date: string;
  lang: string;
  version: string;

  // typesetting
  theme: string;
  writingMode: WritingMode;
  size: string;
  charsPerLine: number | null;
  linesPerPage: number | null;
  baseFontSize: string;
  footnote: FootnoteMode;
  highlight: HighlightMode;
  autoTcy: boolean;
  imageWidthUnit: ImageWidthUnit;

  // cover (SPEC 5.9)
  cover: string;
  coverPage: string;
  coverFit: CoverFit;
  coverInPdf: boolean;

  // fonts (SPEC 5.10)
  fontFamily: string;
  headingFontFamily: string;
  monospaceFontFamily: string;
  mboxFontFamily: string;
  tcyFontFamily: string;
  fontFeatureSettings: string;
  rubyFontSize: string;
  embedFonts: EmbedFont[];

  // structure (SPEC 5.11)
  sections: Partial<Record<SectionSlot, SectionValue>>;
  pageNumbering: PageNumbering;
  tocDepth: number;
  includeToc: boolean;
  startPage: number | null;

  // output
  output: string;
  cropMarks: boolean;
  bleed: string;

  /** Extra CSS injected after the theme. */
  css: string;

  /** Options handed straight to VFM (`vfm:` in frontmatter / vivlio.yaml). */
  vfm: Record<string, unknown>;

  syntax: SyntaxToggles;
}

export interface VivlioSettings {
  /** Default preset used by the setup wizard. */
  defaultPreset: string;

  // typesetting defaults
  theme: string;
  size: string;
  writingMode: WritingMode;
  footnote: FootnoteMode;
  /** Vault-relative path of an extra stylesheet. */
  extraCssPath: string;

  // fonts
  fontFamily: string;
  headingFontFamily: string;
  monospaceFontFamily: string;
  /** Vault-relative folder scanned for font files. */
  fontFolder: string;
  warnMissingFonts: boolean;
  embedFontsInEpub: boolean;

  // output
  outputFolder: string;
  openAfterExport: boolean;

  // syntax
  syntax: SyntaxToggles;
  highlight: HighlightMode;

  // structure
  sectionDefaults: Partial<Record<SectionSlot, SectionValue>>;
  pageNumbering: PageNumbering;
  tocDepth: number;

  // preview
  autoRefresh: boolean;
  debounceMs: number;
  renderAllPages: boolean;

  // pdf
  taggedPdf: boolean;
  pdfOutline: boolean;
  pdfMetadata: boolean;
  /** Warn below this effective dpi. 0 disables the check. */
  dpiWarnThreshold: number;
  coverInPdf: boolean;
  downloadRemoteImages: boolean;
  allowOutsideVaultPaths: boolean;
  /** Run dataviewjs / templater code while exporting (SPEC 5.8(8)). */
  allowDynamicScripts: boolean;
  printTimeoutMs: number;

  language: Language;

  // advanced
  fixedPort: number;
  logLevel: "silent" | "error" | "info" | "debug";
  cliPath: string;
}
