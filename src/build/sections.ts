import type { TFile } from "obsidian";
import { warn, type BuildContext } from "./context";
import { htmlDocument } from "./document";
import { escapeHtml } from "./vfm";
import { DOCUMENT_ANCHOR } from "./toc";
import { t } from "../i18n";
import { kanjiDate } from "../util/kanji";
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

/**
 * The title page: everything the book calls itself (SPEC 5.11).
 *
 * The head names the work - the series it belongs to, its title, its subtitle -
 * and the imprint names the people, which is the division a title page makes
 * and the reason the two are separate boxes: the stylesheet pushes the imprint
 * to the far corner of the page, where a Japanese title page puts it.
 */
export function titlePageDocument(context: BuildContext): string {
  const { config } = context;
  const parts: string[] = [];

  if (config.series) parts.push(`<p class="series">${escapeHtml(config.series)}</p>`);
  parts.push(`<p class="title">${escapeHtml(config.title || t("book.untitled"))}</p>`);
  if (config.subtitle) parts.push(`<p class="subtitle">${escapeHtml(config.subtitle)}</p>`);

  const imprint: string[] = [];
  if (config.author) imprint.push(`<p class="author">${escapeHtml(config.author)}</p>`);
  if (config.translator) {
    imprint.push(`<p class="translator">${escapeHtml(config.translator)}</p>`);
  }
  if (config.publisher) {
    imprint.push(`<p class="publisher">${escapeHtml(config.publisher)}</p>`);
  }
  if (imprint.length > 0) parts.push(`<div class="imprint">\n${imprint.join("\n")}\n</div>`);

  return htmlDocument({
    lang: config.lang,
    title: config.title || t("book.untitled"),
    rootClass: "vivlio-front-matter",
    body: `<section class="titlepage vivlio-front" epub:type="titlepage">\n${parts.join("\n")}\n</section>`,
  });
}

/**
 * The colophon: who made the book, and when (SPEC 5.11).
 *
 * Two parts, as a Japanese colophon has: a head naming the series and the
 * book, then labelled lines for everyone and everything behind it. The head
 * carries no labels - nothing has to say that the title is the title - and the
 * lines are a description list, which is what they are.
 *
 * Only what the book actually says is printed: a novel with no translator and
 * no printer gets neither line, rather than an empty one.
 */
export function colophonDocument(context: BuildContext): string {
  const { config } = context;

  const rows: string[] = [];
  const add = (label: string, value: string) => {
    if (!value.trim()) return;
    rows.push(
      `<div class="colophon-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
    );
  };

  add(t("colophon.author"), config.author);
  add(t("colophon.translator"), config.translator);
  // A vertical page writes its dates in kanji; digits would be laid on their
  // side, and a colophon does not set them as tate-chu-yoko either.
  add(
    t("colophon.date"),
    config.writingMode === "vertical-rl" ? kanjiDate(config.date) : config.date,
  );
  add(t("colophon.version"), config.version);
  add(t("colophon.publisher"), config.publisher);
  add(t("colophon.printer"), config.printer);
  add(t("colophon.contact"), config.contact);
  add(t("colophon.website"), config.website);
  for (const entry of config.colophonExtra) add(entry.label, entry.value);

  const head: string[] = [];
  if (config.series) {
    head.push(`<p class="colophon-series">${escapeHtml(config.series)}</p>`);
  }
  head.push(
    `<p class="colophon-title">${escapeHtml(config.title || t("book.untitled"))}</p>`,
  );

  return htmlDocument({
    lang: config.lang,
    title: t("section.colophon"),
    body: `<section role="doc-colophon" id="${DOCUMENT_ANCHOR}">
<div class="colophon">
${head.join("\n")}
<dl class="colophon-rows">
${rows.join("\n")}
</dl>
</div>
</section>`,
  });
}
