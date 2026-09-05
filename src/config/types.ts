/**
 * Types shared by the three configuration layers (SPEC 5.4):
 *   1. the settings tab  (vault-wide defaults)
 *   2. vivlio.yaml       (per book, nesting allowed)
 *   3. frontmatter       (per note, flat `vivlio-*` keys only)
 *
 * A lower layer overrides a higher one (1 < 2 < 3).
 */

export type WritingMode = "vertical-rl" | "horizontal-tb";
export type FootnoteMode = "gcpm" | "pandoc" | "dpub";
export type HighlightMode = "boten" | "strong" | "mark" | "off";
export type ImageWidthUnit = "px" | "percent" | "mm";
export type PageNumbering = "roman-then-arabic" | "continuous" | "none";

/**
 * Which paragraphs take the first-line indent (SPEC 5.3 #16).
 *
 * `auto` follows the manuscript when it indents itself with an ideographic
 * space and falls back to the bracket rule when it does not; the other three
 * pick one of those answers outright.
 */
export const INDENT_MODES = ["auto", "manuscript", "brackets", "all"] as const;

export type IndentMode = (typeof INDENT_MODES)[number];
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

/**
 * `auto`, `off`, or the path of a note.
 *
 * A string, in the end: the two names are values it may take, not a closed
 * set, because any note path is also one.
 */
export type SectionValue = string;

export interface EmbedFont {
  family: string;
  /** Vault-relative path, or an absolute path outside the vault. */
  src: string;
  weight?: string | number;
  style?: string;
}

/** The preprocessing stages of SPEC 5.3, individually switchable. */
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
  /**
   * #15 the ideographic space many manuscripts use to indent a paragraph.
   *
   * It is a plain-text stand-in for the indent, and typesetters trim a space
   * at the start of a line, so leaving it in gives no indent at all in print
   * and an inconsistent one in EPUB readers. Removing it and letting
   * `paragraphIndent` do the work is both reliable and portable.
   */
  stripLeadingSpace: boolean;
  /** #17 a forced page break: `［＃改ページ］`, or a line of `===` */
  pageBreak: boolean;
  /** #18 a run of blank lines in the manuscript becomes space on the page */
  blankLines: boolean;
}

/** One line of the colophon the book supplies itself. */
export interface ColophonEntry {
  label: string;
  value: string;
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
  /** Name of the series the book belongs to, printed above the title. */
  series: string;
  author: string;
  /** Translator, for a book that has one. */
  translator: string;
  publisher: string;
  /** Printer, which a Japanese colophon names separately from the publisher. */
  printer: string;
  /** Where to write to the publisher: an address, an email. */
  contact: string;
  website: string;
  date: string;
  lang: string;
  version: string;
  /**
   * Lines the book adds to its own colophon (SPEC 5.11).
   *
   * A colophon names whoever the book wants to name - the designer, the
   * proofreader, the printer's plate maker - and no fixed set of keys covers
   * that, so the book supplies its own labels.
   */
  colophonExtra: ColophonEntry[];

  // typesetting
  theme: string;
  writingMode: WritingMode;
  size: string;
  charsPerLine: number | null;
  linesPerPage: number | null;
  /**
   * 段: how many columns the page is divided into.
   *
   * Columns divide the character axis, so `charsPerLine` is the length of one
   * column's line and `linesPerPage` is what one column holds - every column
   * is as long as the page is wide, so the page carries `columns x lines`.
   *
   * Null takes the theme's own count, which is one for every theme but
   * `novel-2col`. Only a theme that lays columns out acts on it.
   */
  columns: number | null;
  baseFontSize: string;
  /**
   * `--vs--p-text-indent`. Empty leaves the theme's own value alone.
   *
   * Manuscripts written for Kakuyomu or Aozora already start each paragraph
   * with an ideographic space, and theme-bunko adds a 1em indent on top of
   * it, so the first line ends up indented twice.
   */
  paragraphIndent: string;
  /** Which paragraphs the indent applies to (SPEC 5.3 #16). */
  paragraphIndentMode: IndentMode;
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
  /** Default `--vs--p-text-indent`; empty leaves it to the theme. */
  paragraphIndent: string;
  /** Default answer to which paragraphs take that indent. */
  paragraphIndentMode: IndentMode;
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

  /**
   * Claim `.yaml` / `.css` / `.epub` so the file explorer lists them.
   *
   * Obsidian shows only the extensions some view has claimed, so the book
   * configuration this plugin writes is invisible by default. Off is for a
   * vault where another plugin should own those files instead.
   */
  showPluginFiles: boolean;

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
}
