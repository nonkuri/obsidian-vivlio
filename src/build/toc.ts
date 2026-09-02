import type { BuildContext, Chapter } from "./context";
import { htmlDocument } from "./document";
import { escapeHtml } from "./vfm";
import { t } from "../i18n";

/**
 * True when a heading is the book's own title, already printed on the title
 * page. Repeating it opens the body with a page carrying nothing else.
 */
export function isBookTitleHeading(
  context: BuildContext,
  heading: { level: number; text: string },
): boolean {
  if (heading.level !== 1) return false;
  if (context.config.sections.titlePage === "off") return false;
  return heading.text.trim() === context.config.title.trim();
}

/** Id on the outermost section of every document, for the table of contents. */
export const DOCUMENT_ANCHOR = "vivlio-start";

export interface TocEntry {
  /** `chapter.html` or `chapter.html#heading-slug`. */
  href: string;
  label: string;
  level: number;
  children: TocEntry[];
}

/**
 * The entries of a book's table of contents, nested by heading level.
 *
 * Both the printed table of contents and the EPUB's `nav.xhtml` are built
 * from this, so a reader's navigation shows the same structure - down to the
 * same `tocDepth` - as the page the book prints (SPEC 5.11).
 */
export function buildTocEntries(context: BuildContext, chapters: Chapter[]): TocEntry[] {
  const depth = Math.max(1, Math.min(6, context.config.tocDepth || 2));
  const entries: TocEntry[] = [];

  for (const chapter of chapters) {
    // The cover and the table of contents itself never appear in it.
    if (chapter.slot === "toc" || chapter.role === "doc-cover") continue;
    if (chapter.slot === "halfTitle" || chapter.slot === "titlePage") continue;

    const headings = chapter.file ? (context.headings.get(chapter.file.path) ?? []) : [];
    const wanted = headings.filter(
      (heading) => heading.level <= depth && !isBookTitleHeading(context, heading),
    );

    // A generated part (the colophon) has no headings; it still deserves a
    // line. It must point at an element, not just at the document: the page
    // number comes from `target-counter(attr(href), page)`, which resolves
    // nothing for a bare file name and falls back to the page the table of
    // contents is itself on.
    if (wanted.length === 0) {
      entries.push({
        href: `${chapter.docName}#${DOCUMENT_ANCHOR}`,
        label: chapter.title,
        level: 1,
        children: [],
      });
      continue;
    }

    for (const heading of wanted) {
      entries.push({
        href: `${chapter.docName}#${heading.slug}`,
        label: heading.text,
        level: heading.level,
        children: [],
      });
    }
  }

  return nest(entries);
}

/**
 * The table of contents page (SPEC 5.11).
 *
 * theme-base already implements the leader rules and the page number, via
 * `target-counter(attr(href), page)`, which Vivliostyle resolves against the
 * finished layout. So this only has to emit a plain nested list; the page
 * numbers appear on their own.
 */
export function tocDocument(context: BuildContext, chapters: Chapter[]): string {
  const body = `<nav role="doc-toc" id="toc" class="vivlio-front">
<h1>${escapeHtml(t("toc.heading"))}</h1>
${renderList(buildTocEntries(context, chapters))}
</nav>`;

  return htmlDocument({
    lang: context.config.lang,
    title: t("toc.heading"),
    rootClass: "vivlio-front-matter",
    body,
  });
}

/** Turn a flat heading list into the nesting the levels imply. */
function nest(entries: TocEntry[]): TocEntry[] {
  const root: TocEntry[] = [];
  const stack: TocEntry[] = [];

  for (const entry of entries) {
    while (stack.length > 0 && stack[stack.length - 1].level >= entry.level) stack.pop();
    if (stack.length === 0) root.push(entry);
    else stack[stack.length - 1].children.push(entry);
    stack.push(entry);
  }
  return root;
}

function renderList(entries: TocEntry[]): string {
  if (entries.length === 0) return "";
  const items = entries
    .map(
      (entry) =>
        `<li><a href="${escapeHtml(entry.href)}">${escapeHtml(entry.label)}</a>${renderList(
          entry.children,
        )}</li>`,
    )
    .join("\n");
  return `<ol>\n${items}\n</ol>`;
}
