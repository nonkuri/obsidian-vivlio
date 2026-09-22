import { warn, type BuildContext, type Chapter, type HeadingEntry } from "./context";
import { htmlDocument } from "./document";
import { extractFrontmatterConfig } from "../config/resolve";

type PaperRole = "body" | "abstract" | "references" | "appendix" | "unnumbered";
const roles = new Set<PaperRole>(["body", "abstract", "references", "appendix", "unnumbered"]);

function appendixLetter(value: number): string {
  return value > 26 ? appendixLetter(Math.floor((value - 1) / 26)) + appendixLetter((value - 1) % 26 + 1) : String.fromCharCode(64 + value);
}

/** Materialize numbering once for print, ordinary browsers and EPUB alike.
 * Source IDs are scoped before joining, including footnotes and SVG references.
 * Only the paper theme changes publication structure; other themes keep their spine.
 */
export function assemblePaper(context: BuildContext, chapters: Chapter[]): () => void {
  if (context.config.theme !== "paper") return () => {};
  const sources = chapters.filter(chapter => chapter.isBody && chapter.file);
  if (!sources.length) return () => {};
  const parser = new DOMParser();
  const docs = new Map(sources.map(chapter => [chapter.docName,
    parser.parseFromString(context.workspace.getFile(chapter.docName)?.text ?? "", "text/html")]));
  const targets = new Map<string, string>();
  const numbers = new Map<string, string>();
  const headings: HeadingEntry[] = [];
  const output = "paper.html";
  const ja = context.config.lang.startsWith("ja");
  let chapterCount = 0;
  let appendixCount = 0;
  let figureCount = 0;
  let tableCount = 0;
  const fragments: string[] = [];
  const sourceRoles = new Map<Chapter, PaperRole>();
  for (const source of sources) {
    const raw = extractFrontmatterConfig(context.app.metadataCache.getFileCache(source.file!)?.frontmatter).paperRole;
    sourceRoles.set(source, roles.has(raw as PaperRole) ? raw as PaperRole : "body");
    if (raw !== undefined && raw !== null && raw !== "" && !roles.has(raw as PaperRole)) {
      warn(context, { kind: "config", source: source.file!.path, message: "paperRole: expected body, abstract, references, appendix or unnumbered" });
    }
  }
  const baseLevel = (role: PaperRole) => Math.min(...sources.filter(s => sourceRoles.get(s) === role)
    .flatMap(s => Array.from(docs.get(s.docName)!.querySelectorAll("h1,h2,h3,h4,h5,h6"), h => Number(h.tagName.slice(1)))));
  const bases = { body: baseLevel("body"), appendix: baseLevel("appendix") };
  const sectionState = {
    body: { levels: [0, 0, 0, 0, 0, 0], main: "" },
    appendix: { levels: [0, 0, 0, 0, 0, 0], main: "" },
  };

  for (const [index, source] of sources.entries()) {
    const doc = docs.get(source.docName)!;
    const prefix = `paper-${index + 1}-`;
    const anchor = `${prefix}start`;
    targets.set(source.docName, `${output}#${anchor}`);
    for (const el of Array.from(doc.querySelectorAll("[id]"))) {
      const old = el.id;
      el.id = `${prefix}${old}`;
      targets.set(`${source.docName}#${old}`, `${output}#${el.id}`);
    }
    // IDREFs are not URLs (ARIA, table headers), and cannot be fixed by href rewriting.
    for (const el of Array.from(doc.body.querySelectorAll("*"))) {
      for (const attr of ["aria-labelledby", "aria-describedby", "headers", "for"]) {
        if (el.hasAttribute(attr)) el.setAttribute(attr, el.getAttribute(attr)!.split(/\s+/).map(id => `${prefix}${id}`).join(" "));
      }
      for (const attr of Array.from(el.attributes)) {
        if (attr.value.includes("url(#")) el.setAttribute(attr.name, attr.value.replace(/url\(#([^)]*)\)/g, `url(#${prefix}$1)`));
      }
    }
    const role = sourceRoles.get(source)!;
    const allHeadings = Array.from(doc.body.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"));
    for (const h of allHeadings) {
      const level = Number(h.tagName.slice(1));
      const original = h.textContent ?? "";
      if (role === "body" || role === "appendix") {
        const depth = level - bases[role];
        const state = sectionState[role];
        const levels = state.levels;
        if (depth === 0) {
          state.main = role === "appendix" ? appendixLetter(++appendixCount) : String(++chapterCount);
          levels.fill(0);
        } else {
          levels[depth]++;
          levels.fill(0, depth + 1);
        }
        const number = [state.main, ...levels.slice(1, depth + 1)].join(".");
        const marker = doc.createElement("span");
        marker.className = "vivlio-paper-number";
        marker.textContent = `${role === "appendix" && depth === 0 ? (ja ? "付録" : "Appendix ") : ""}${number} `;
        // A semantic appendix title may already say "付録" without a letter.
        if (role === "appendix" && depth === 0 && /^(付録|Appendix)\s+/i.test(original)) {
          const first = h.firstChild;
          if (first?.nodeType === 3) first.textContent = first.textContent!.replace(/^(付録|Appendix)\s+/i, "");
        }
        h.prepend(marker);
        numbers.set(`${output}#${h.id}`, number);
      } else {
        numbers.set(`${output}#${h.id}`, original);
      }
      headings.push({ level, text: h.textContent ?? original, slug: h.id });
    }
    for (const figure of Array.from(doc.body.querySelectorAll<HTMLElement>("figure.fig,figure.tbl,figure:has(> img),figure:has(> picture),figure:has(table),table:has(> caption)"))) {
      // A captioned table inside a figure is still one table.
      if (figure.tagName === "TABLE" && figure.closest("figure")) continue;
      const isTable = figure.matches(".tbl,table") || !!figure.querySelector("table");
      if (!isTable) figure.classList.add("vivlio-paper-figure");
      const number = isTable ? ++tableCount : ++figureCount;
      const label = `${isTable ? (ja ? "表" : "Table ") : (ja ? "図" : "Figure ")}${number}`;
      if (!figure.id) figure.id = `${prefix}${isTable ? "table" : "figure"}-${number}`;
      numbers.set(`${output}#${figure.id}`, label);
      const caption = figure.querySelector("figcaption,caption");
      if (caption) {
        const marker = doc.createElement("span");
        marker.className = "vivlio-paper-number";
        marker.textContent = `${label}\u3000`;
        caption.prepend(marker);
        if (isTable) {
          const table = figure.tagName === "TABLE" ? figure as HTMLTableElement : figure.querySelector("table")!;
          if (table.rows.length <= 12) figure.classList.add("vivlio-paper-short-table");
          const head = table.tHead ?? table.createTHead();
          const row = head.insertRow(0);
          row.className = "vivlio-paper-table-caption";
          const cell = doc.createElement("th");
          cell.id = caption.id || `${figure.id}-caption`;
          figure.setAttribute("aria-labelledby", cell.id);
          cell.colSpan = Math.max(1, ...Array.from(table.rows).filter(r => r !== row).map(r => Array.from(r.cells).reduce((sum, c) => sum + c.colSpan, 0)));
          cell.append(...Array.from(caption.childNodes, node => node.cloneNode(true)));
          const continuation = doc.createElement("span");
          continuation.className = "vivlio-paper-continued";
          continuation.textContent = ja ? "（続き）" : " (continued)";
          cell.append(continuation);
          row.append(cell);
          // One accessible caption, repeated with the header on subsequent pages.
          caption.remove();
        }
      }
    }
    // Keep an equation's introduction with the display, without gluing long paragraphs.
    for (const math of Array.from(doc.body.querySelectorAll('math[display="block"]'))) {
      const block = math.closest("p") ?? math;
      block.classList.add("vivlio-paper-equation");
      if (block.previousElementSibling?.tagName === "P") block.previousElementSibling.classList.add("vivlio-paper-equation-intro");
    }
    // Local fragments must be resolved against their source before joining.
    for (const link of Array.from(doc.body.querySelectorAll("[href]"))) {
      const href = link.getAttribute("href")!;
      if (href.startsWith("#")) link.setAttribute("href", `${source.docName}${href}`);
    }
    const article = doc.createElement("article");
    article.id = anchor;
    article.className = "vivlio-paper-manuscript";
    article.dataset.paperRole = role;
    if (index === 0 && source.startPage !== undefined && context.config.pageNumbering === "roman-then-arabic") article.classList.add("vivlio-page-reset");
    for (const reset of Array.from(doc.body.querySelectorAll(".vivlio-page-reset"))) reset.classList.remove("vivlio-page-reset");
    article.append(...Array.from(doc.body.childNodes));
    fragments.push(article.outerHTML);
  }
  const combined: Chapter = {
    ...sources[0], docName: output, title: context.config.title, sources,
    tocHeadings: headings,
    html: htmlDocument({ title: context.config.title, lang: context.config.lang,
      writingMode: context.config.writingMode, rootClass: "vivlio-body vivlio-paper", body: fragments.join("\n") }),
  };
  context.workspace.putText(output, combined.html!);
  const first = chapters.indexOf(sources[0]);
  for (const source of sources) chapters.splice(chapters.indexOf(source), 1);
  chapters.splice(first, 0, combined);

  return () => {
    // Includes generated TOC and front matter with links into the manuscript.
    for (const chapter of chapters) {
      const html = context.workspace.getFile(chapter.docName)?.text;
      if (!html) continue;
      const doc = parser.parseFromString(html, "text/html");
      for (const link of Array.from(doc.querySelectorAll("[href]"))) {
        const raw = link.getAttribute("href")!;
        let decoded = raw;
        try { decoded = decodeURI(raw); } catch { /* Keep invalid escapes unchanged. */ }
        const target = targets.get(decoded) ?? targets.get(raw);
        if (target) link.setAttribute("href", target);
        const href = target ?? raw;
        const number = numbers.get(href);
        if (number && ["fig", "tbl", "sec"].includes(link.getAttribute("data-ref") ?? "")) {
          link.textContent = number;
          link.classList.add("vivlio-paper-ref");
        }
      }
      context.workspace.putText(chapter.docName, `<!doctype html>\n${doc.documentElement.outerHTML}`);
    }
  };
}
