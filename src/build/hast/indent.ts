import type { IndentMode } from "../../config/types";
import {
  addClass,
  isElement,
  textContent,
  visit,
  type UElement,
  type UNode,
} from "../../util/tree";

/**
 * The first-line indent (SPEC 5.3 #16).
 *
 * A Japanese paragraph is indented by one character, and a line opening with
 * 「 is not: the bracket is drawn in the right half of its em box, so the empty
 * half already reads as the indent. Which paragraphs are which is a question
 * the manuscript usually answers itself, by starting the indented ones with an
 * ideographic space - and by default the manuscript's answer is the one used.
 * A rule of our own is for the manuscripts that do not answer, and
 * `paragraphIndentMode` is for the writers who would rather say outright.
 *
 * Two passes, because the space has to be read before `stripLeadingSpace`
 * (#15) removes it and the bracket after the notation rules have run - a
 * paragraph opening with `《《傍点》》` starts with a bracket only until the
 * emphasis mark is consumed.
 */

/** Paragraphs that must not take the first-line indent. */
export const NO_INDENT_CLASS = "vivlio-no-indent";

/** Records, before #15 strips it, that the manuscript indented a paragraph. */
const MANUSCRIPT_INDENT = "data-vivlio-indented";

/**
 * Opening brackets, as JIS X 4051 counts them (始め括弧類).
 *
 * Only the marks Japanese setting uses: an English paragraph opening with `"`
 * is indented like any other, which is what an English book does.
 */
const OPENING_BRACKETS = new Set([..."「『（〈《【〔［｛〖〘〚｟〝“‘"]);

/**
 * IDEOGRAPHIC SPACE, and only that.
 *
 * An ASCII space at the start of a paragraph is far more often a typing slip
 * than a decision, and reading it as one would take the indent off every other
 * paragraph in the note.
 */
const IDEOGRAPHIC_SPACE = "　";

/** First pass: note which paragraphs the manuscript indented itself. */
export function readManuscriptIndentPlugin() {
  return function attach() {
    return (tree: UNode): void => {
      visit(tree, (node) => {
        if (!isElement(node, "p")) return;
        if (!textContent(node).startsWith(IDEOGRAPHIC_SPACE)) return;
        (node).properties[MANUSCRIPT_INDENT] = "";
      });
    };
  };
}

/**
 * Second pass: settle the indent, and clear the marker.
 *
 * Under `auto`, a note that indents any paragraph with an ideographic space is
 * taken to indent every paragraph it means to, so the ones it left flush - the
 * dialogue, usually - are set flush; a note that never does gets the bracket
 * rule instead, because then nothing else says which paragraphs are dialogue.
 * The other modes settle on one of those answers whatever the note looks like.
 */
export function applyIndentPlugin(mode: IndentMode) {
  return function attach() {
    return (tree: UNode): void => {
      const paragraphs: UElement[] = [];
      visit(tree, (node) => {
        if (isElement(node, "p")) paragraphs.push(node);
      });

      const followManuscript =
        mode === "manuscript" ||
        (mode === "auto" &&
          paragraphs.some(
            (paragraph) => paragraph.properties[MANUSCRIPT_INDENT] !== undefined,
          ));

      for (const paragraph of paragraphs) {
        const own = paragraph.properties[MANUSCRIPT_INDENT] !== undefined;
        delete paragraph.properties[MANUSCRIPT_INDENT];
        if (mode === "all") continue;

        const flush = followManuscript
          ? !own
          : OPENING_BRACKETS.has(textContent(paragraph).trimStart().charAt(0));
        if (flush) addClass(paragraph, NO_INDENT_CLASS);
      }
    };
  };
}
