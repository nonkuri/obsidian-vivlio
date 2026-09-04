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
    writingMode: config.writingMode,
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
/** A name, with the role it is credited in when the book has to say which. */
function named(cls: string, name: string, role: string): string {
  const suffix = role ? `<span class="role">${escapeHtml(role)}</span>` : "";
  return `<p class="${cls}">${escapeHtml(name)}${suffix}</p>`;
}

export function titlePageDocument(context: BuildContext): string {
  const { config } = context;
  const parts: string[] = [];

  if (config.series) parts.push(`<p class="series">${escapeHtml(config.series)}</p>`);
  parts.push(`<p class="title">${escapeHtml(config.title || t("book.untitled"))}</p>`);
  if (config.subtitle) parts.push(`<p class="subtitle">${escapeHtml(config.subtitle)}</p>`);

  // A name on its own is the author, and a Japanese title page says so by
  // saying nothing. That only holds while there is one name: as soon as the
  // book has a translator, an unmarked pair of names is a question rather
  // than an attribution, so both take their role (SPEC 5.11).
  const translated = Boolean(config.translator);
  const byline: string[] = [];
  if (config.author) {
    byline.push(named("author", config.author, translated ? t("role.author") : ""));
  }
  if (config.translator) {
    byline.push(named("translator", config.translator, t("role.translator")));
  }

  const imprint: string[] = [];
  if (byline.length > 0) imprint.push(`<div class="byline">\n${byline.join("\n")}\n</div>`);
  if (config.publisher) {
    imprint.push(`<p class="publisher">${escapeHtml(config.publisher)}</p>`);
  }
  if (imprint.length > 0) parts.push(`<div class="imprint">\n${imprint.join("\n")}\n</div>`);

  return htmlDocument({
    writingMode: config.writingMode,
    lang: config.lang,
    title: config.title || t("book.untitled"),
    rootClass: "vivlio-front-matter",
    body: `<section class="titlepage vivlio-front" epub:type="titlepage" id="${DOCUMENT_ANCHOR}">\n${parts.join("\n")}\n</section>`,
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

  // The colophon is written in groups, not as one ladder of labelled lines.
  // Every entry starting at the same point and running the same way is what
  // made it read as a table: a printed colophon says when the book was
  // published, then who made it, then who published it, and puts space
  // between those answers because they answer different questions.
  const groups: string[][] = [];
  const group = (): string[] => {
    const rows: string[] = [];
    groups.push(rows);
    return rows;
  };
  const add = (rows: string[], label: string, value: string) => {
    if (!value.trim()) return;
    rows.push(
      `<div class="colophon-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
    );
  };
  /** A line that is a sentence, not an entry: no label, nothing to align to. */
  const line = (rows: string[], text: string) => {
    if (!text.trim()) return;
    rows.push(`<div class="colophon-line">${escapeHtml(text)}</div>`);
  };

  // When the book was published. A vertical page writes its dates in kanji;
  // digits would be laid on their side, and a colophon does not set them as
  // tate-chu-yoko either. The edition belongs on that same line - "初版発行"
  // is one statement, and splitting it into 発行日 and 版 made two entries
  // out of a sentence every colophon writes in one.
  const date =
    config.writingMode === "vertical-rl" ? kanjiDate(config.date) : config.date;
  const published = group();
  if (date) {
    line(
      published,
      config.version
        ? t("colophon.issuedEdition", { date, version: config.version })
        : t("colophon.issued", { date }),
    );
  } else if (config.version) {
    line(published, config.version);
  }

  // Who made it.
  const people = group();
  add(people, t("colophon.author"), config.author);
  add(people, t("colophon.translator"), config.translator);

  // Who published it. The address and the website belong under the publisher
  // rather than beside it: they are how to reach that name, not two more
  // parties to the book, and giving each its own label made the column of
  // labels longer than the column of answers.
  const house = group();
  add(house, t("colophon.publisher"), config.publisher);
  for (const detail of [config.contact, config.website]) {
    if (detail.trim()) {
      house.push(`<div class="colophon-row colophon-detail"><dd>${escapeHtml(detail)}</dd></div>`);
    }
  }
  add(house, t("colophon.printer"), config.printer);

  // Whatever else the book wants to name.
  const extra = group();
  for (const entry of config.colophonExtra) add(extra, entry.label, entry.value);

  const head: string[] = [];
  if (config.series) {
    head.push(`<p class="colophon-series">${escapeHtml(config.series)}</p>`);
  }
  head.push(
    `<p class="colophon-title">${escapeHtml(config.title || t("book.untitled"))}</p>`,
  );

  return htmlDocument({
    writingMode: config.writingMode,
    lang: config.lang,
    title: t("section.colophon"),
    body: `<section role="doc-colophon" id="${DOCUMENT_ANCHOR}">
<div class="colophon">
${head.join("\n")}
<dl class="colophon-rows">
${groups
  .filter((rows) => rows.length > 0)
  .map((rows) => `<div class="colophon-group">\n${rows.join("\n")}\n</div>`)
  .join("\n")}
</dl>
</div>
</section>`,
  });
}
