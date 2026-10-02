import { visit, type UNode } from "../../util/tree";

/** mdast-util-to-hast trims all Unicode whitespace after a `break`, including
 * authored Japanese indentation. Emit the same HTML through a raw node so
 * only ordinary HTML whitespace is collapsed. Run after VFM's mdast plugins.
 */
export function preserveBreakIndentPlugin() {
  return (tree: UNode): void => {
    visit(tree, (node) => {
      if (node.type !== "break") return;
      node.type = "html";
      node.value = "<br>\n";
    });
  };
}
