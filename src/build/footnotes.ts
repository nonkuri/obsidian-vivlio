import { addClass, isElement, visit, type UNode } from "../util/tree";

interface FootnoteState {
  footnoteById: Record<string, UNode | undefined>;
}

type Handler = (state: FootnoteState, node: UNode, parent?: UNode) => UNode | UNode[] | null | undefined;

/**
 * VFM 2.7.2's GCPM and DPUB handlers unwrap the first paragraph even when
 * other blocks follow it. Feed their existing converter all the blocks,
 * while keeping its numbering, duplicate references and customizers.
 * Pandoc has no footnoteReference override and needs no correction.
 */
export function preserveFootnoteBlocks<T extends Record<string, unknown>>(handlers: T): T {
  const upstream = handlers.footnoteReference as Handler | undefined;
  if (!upstream) return handlers;

  return {
    ...handlers,
    footnoteReference: (state: FootnoteState, node: UNode, parent?: UNode) => {
      const id = String(node.identifier).toUpperCase();
      const definition = state.footnoteById[id];
      const blocks = definition?.children;
      if (!definition || !blocks || blocks.length < 2 || blocks[0].type !== "paragraph") {
        return upstream(state, node, parent);
      }

      // The upstream handler converts the selected paragraph's children.
      // Use a temporary container for the complete definition; never mutate
      // the source tree or leave the cache changed for later references.
      state.footnoteById[id] = {
        ...definition,
        children: [{ type: "paragraph", children: blocks }],
      };
      try {
        const result = upstream(state, node, parent);
        // DPUB queues an aside and returns a link. GCPM returns the note
        // itself inside a paragraph, where block HTML would close the host
        // paragraph during rehype-raw or EPUB's DOMParser pass.
        if (result && !Array.isArray(result) && isElement(result, "span")) {
          inlineFootnoteBlocks(result);
        }
        return result;
      } finally {
        state.footnoteById[id] = definition;
      }
    },
  };
}

/** Block content in a GCPM note must remain valid inside its inline span. */
const BLOCKS: Record<string, { display: string; role?: string }> = {
  p: { display: "block" },
  div: { display: "block" },
  section: { display: "block" },
  aside: { display: "block" },
  blockquote: { display: "block" },
  pre: { display: "block" },
  ul: { display: "block", role: "list" },
  ol: { display: "block", role: "list" },
  li: { display: "list-item", role: "listitem" },
  dl: { display: "block" },
  dt: { display: "block", role: "term" },
  dd: { display: "block", role: "definition" },
  figure: { display: "block", role: "figure" },
  figcaption: { display: "block" },
  table: { display: "table", role: "table" },
  thead: { display: "table-header-group", role: "rowgroup" },
  tbody: { display: "table-row-group", role: "rowgroup" },
  tfoot: { display: "table-footer-group", role: "rowgroup" },
  tr: { display: "table-row", role: "row" },
  th: { display: "table-cell", role: "columnheader" },
  td: { display: "table-cell", role: "cell" },
  hr: { display: "block", role: "separator" },
};

function inlineFootnoteBlocks(note: UNode): void {
  visit(note, (node) => {
    if (!isElement(node) || node === note) return;
    const tag = node.tagName;
    const heading = /^h([1-6])$/.exec(tag);
    const block = BLOCKS[tag] ?? (heading ? { display: "block", role: "heading" } : undefined);
    if (!block) return;

    node.tagName = "span";
    node.properties["data-vivlio-footnote-block"] = tag;
    addClass(node, "vivlio-footnote-block");
    const style = typeof node.properties.style === "string" ? node.properties.style : "";
    node.properties.style = `${style}${style ? ";" : ""}display:${block.display};`;
    if (block.role && !node.properties.role) node.properties.role = block.role;
    if (heading) node.properties.ariaLevel = Number(heading[1]);
  });
}
