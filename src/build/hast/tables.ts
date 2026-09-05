import { t } from "../../i18n";
import { isElement, visit, type UNode } from "../../util/tree";
import { effectiveColumnCount } from "../columns";
import { warn, type BuildContext } from "../context";

/**
 * Warn when a paged multi-column body contains a table.
 *
 * A table has an intrinsic minimum width: CSS columns can narrow its
 * containing block, but cannot turn its cells into a different layout. Even
 * a small table can become unreadable through extreme wrapping, while a wide
 * one overflows the column and sometimes the sheet. Predicting that boundary
 * from text alone would depend on the font and the final page geometry, so
 * the structural combination is reported and left for the preview to judge.
 *
 * EPUB output deliberately resets the page columns to one, so it has no such
 * warning. One transformer is attached per source note and emits at most one
 * finding no matter how many tables the note contains.
 */
export function multicolTableWarningPlugin(context: BuildContext, source: string) {
  return function attach() {
    return (tree: UNode): void => {
      if (context.mode === "epub" || effectiveColumnCount(context.config) < 2) return;

      let hasTable = false;
      visit(tree, (node) => {
        if (isElement(node, "table")) hasTable = true;
      });
      if (!hasTable) return;

      warn(context, {
        kind: "multicol-table",
        message: t("warning.multicolTable", { path: source }),
        source,
      });
    };
  };
}
