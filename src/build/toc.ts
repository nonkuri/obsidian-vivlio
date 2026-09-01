import type { BuildContext, Chapter } from "./context";
import { htmlDocument } from "./document";
import { escapeHtml } from "./vfm";
import { t } from "../i18n";

interface TocEntry {
  href: string;
  label: string;
  level: number;
  children: TocEntry[];
}

/**
 * The table of contents (SPEC 5.11).
 *
 * theme-base already implements the leader rules and the page number, via
 * `target-counter(attr(href), page)`, which Vivliostyle resolves against the
 * finished layout. So this only has to emit a plain nested list; the page
 * numbers appear on their own.
 */
export function tocDocument(context: BuildContext, chapters: Chapter[]): string {
  const depth = Math.max(1, Math.min(6, context.config.tocDepth || 2));
  const entries: TocEntry[] = [];

  for (const chapter of chapters) {
    // The cover and the table of contents itself never appear in it.
    if (chapter.slot === "toc" || chapter.role === "doc-cover") continue;
    if (chapter.slot === "halfTitle" || chapter.slot === "titlePage") continue;

    const headings = chapter.file ? (context.headings.get(chapter.file.path) ?? []) : [];
    const wanted = headings.filter((heading) => heading.level <= depth);

    if (wanted.length === 0) {
      entries.push({
        href: chapter.docName,
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

  const body = `<nav role="doc-toc" id="toc" class="vivlio-front">
<h1>${escapeHtml(t("toc.heading"))}</h1>
${renderList(nest(entries))}
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
