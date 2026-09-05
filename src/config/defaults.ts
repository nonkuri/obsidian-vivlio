import type {
  BookConfig,
  SyntaxToggles,
  VivlioSettings,
} from "./types";

/**
 * Cross-OS font stacks (SPEC 5.10). theme-bunko ships
 * `'游明朝', 'YuMincho', serif`, which silently falls back to a generic serif
 * on macOS and Linux, so the plugin overrides it with a stack covering all
 * three platforms.
 */
export const DEFAULT_SERIF_STACK =
  "'游明朝', 'YuMincho', 'Yu Mincho', 'Hiragino Mincho ProN', 'ヒラギノ明朝 ProN', " +
  "'BIZ UDPMincho', 'Noto Serif CJK JP', 'Noto Serif JP', 'MS PMincho', serif";

export const DEFAULT_SANS_STACK =
  "'游ゴシック Medium', 'Yu Gothic Medium', 'YuGothic', 'Yu Gothic UI', " +
  "'Hiragino Sans', 'ヒラギノ角ゴシック', 'Noto Sans CJK JP', 'Noto Sans JP', 'Meiryo', sans-serif";

export const DEFAULT_MONO_STACK =
  "'Consolas', 'BIZ UDGothic', 'SFMono-Regular', 'Menlo', 'Noto Sans Mono CJK JP', monospace";

export const DEFAULT_SYNTAX: SyntaxToggles = {
  embed: true,
  dynamic: true,
  boten: true,
  aozoraRuby: true,
  tcy: true,
  autoTcy: true,
  highlight: true,
  imageEmbed: true,
  wikilink: true,
  callout: true,
  taskList: true,
  keepTags: false,
  stripComments: true,
  stripBlockIds: true,
  stripLeadingSpace: true,
  pageBreak: true,
  blankLines: true,
};

export const DEFAULT_SETTINGS: VivlioSettings = {
  defaultPreset: "bunko",

  theme: "novel",
  size: "文庫",
  writingMode: "vertical-rl",
  footnote: "gcpm",
  paragraphIndent: "",
  paragraphIndentMode: "auto",
  extraCssPath: "",

  fontFamily: DEFAULT_SERIF_STACK,
  headingFontFamily: DEFAULT_SANS_STACK,
  monospaceFontFamily: DEFAULT_MONO_STACK,
  // A plain vault folder: the configuration folder is not always
  // `.obsidian`, and a dotted one is not indexed, so `vault.getFiles()`
  // would never find what was put there (SPEC, unimplemented).
  fontFolder: "fonts",
  warnMissingFonts: true,
  embedFontsInEpub: false,

  outputFolder: "_output",
  openAfterExport: true,
  showPluginFiles: true,

  syntax: { ...DEFAULT_SYNTAX },
  highlight: "boten",

  sectionDefaults: {
    halfTitle: "off",
    titlePage: "auto",
    dedication: "off",
    epigraph: "off",
    toc: "auto",
    preface: "off",
    afterword: "off",
    appendix: "off",
    bibliography: "off",
    acknowledgments: "off",
    colophon: "auto",
  },
  pageNumbering: "roman-then-arabic",
  tocDepth: 2,

  autoRefresh: true,
  debounceMs: 600,
  renderAllPages: false,

  taggedPdf: true,
  pdfOutline: true,
  pdfMetadata: true,
  dpiWarnThreshold: 300,
  coverInPdf: true,
  downloadRemoteImages: true,
  allowOutsideVaultPaths: false,
  allowDynamicScripts: true,
  printTimeoutMs: 120_000,

  language: "auto",

  fixedPort: 0,
  logLevel: "error",
};

