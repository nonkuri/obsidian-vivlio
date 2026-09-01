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
};

export const DEFAULT_SETTINGS: VivlioSettings = {
  defaultPreset: "bunko",

  theme: "bunko",
  size: "文庫",
  writingMode: "vertical-rl",
  footnote: "gcpm",
  extraCssPath: "",

  fontFamily: DEFAULT_SERIF_STACK,
  headingFontFamily: DEFAULT_SANS_STACK,
  monospaceFontFamily: DEFAULT_MONO_STACK,
  fontFolder: ".obsidian/fonts",
  warnMissingFonts: true,
  embedFontsInEpub: false,

  outputFolder: "_output",
  openAfterExport: true,

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
  cliPath: "",
};

/** Book defaults that do not come from the settings tab. */
export function baseBookConfig(): BookConfig {
  return {
    title: "",
    subtitle: "",
    author: "",
    publisher: "",
    date: "",
    lang: "ja",
    version: "",

    theme: "bunko",
    writingMode: "vertical-rl",
    size: "文庫",
    charsPerLine: null,
    linesPerPage: null,
    baseFontSize: "",
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
  A6: "105mm 148mm",
  文庫: "105mm 148mm",
  新書: "103mm 182mm",
  letter: "letter",
};

/** Resolve a `size` value to something usable in `--vs-page--size`. */
export function resolvePaperSize(size: string): string {
  const trimmed = (size ?? "").trim();
  if (!trimmed) return "auto";
  return PAPER_SIZES[trimmed] ?? trimmed;
}
