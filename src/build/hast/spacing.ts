import { addClass, isElement, visit, type UElement, type UNode } from "../../util/tree";

/**
 * Blank lines the manuscript left between blocks (SPEC 5.3 #18).
 *
 * Markdown throws them away: one blank line ends a paragraph and any further
 * ones mean nothing to the parser. A novel means something by them - a run of
 * blank lines is how a scene break is written - so they are counted back off
 * the source positions the parser recorded, and become real space in the book.
 *
 * One blank line separates paragraphs and a second is slack; every one after
 * that is a blank line on the page. Three in the manuscript is one in the book,
 * which is what a writer who leaves a gap is asking for.
 */

/** Blank lines that carry no meaning: the paragraph break, and one to spare. */
const FREE_BLANK_LINES = 2;

/** The class that opens the gap, and the custom property that sizes it. */
export const BLANK_LINES_CLASS = "vivlio-blank-lines";

interface Positioned {
  position?: { start?: { line?: number }; end?: { line?: number } };
}

export function blankLinesPlugin() {
  return function attach() {
    return (tree: UNode): void => {
      visit(tree, (node) => {
        const children = (node as UElement).children;
        if (!Array.isArray(children)) return;

        let previous: UElement | null = null;
        for (const child of children) {
          if (!isElement(child)) continue;
          const element = child;
          const blank = previous ? blankLinesBetween(previous, element) : 0;
          if (blank > FREE_BLANK_LINES) space(element, blank - FREE_BLANK_LINES);
          previous = element;
        }
      });
    };
  };
}

/** How many wholly blank lines the source has between two blocks. */
function blankLinesBetween(previous: UElement, next: UElement): number {
  const end = (previous as Positioned).position?.end?.line;
  const start = (next as Positioned).position?.start?.line;
  if (typeof end !== "number" || typeof start !== "number") return 0;
  return start - end - 1;
}

/**
 * Ask for `lines` blank lines before this block.
 *
 * As a margin rather than as empty blocks: an empty block of no height can be
 * placed without consuming any of the page, which the typesetter never
 * finishes composing (see liftPageBreaks), and a margin at the top of a page
 * is dropped, which is what a gap should do there anyway.
 */
function space(element: UElement, lines: number): void {
  addClass(element, BLANK_LINES_CLASS);
  const existing = typeof element.properties.style === "string" ? element.properties.style : "";
  element.properties.style = `${existing}${existing ? "; " : ""}--vivlio-blank-lines: ${lines}`;
}
