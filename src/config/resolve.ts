import { baseBookConfig } from "./defaults";
import { validateConfig, KNOWN_KEYS, type ConfigIssue } from "./schema";
import type {
  BookConfig,
  ColophonEntry,
  SectionSlot,
  SectionValue,
  SyntaxToggles,
  VivlioSettings,
} from "./types";
import { SECTION_SLOTS } from "./types";

/** `writingMode` -> `vivlio-writing-mode` */
export function camelToKebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** `vivlio-writing-mode` -> `writingMode` */
export function kebabToCamel(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Frontmatter keys the plugin owns; VFM must not turn them into `<meta>`. */
export function vivlioFrontmatterKeys(): string[] {
  const keys = ["vivlio"];
  for (const key of KNOWN_KEYS) keys.push(`vivlio-${camelToKebab(key)}`);
  return keys;
}

/**
 * Pull the plugin's own keys out of a note's frontmatter (SPEC 5.4, layer 3).
 *
 * Both the flat `vivlio-*` form (which the Obsidian property UI can edit) and
 * the nested `vivlio:` form (for people who hand-write YAML) are accepted.
 */
export function extractFrontmatterConfig(
  frontmatter: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!frontmatter) return out;

  const nested = frontmatter["vivlio"];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    Object.assign(out, nested as Record<string, unknown>);
  }

  for (const [key, value] of Object.entries(frontmatter)) {
    if (!key.startsWith("vivlio-")) continue;
    out[kebabToCamel(key.slice("vivlio-".length))] = value;
  }

  // A note's own `title` doubles as the chapter title, but only a single-note
  // export should let it name the whole book; the caller decides. It is copied
  // here so `resolveConfig` sees it at all.
  if (typeof frontmatter["title"] === "string" && out["title"] === undefined) {
    out["title"] = frontmatter["title"];
  }
  return out;
}

/** Layer 1: the settings tab, projected onto a book configuration. */
export function configFromSettings(settings: VivlioSettings): BookConfig {
  const config = baseBookConfig();
  config.theme = settings.theme;
  config.size = settings.size;
  config.writingMode = settings.writingMode;
  config.footnote = settings.footnote;
  config.paragraphIndent = settings.paragraphIndent;
  config.paragraphIndentMode = settings.paragraphIndentMode;
  config.highlight = settings.highlight;
  config.autoTcy = settings.syntax.autoTcy;
  config.fontFamily = settings.fontFamily;
  config.headingFontFamily = settings.headingFontFamily;
  config.monospaceFontFamily = settings.monospaceFontFamily;
  config.pageNumbering = settings.pageNumbering;
  config.tocDepth = settings.tocDepth;
  config.coverInPdf = settings.coverInPdf;
  config.sections = { ...settings.sectionDefaults };
  config.syntax = { ...settings.syntax };
  return config;
}

const NUMBER_KEYS = new Set([
  "charsPerLine",
  "linesPerPage",
  "columns",
  "tocDepth",
  "startPage",
]);
const BOOLEAN_KEYS = new Set([
  "autoTcy",
  "coverInPdf",
  "cropMarks",
  "includeToc",
]);

function coerce(key: string, value: unknown): unknown {
  if (value === undefined) return undefined;
  if (NUMBER_KEYS.has(key)) {
    if (value === null || value === "") return null;
    const n = typeof value === "number" ? value : Number(String(value));
    return Number.isFinite(n) ? n : undefined;
  }
  if (BOOLEAN_KEYS.has(key)) {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  }
  if (key === "paragraphIndent") return String(value);
  if (key === "date" && value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value;
}

function applyLayer(config: BookConfig, raw: Record<string, unknown>): void {
  for (const [key, rawValue] of Object.entries(raw)) {
    if (!KNOWN_KEYS.has(key)) continue;
    const value = coerce(key, rawValue);
    // `undefined` is an absent key; `null` is a property the writer added and
    // has not filled in yet. Neither is an instruction to override the layer
    // below - a blank `vivlio-theme:` means "not decided here", not "no theme".
    if (value === undefined || value === null) continue;

    if (key === "sections") {
      if (value && typeof value === "object") {
        for (const [slot, slotValue] of Object.entries(value as Record<string, unknown>)) {
          if (!SECTION_SLOTS.includes(slot as SectionSlot)) continue;
          config.sections[slot as SectionSlot] = String(slotValue);
        }
      }
      continue;
    }
    if (key === "vfm") {
      if (value && typeof value === "object") {
        config.vfm = { ...config.vfm, ...(value as Record<string, unknown>) };
      }
      continue;
    }
    if (key === "syntax") {
      if (value && typeof value === "object") {
        config.syntax = {
          ...config.syntax,
          ...(value as Partial<SyntaxToggles>),
        };
      }
      continue;
    }
    if (key === "colophonExtra") {
      config.colophonExtra = colophonEntries(value);
      continue;
    }
    if (key === "embedFonts") {
      if (Array.isArray(value)) config.embedFonts = value as BookConfig["embedFonts"];
      continue;
    }
    if (key === "order" || key === "toc") continue; // spine hints, not book config

    (config as unknown as Record<string, unknown>)[key] = value;
  }

  // `autoTcy` lives both on its own and inside the syntax toggles; keep them
  // in step so the settings tab and the YAML key mean the same thing.
  if (raw["autoTcy"] !== undefined) config.syntax.autoTcy = config.autoTcy;
}

/**
 * Extra colophon lines, from either shape the schema accepts.
 *
 * A list of `{ label, value }` keeps the order and allows the same label
 * twice; a plain mapping is shorter to write and keeps its order too, because
 * YAML mappings arrive as objects with string keys. An entry with no value is
 * dropped: the colophon prints only what the book actually says.
 */
function colophonEntries(value: unknown): ColophonEntry[] {
  const rows: ColophonEntry[] = [];
  const add = (label: unknown, text: unknown) => {
    const entry = { label: String(label ?? "").trim(), value: String(text ?? "").trim() };
    if (entry.value) rows.push(entry);
  };

  if (Array.isArray(value)) {
    for (const row of value) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      add(record.label, record.value);
    }
    return rows;
  }
  if (value && typeof value === "object") {
    for (const [label, text] of Object.entries(value as Record<string, unknown>)) {
      add(label, text);
    }
  }
  return rows;
}

export interface ResolveLayers {
  settings: VivlioSettings;
  /** Layer 2: parsed `vivlio.yaml`. */
  yaml?: Record<string, unknown> | null;
  /** Layer 3: the `vivlio-*` keys of a note's frontmatter. */
  frontmatter?: Record<string, unknown> | null;
}

export interface ResolvedConfig {
  config: BookConfig;
  issues: ConfigIssue[];
}

/** Merge the three configuration layers (SPEC 5.4). Lower layers win. */
export function resolveConfig(layers: ResolveLayers): ResolvedConfig {
  const config = configFromSettings(layers.settings);
  const issues: ConfigIssue[] = [];

  if (layers.yaml) {
    issues.push(...validateConfig(layers.yaml, "vivlio.yaml"));
    applyLayer(config, layers.yaml);
  }
  if (layers.frontmatter) {
    issues.push(...validateConfig(layers.frontmatter, "frontmatter"));
    applyLayer(config, layers.frontmatter);
  }

  config.autoTcy = config.syntax.autoTcy && config.autoTcy;
  if (!config.lang) config.lang = "ja";
  return { config, issues };
}
