import type { BookConfig } from "./types";
import { DEFAULT_SANS_STACK, DEFAULT_SERIF_STACK } from "./defaults";

export interface Preset {
  id: string;
  /** i18n key suffix; see src/i18n. */
  labelKey: string;
  values: Partial<BookConfig>;
}

/**
 * Starting points offered by the setup wizard (SPEC 5.4).
 *
 * Every preset here names a theme the picker offers (see SELECTABLE_THEMES):
 * a preset that set a theme nobody could then see in the picker would only
 * produce a book whose look could not be adjusted. The academic preset is
 * still held back with its theme for that reason.
 *
 * The two paperbacks differ by two numbers and nothing else, which is why the
 * labels say the numbers rather than name two kinds of book they cannot tell
 * apart: every notation a web novel is written with is on by default, so a
 * preset has nothing else to switch.
 */
export const PRESETS: Preset[] = [
  {
    id: "bunko",
    labelKey: "preset.bunko",
    values: {
      theme: "novel",
      writingMode: "vertical-rl",
      size: "文庫",
      charsPerLine: 39,
      linesPerPage: 15,
      footnote: "gcpm",
      highlight: "boten",
      autoTcy: true,
      pageNumbering: "roman-then-arabic",
      fontFamily: DEFAULT_SERIF_STACK,
    },
  },
  {
    id: "webnovel",
    labelKey: "preset.webnovel",
    values: {
      theme: "novel",
      writingMode: "vertical-rl",
      size: "文庫",
      charsPerLine: 40,
      linesPerPage: 16,
      footnote: "gcpm",
      highlight: "boten",
      autoTcy: true,
      pageNumbering: "roman-then-arabic",
      fontFamily: DEFAULT_SERIF_STACK,
    },
  },
  {
    id: "manual",
    labelKey: "preset.manual",
    values: {
      theme: "manual",
      writingMode: "horizontal-tb",
      size: "A5",
      // Margin-laid, not a grid: the theme sizes its block from the page, and
      // asking for characters and lines here would take that away from it.
      charsPerLine: null,
      linesPerPage: null,
      footnote: "gcpm",
      highlight: "mark",
      autoTcy: false,
      pageNumbering: "roman-then-arabic",
      fontFamily: DEFAULT_SANS_STACK,
      headingFontFamily: DEFAULT_SANS_STACK,
    },
  },
  { id: "custom", labelKey: "preset.custom", values: {} },
];

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
