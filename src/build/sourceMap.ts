import { visit, type UNode } from "../util/tree";
import type { BuildContext, Chapter } from "./context";

export interface SourceBlock {
  path: string;
  /** Zero-based inclusive source lines. */
  start: number;
  end: number;
  url: string;
  key: string;
}

const blocks = new Set(["paragraph", "heading", "listItem", "blockquote", "code", "table", "thematicBreak"]);

/** Capture Markdown positions before HTML rendering or generated content changes them. */
export function markSource(tree: UNode, path: string, lineOffset = 0): void {
  visit(tree, node => {
    if (!blocks.has(node.type)) return;
    const position = node.position as { start: { line: number }; end: { line: number } } | undefined;
    if (!position) return;
    node.vivlioSource = {
      dataVivlioSource: path,
      dataVivlioStart: position.start.line - 1 + lineOffset,
      dataVivlioEnd: position.end.line - 1 + lineOffset,
    };
  });
}

export function sourcePlugin(path: string) {
  return () => (tree: UNode): void => markSource(tree, path);
}

/** VFM's code/attribute plugins replace hProperties, so apply ours after them. */
export function sourcePropertiesPlugin() {
  return (tree: UNode): void => visit(tree, node => {
    if (!node.vivlioSource) return;
    const data = (node.data ??= {}) as { hProperties?: Record<string, unknown> };
    Object.assign(data.hProperties ??= {}, node.vivlioSource);
  });
}

export function copySourceProperties(from: Record<string, unknown>, to: Record<string, unknown>): void {
  for (const key of ["dataVivlioSource", "dataVivlioStart", "dataVivlioEnd"]) {
    if (from[key] !== undefined) to[key] = from[key];
  }
}

/** Run after paper assembly: its scoped IDs and document names are now final. */
export function collectSourceBlocks(context: BuildContext, chapters: Chapter[]): SourceBlock[] {
  const result: SourceBlock[] = [];
  for (const chapter of chapters) {
    const html = context.workspace.getFile(chapter.docName)?.text;
    if (!html) continue;
    const doc = new DOMParser().parseFromString(html, "text/html");
    let serial = 0;
    for (const el of Array.from(doc.querySelectorAll("[data-vivlio-source]"))) {
      const path = el.getAttribute("data-vivlio-source")!;
      const start = Number(el.getAttribute("data-vivlio-start"));
      const end = Number(el.getAttribute("data-vivlio-end"));
      if (!context.sourceTexts?.has(path) || !Number.isInteger(start) || start < 0 || !Number.isInteger(end) || end < start) continue;
      if (!el.id) {
        let id: string;
        do { id = `vivlio-source-${++serial}`; } while (doc.getElementById(id));
        el.id = id;
      }
      const key = `${chapter.docName}:${result.length}`;
      el.setAttribute("data-vivlio-sync", key);
      result.push({ path, start, end, key, url: `${context.workspaceBase}${chapter.docName}#${encodeURIComponent(el.id)}` });
    }
    context.workspace.putText(chapter.docName, `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`);
  }
  return result;
}

/** Prefer the smallest containing block (paragraph over quote/list container).
 * Blank lines follow the preceding block; frontmatter has no rendered target. */
export function blockAtLine(blocks: SourceBlock[], path: string, line: number): SourceBlock | undefined {
  const candidates = blocks.filter(block => block.path === path);
  const containing = candidates.filter(block => block.start <= line && block.end >= line);
  if (containing.length) return containing.sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
  return candidates.filter(block => block.end < line).sort((a, b) => b.end - a.end || b.start - a.start)[0];
}
