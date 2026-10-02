import type { UNode } from "../../util/tree";

type Eat = (source: string) => (node: UNode) => UNode;
type Tokenizer = ((eat: Eat, value: string, silent?: boolean) => UNode | true | undefined) & {
  locator?: (value: string, from: number) => number;
};

/** Consume comments before VFM splits their newlines into break nodes.
 * Inline tokenization leaves fenced/inline code alone and also applies to
 * embedded notes parsed by the same processor. Source positions stay intact.
 */
export function commentsPlugin(this: {
  Parser: { prototype: { inlineTokenizers: Record<string, Tokenizer>; inlineMethods: string[] } };
}) {
  const parser = this.Parser.prototype;
  const tokenize: Tokenizer = (eat, value, silent) => {
    if (!value.startsWith("%%")) return;
    const end = value.indexOf("%%", 2);
    if (end === -1) return;
    if (silent) return true;
    return eat(value.slice(0, end + 2))({ type: "text", value: "" });
  };
  tokenize.locator = (value, from) => value.indexOf("%%", from);
  parser.inlineTokenizers.vivlioComment = tokenize;
  parser.inlineMethods.splice(parser.inlineMethods.indexOf("text"), 0, "vivlioComment");
}
