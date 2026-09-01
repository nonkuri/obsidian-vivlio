import type { BookConfig } from "./types";
import {
  DEFAULT_MONO_STACK,
  DEFAULT_SANS_STACK,
  DEFAULT_SERIF_STACK,
} from "./defaults";

export interface Preset {
  id: string;
  /** i18n key suffix; see src/i18n. */
  labelKey: string;
  values: Partial<BookConfig>;
}

/** Starting points offered by the setup wizard (SPEC 5.4). */
export const PRESETS: Preset[] = [
  {
    id: "bunko",
    labelKey: "preset.bunko",
    values: {
      theme: "bunko",
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
    id: "techbook",
    labelKey: "preset.techbook",
    values: {
      theme: "techbook",
      writingMode: "horizontal-tb",
      size: "A5",
      charsPerLine: null,
      linesPerPage: null,
      footnote: "gcpm",
      highlight: "strong",
      autoTcy: false,
      pageNumbering: "roman-then-arabic",
      fontFamily: DEFAULT_SANS_STACK,
      monospaceFontFamily: DEFAULT_MONO_STACK,
    },
  },
  {
    id: "academic",
    labelKey: "preset.academic",
    values: {
      theme: "academic",
      writingMode: "horizontal-tb",
      size: "A4",
      charsPerLine: null,
      linesPerPage: null,
      footnote: "pandoc",
      highlight: "mark",
      autoTcy: false,
      pageNumbering: "continuous",
      fontFamily: DEFAULT_SERIF_STACK,
    },
  },
  {
    id: "webnovel",
    labelKey: "preset.webnovel",
    values: {
      theme: "bunko",
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
