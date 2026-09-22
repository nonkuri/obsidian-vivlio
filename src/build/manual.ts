import type { BuildContext, Chapter } from "./context";

/** Materialize caption numbers across notes without moving instructional images
 * or joining chapters. EPUB readers get the same labels as paged output. */
export function numberManualFigures(context: BuildContext, chapters: Chapter[]): void {
  if (context.config.theme !== "manual") return;
  const parser = new DOMParser();
  const documents = new Map<string, Document>();
  const labels = new Map<string, { kind: string; label: string }>();
  let figures = 0;
  let tables = 0;
  const ja = context.config.lang.startsWith("ja");
  for (const chapter of chapters) {
    const html = context.workspace.getFile(chapter.docName)?.text;
    if (!html) continue;
    const doc = parser.parseFromString(html, "text/html");
    documents.set(chapter.docName, doc);
    if (!chapter.isBody) continue;
    for (const block of Array.from(doc.querySelectorAll<HTMLElement>("figure, table:has(> caption)"))) {
      if (block.tagName === "TABLE" && block.closest("figure")) continue;
      const caption = block.querySelector("figcaption, caption");
      if (!caption || !caption.textContent?.trim()) continue;
      const table = block.tagName === "TABLE" || !!block.querySelector("table");
      const label = table ? `${ja ? "表" : "Table "}${++tables}` : `${ja ? "図" : "Figure "}${++figures}`;
      const marker = doc.createElement("span");
      marker.className = "vivlio-manual-number";
      marker.textContent = `${label}\u3000`;
      caption.prepend(marker);
      block.classList.add("vivlio-manual-numbered");
      const entry = { kind: table ? "tbl" : "fig", label };
      if (block.id) labels.set(`${chapter.docName}#${block.id}`, entry);
      if (caption.id) labels.set(`${chapter.docName}#${caption.id}`, entry);
      const grid = table ? (block.tagName === "TABLE" ? block as HTMLTableElement : block.querySelector("table")) : null;
      if (grid) {
        if (grid.rows.length <= 8) {
          block.classList.add("vivlio-manual-short-table");
          grid.classList.add("vivlio-manual-short-table");
        } else {
          // Keep a single semantic caption, repeated with the header in paged
          // output. EPUB displays it once, with no generated counter dependency.
          const row = grid.createTHead().insertRow(0);
          row.className = "vivlio-manual-table-caption";
          const cell = doc.createElement("th");
          cell.colSpan = Math.max(1, ...Array.from(grid.rows, r => Array.from(r.cells).reduce((n, c) => n + c.colSpan, 0)));
          cell.id = caption.id || uniqueCaptionId(doc);
          cell.append(...Array.from(caption.childNodes));
          const continued = doc.createElement("span");
          continued.className = "vivlio-manual-continued";
          continued.textContent = ja ? "（続き）" : " (continued)";
          cell.append(continued);
          row.append(cell);
          grid.setAttribute("aria-labelledby", cell.id);
          caption.remove();
        }
      }
    }
  }
  for (const [name, doc] of documents) {
    for (const link of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[data-ref='fig'], a[data-ref='tbl']"))) {
      let href = link.getAttribute("href") ?? "";
      try { href = decodeURI(href); } catch { /* Preserve malformed escapes. */ }
      const target = labels.get(href.startsWith("#") ? `${name}${href}` : href);
      if (!target || target.kind !== link.getAttribute("data-ref")) continue;
      link.textContent = target.label;
      link.classList.add("vivlio-manual-ref");
    }
    context.workspace.putText(name, `<!doctype html>\n${doc.documentElement.outerHTML}`);
  }
}

function uniqueCaptionId(doc: Document): string {
  let index = 1;
  while (doc.getElementById(`vivlio-manual-caption-${index}`)) index++;
  return `vivlio-manual-caption-${index}`;
}
