import * as v from "valibot";
import { AUTO_CAPABLE_SLOTS, INDENT_MODES, SECTION_SLOTS } from "./types";
import type { SectionSlot } from "./types";

/**
 * Schema for the book configuration as written by the user, i.e. what may
 * appear in `vivlio.yaml` or (flattened) in frontmatter. Everything is
 * optional: unset keys fall through to the layer above (SPEC 5.4).
 *
 * VFM options are not re-declared here; the `vfm` key is validated with VFM's
 * own valibot schema so the two never drift.
 */

const WritingModeSchema = v.picklist(["vertical-rl", "horizontal-tb"]);
const FootnoteSchema = v.picklist(["gcpm", "pandoc", "dpub"]);
const HighlightSchema = v.picklist(["boten", "strong", "mark", "off"]);
const ImageWidthUnitSchema = v.picklist(["px", "percent", "mm"]);
const PageNumberingSchema = v.picklist(["roman-then-arabic", "continuous", "none"]);
const CoverFitSchema = v.picklist(["cover", "contain"]);
const IndentModeSchema = v.picklist([...INDENT_MODES]);

/**
 * Extra colophon lines, in either of the two shapes YAML makes natural: a list
 * of `{ label, value }`, which keeps duplicates and order explicit, or a plain
 * mapping of label to value, which is shorter to write.
 */
const ColophonExtraSchema = v.union([
  v.array(
    v.object({
      label: v.string(),
      value: v.union([v.string(), v.number()]),
    }),
  ),
  v.record(v.string(), v.union([v.string(), v.number()])),
]);

const EmbedFontSchema = v.object({
  family: v.string(),
  src: v.string(),
  weight: v.optional(v.union([v.string(), v.number()])),
  style: v.optional(v.string()),
});

const SectionsSchema = v.partial(
  v.object(
    Object.fromEntries(SECTION_SLOTS.map((slot) => [slot, v.string()])) as Record<
      SectionSlot,
      v.StringSchema<undefined>
    >,
  ),
);

export const BookConfigInputSchema = v.object({
  title: v.optional(v.string()),
  subtitle: v.optional(v.string()),
  series: v.optional(v.string()),
  author: v.optional(v.string()),
  translator: v.optional(v.string()),
  publisher: v.optional(v.string()),
  printer: v.optional(v.string()),
  contact: v.optional(v.string()),
  website: v.optional(v.string()),
  date: v.optional(v.union([v.string(), v.date()])),
  lang: v.optional(v.string()),
  version: v.optional(v.union([v.string(), v.number()])),
  colophonExtra: v.optional(ColophonExtraSchema),

  theme: v.optional(v.string()),
  writingMode: v.optional(WritingModeSchema),
  size: v.optional(v.string()),
  charsPerLine: v.optional(v.union([v.number(), v.null()])),
  linesPerPage: v.optional(v.union([v.number(), v.null()])),
  columns: v.optional(v.union([v.number(), v.null()])),
  baseFontSize: v.optional(v.string()),
  paragraphIndent: v.optional(v.union([v.string(), v.number()])),
  paragraphIndentMode: v.optional(IndentModeSchema),
  footnote: v.optional(FootnoteSchema),
  highlight: v.optional(HighlightSchema),
  autoTcy: v.optional(v.boolean()),
  imageWidthUnit: v.optional(ImageWidthUnitSchema),

  cover: v.optional(v.string()),
  coverPage: v.optional(v.string()),
  coverFit: v.optional(CoverFitSchema),
  coverInPdf: v.optional(v.boolean()),

  fontFamily: v.optional(v.string()),
  headingFontFamily: v.optional(v.string()),
  monospaceFontFamily: v.optional(v.string()),
  mboxFontFamily: v.optional(v.string()),
  tcyFontFamily: v.optional(v.string()),
  fontFeatureSettings: v.optional(v.string()),
  rubyFontSize: v.optional(v.string()),
  embedFonts: v.optional(v.array(EmbedFontSchema)),

  sections: v.optional(SectionsSchema),
  pageNumbering: v.optional(PageNumberingSchema),
  tocDepth: v.optional(v.number()),
  includeToc: v.optional(v.boolean()),
  startPage: v.optional(v.union([v.number(), v.null()])),
  order: v.optional(v.number()),
  toc: v.optional(v.boolean()),

  output: v.optional(v.string()),
  cropMarks: v.optional(v.boolean()),
  bleed: v.optional(v.string()),

  css: v.optional(v.string()),
  vfm: v.optional(v.record(v.string(), v.unknown())),
  syntax: v.optional(v.record(v.string(), v.boolean())),
});

export type BookConfigInput = v.InferOutput<typeof BookConfigInputSchema>;

export const KNOWN_KEYS = new Set(Object.keys(BookConfigInputSchema.entries));

export interface ConfigIssue {
  level: "warning" | "error";
  key: string;
  message: string;
}

/**
 * Validate a raw config object (from `vivlio.yaml` or frontmatter).
 *
 * Unknown keys are reported but never dropped: they are handed to VFM, which
 * turns anything it does not recognise into `<meta>` (SPEC 5.4).
 */
export function validateConfig(raw: unknown, source: string): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (raw === null || typeof raw !== "object") {
    return [{ level: "error", key: source, message: "not a mapping" }];
  }
  const obj = raw as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) {
      issues.push({
        level: "warning",
        key,
        message: `unknown key (passed through to VFM)`,
      });
    }
  }

  // A key written but left empty is a line waiting to be filled in, not a
  // wrong value: `resolveConfig` skips a null rather than overriding with it,
  // so the check has nothing to report about one either.
  const known: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (KNOWN_KEYS.has(key) && obj[key] !== null) known[key] = obj[key];
  }

  const result = v.safeParse(BookConfigInputSchema, known);
  if (!result.success) {
    for (const issue of result.issues) {
      const key = issue.path?.map((p) => String((p as { key?: unknown }).key)).join(".") ?? "?";
      issues.push({ level: "error", key, message: issue.message });
    }
  }

  const sections = (obj.sections ?? {}) as Record<string, unknown>;
  for (const [slot, value] of Object.entries(sections)) {
    if (!SECTION_SLOTS.includes(slot as SectionSlot)) {
      issues.push({ level: "warning", key: `sections.${slot}`, message: "unknown section" });
      continue;
    }
    if (
      value === "auto" &&
      !AUTO_CAPABLE_SLOTS.includes(slot as SectionSlot)
    ) {
      issues.push({
        level: "error",
        key: `sections.${slot}`,
        message: `"auto" is only available for ${AUTO_CAPABLE_SLOTS.join(", ")}`,
      });
    }
  }

  return issues;
}
