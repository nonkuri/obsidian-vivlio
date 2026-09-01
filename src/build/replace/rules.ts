import type { BookConfig } from "../../config/types";
import {
  element,
  hasClass,
  text,
  type TextRule,
  type UElement,
  type UNode,
} from "../../util/tree";

/**
 * Text-level notation rules (SPEC 5.3, stages 3-7 and 13-14).
 *
 * They run as one rehype pass per rule, in this order, so a rule listed
 * earlier consumes its syntax before a later one can see it - which is what
 * keeps `《《emphasis》》` from being mistaken for a ruby annotation.
 *
 * Unlike VFM's own `replace` hook, this pass skips `<code>` and `<pre>`
 * (see DEFAULT_IGNORED_TAGS), so nothing here can reach into a code block.
 */
export function notationRules(config: BookConfig): TextRule[] {
  const rules: TextRule[] = [];
  const syntax = config.syntax;

  // #3 Kakuyomu-style emphasis dots. Must precede the ruby rule.
  if (syntax.boten) {
    rules.push({
      test: /《《([^》]+)》》/g,
      replace: (match) => [span("boten", match[1])],
    });
  }

  // #4 Aozora / Kakuyomu ruby: ｜kanji《kana》 (the marker may be escaped).
  if (syntax.aozoraRuby) {
    rules.push({
      test: /(?:\\\||[|｜])([^|｜《》\n]+)《([^》\n]+)》/g,
      replace: (match) => [ruby(match[1], match[2])],
    });
  }

  // #5 Explicit tate-chu-yoko.
  if (syntax.tcy) {
    rules.push({
      test: /\^\^([^^\n]{1,4})\^\^/g,
      replace: (match) => [span("tcy", match[1])],
    });
  }

  // #6 Two-digit numbers become tate-chu-yoko in vertical writing.
  if (syntax.autoTcy && config.autoTcy && config.writingMode === "vertical-rl") {
    rules.push({
      test: /(?<![\p{Nd}A-Za-z.,:%-])(\d{2})(?![\p{Nd}A-Za-z.,:%-])/gu,
      replace: (match) => [span("tcy", match[1])],
      // Numbers inside a ruby reading, a link URL or an already-converted span
      // must stay as they are.
      ignoredTags: ["a", "time"],
      skipElement: (node: UElement) => hasClass(node, "tcy"),
    });
  }

  // #7 ==highlight==, in one of four modes.
  if (syntax.highlight && config.highlight !== "off") {
    rules.push({
      test: /==([^=\n]+)==/g,
      replace: (match) => [highlight(config.highlight, match[1])],
    });
  } else if (syntax.highlight) {
    rules.push({
      test: /==([^=\n]+)==/g,
      replace: (match) => [text(match[1])],
    });
  }

  // #13 %%comments%% are editorial notes and never belong in a book.
  if (syntax.stripComments) {
    rules.push({
      test: /%%[\s\S]*?%%/g,
      replace: () => [],
    });
  }

  // #14 ^block-ids are anchors for Obsidian, not content.
  if (syntax.stripBlockIds) {
    rules.push({
      test: /[ \t]*\^[A-Za-z0-9][A-Za-z0-9-]{0,63}(?=\n|$)/g,
      replace: () => [],
    });
  }

  return rules;
}

function span(className: string, value: string): UElement {
  return element("span", { className: [className] }, [text(value)]);
}

function ruby(base: string, reading: string): UElement {
  return element("ruby", {}, [
    text(base),
    element("rp", {}, [text("(")]),
    element("rt", {}, [text(reading)]),
    element("rp", {}, [text(")")]),
  ]);
}

/**
 * `==highlight==` in four modes (SPEC 5.3).
 *
 * The default is emphasis dots: a yellow ground reads as a highlighter pen on
 * screen but not as a book, and `boten` shares its class with the Kakuyomu
 * notation so the theme only has to style one thing.
 */
function highlight(mode: BookConfig["highlight"], value: string): UNode {
  switch (mode) {
    case "strong":
      return element("strong", {}, [text(value)]);
    case "mark":
      return element("mark", {}, [text(value)]);
    case "boten":
    default:
      return span("boten", value);
  }
}
