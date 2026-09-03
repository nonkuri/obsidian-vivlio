import type { BookConfig } from "./types";
import { DEFAULT_SERIF_STACK } from "./defaults";

export interface Preset {
  id: string;
  /** i18n key suffix; see src/i18n. */
  labelKey: string;
  values: Partial<BookConfig>;
}

/**
 * Starting points offered by the setup wizard (SPEC 5.4).
 *
 * Every preset here names a theme the picker offers (see SELECTABLE_THEMES).
 * The tech-book and academic presets are held back with their themes: a
 * preset that set a theme nobody could then see in the picker would only
 * produce a book whose look could not be adjusted.
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
  { id: "custom", labelKey: "preset.custom", values: {} },
];

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