/** Book defaults that do not come from the settings tab. */
export function baseBookConfig(): BookConfig {
  return {
    title: "",
    subtitle: "",
    series: "",
    author: "",
    translator: "",
    publisher: "",
    printer: "",
    contact: "",
    website: "",
    date: "",
    lang: "ja",
    version: "",
    colophonExtra: [],

    theme: "novel",
    writingMode: "vertical-rl",
    size: "文庫",
    charsPerLine: null,
    linesPerPage: null,
    columns: null,
    baseFontSize: "",
    paragraphIndent: "",
    paragraphIndentMode: "auto",
    footnote: "gcpm",
    highlight: "boten",
    autoTcy: true,
    imageWidthUnit: "px",

    cover: "",
    coverPage: "",
    coverFit: "cover",
    coverInPdf: true,

    fontFamily: DEFAULT_SERIF_STACK,
    headingFontFamily: DEFAULT_SANS_STACK,
    monospaceFontFamily: DEFAULT_MONO_STACK,
    mboxFontFamily: "",
    tcyFontFamily: "",
    fontFeatureSettings: "",
    rubyFontSize: "",
    embedFonts: [],

    sections: {},
    pageNumbering: "roman-then-arabic",
    tocDepth: 2,
    includeToc: false,
    startPage: null,

    output: "",
    cropMarks: false,
    bleed: "",

    css: "",
    vfm: {},

    syntax: { ...DEFAULT_SYNTAX },
  };
}

/** Paper sizes offered in the UI, mapped to a CSS `size` value. */
export const PAPER_SIZES: Record<string, string> = {
  A4: "A4",
  A5: "A5",
  B5: "B5",
  "JIS-B5": "JIS-B5",
  "JIS-B6": "128mm 182mm",
  四六判: "127mm 188mm",
  A6: "105mm 148mm",
  文庫: "105mm 148mm",
  新書: "103mm 182mm",
  letter: "letter",
};

/**
 * Paper sizes a picker offers, in the order it offers them.
 *
 * `A6` and `文庫` name the same 105 x 148 mm sheet, so the list carries it
 * once, under the name a Japanese book uses; both stay resolvable above, for
 * a configuration that already writes either one.
 *
 * The labels give the millimetres, because "B5" alone is two different sheets
 * and the difference is the whole reason both are here.
 */
export const PAPER_SIZE_CHOICES: { value: string; labelKey: string }[] = [
  { value: "文庫", labelKey: "paper.bunko" },
  { value: "新書", labelKey: "paper.shinsho" },
  { value: "JIS-B6", labelKey: "paper.jisB6" },
  { value: "四六判", labelKey: "paper.shiroku" },
  { value: "A5", labelKey: "paper.a5" },
  { value: "JIS-B5", labelKey: "paper.jisB5" },
  { value: "B5", labelKey: "paper.b5" },
  { value: "A4", labelKey: "paper.a4" },
  { value: "letter", labelKey: "paper.letter" },
];

/** Resolve a `size` value to something usable in `--vs-page--size`. */
export function resolvePaperSize(size: string): string {
  const trimmed = (size ?? "").trim();
  if (!trimmed) return "auto";
  return PAPER_SIZES[trimmed] ?? trimmed;
}

/** Page width in mm, for turning a placement into a physical size. */
export function pageWidthMm(size: string): number | null {
  const resolved = resolvePaperSize(size);
  const named: Record<string, number> = {
    A3: 297,
    A4: 210,
    A5: 148,
    A6: 105,
    B4: 250,
    B5: 176,
    "JIS-B4": 257,
    "JIS-B5": 182,
    letter: 215.9,
    legal: 215.9,
    ledger: 279.4,
  };
  if (named[resolved]) return named[resolved];

  const explicit = resolved.match(/^([\d.]+)mm\s+([\d.]+)mm$/);
  if (explicit) return Number(explicit[1]);
  return null;
}

export function pageHeightMm(size: string): number | null {
  const resolved = resolvePaperSize(size);
  const named: Record<string, number> = {
    A3: 420,
    A4: 297,
    A5: 210,
    A6: 148,
    B4: 353,
    B5: 250,
    "JIS-B4": 364,
    "JIS-B5": 257,
    letter: 279.4,
    legal: 355.6,
    ledger: 431.8,
  };
  if (named[resolved]) return named[resolved];

  const explicit = resolved.match(/^([\d.]+)mm\s+([\d.]+)mm$/);
  if (explicit) return Number(explicit[2]);
  return null;
}
