import type { TFile } from "obsidian";
import { warn, type BuildContext } from "./context";
import { htmlDocument } from "./document";
import { escapeHtml } from "./vfm";
import { t } from "../i18n";
import {
  AUTO_CAPABLE_SLOTS,
  FRONT_MATTER_SLOTS,
  SECTION_SLOTS,
  type SectionSlot,
} from "../config/types";

/** DPUB-ARIA roles theme-base already gives a named page to (SPEC 5.11). */
const ROLES: Partial<Record<SectionSlot, string>> = {
  dedication: "doc-dedication",
  epigraph: "doc-epigraph",
  toc: "doc-toc",
  preface: "doc-preface",
  afterword: "doc-afterword",
  appendix: "doc-appendix",
  bibliography: "doc-bibliography",
  acknowledgments: "doc-acknowledgments",
  colophon: "doc-colophon",
};

export interface SectionPlan {
  slot: SectionSlot;
  isFrontMatter: boolean;
  role: string | null;
  /** Note that provides the content, when the slot points at one. */
  file: TFile | null;
  /** Pre-generated markup, when the slot is `auto`. */
  html: string | null;
}

export function roleFor(slot: SectionSlot): string | null {
  return ROLES[slot] ?? null;
}

/**
 * Work out which front and back matter parts the book has (SPEC 5.11).
 *
 * The order is fixed by SECTION_SLOTS rather than by the order the keys appear
 * in the YAML, so the same configuration always produces the same book.
 */
export function planSections(context: BuildContext): SectionPlan[] {
  const plans: SectionPlan[] = [];

  for (const slot of SECTION_SLOTS) {
    const value = context.config.sections[slot];
    if (!value || value === "off") continue;

    const isFrontMatter = FRONT_MATTER_SLOTS.includes(slot);
    const role = roleFor(slot);

    if (value === "auto") {
      if (!AUTO_CAPABLE_SLOTS.includes(slot)) {
        warn(context, {
          kind: "config",
          message: `sections.${slot}: "auto" is not available for this part`,
        });
        continue;
      }
      // The table of contents needs the chapters, so it is filled in later.
      plans.push({ slot, isFrontMatter, role, file: null, html: null });
      continue;
    }

    const file = context.app.metadataCache.getFirstLinkpathDest(
      value,
      `${context.bookRoot}/`,
    );
    if (!file) {
      warn(context, { kind: "config", message: `sections.${slot}: ${value} not found` });
      continue;
    }
    plans.push({ slot, isFrontMatter, role, file, html: null });
  }

  return plans;
}

/** `title` alone, on its own page. */
export function halfTitleDocument(context: BuildContext): string {
  const { config } = context;
  return htmlDocument({
    lang: config.lang,
    title: config.title || t("book.untitled"),
    rootClass: "vivlio-front-matter",
    body: `<section class="halftitle vivlio-front">
<p class="title">${escapeHtml(config.title || t("book.untitled"))}</p>
</section>`,
  });
}

/** Title, subtitle, author and publisher (SPEC 5.11). */
export function titlePageDocument(context: BuildContext): string {
  const { config } = context;
  const parts = [`<p class="title">${escapeHtml(config.title || t("book.untitled"))}</p>`];
  if (config.subtitle) parts.push(`<p class="subtitle">${escapeHtml(config.subtitle)}</p>`);
  if (config.author) parts.push(`<p class="author">${escapeHtml(config.author)}</p>`);
  if (config.publisher) parts.push(`<p class="publisher">${escapeHtml(config.publisher)}</p>`);

  return htmlDocument({
    lang: config.lang,
    title: config.title || t("book.untitled"),
    rootClass: "vivlio-front-matter",
    body: `<section class="titlepage vivlio-front" epub:type="titlepage">\n${parts.join("\n")}\n</section>`,
  });
}

/** The colophon: who made the book, when (SPEC 5.11). */
export function colophonDocument(context: BuildContext): string {
  const { config } = context;
  const rows: string[] = [];
  const add = (label: string, value: string) => {
    if (value) rows.push(`<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`);
  };
  add(t("colophon.title"), config.title);
  add(t("colophon.author"), config.author);
  add(t("colophon.publisher"), config.publisher);
  add(t("colophon.date"), config.date);
  add(t("colophon.version"), config.version);

  return htmlDocument({
    lang: config.lang,
    title: t("section.colophon"),
    body: `<section role="doc-colophon">
<table>
${rows.join("\n")}
</table>
</section>`,
  });
}
