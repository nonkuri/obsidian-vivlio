import { addClass, element, hasClass, isElement, isText, SKIP, text, textContent, visit, type UNode, type UElement } from "../../util/tree";
import { warn, type BuildContext } from "../context";
import { PAGE_BREAK_CLASS } from "../replace/rules";
import { BUNDLED_THEME_GRIDS } from "../../vendor/assets";
import { t } from "../../i18n";
import { copySourceProperties } from "../sourceMap";

/** One callout is one work, independently of the selected layout. */
export function verseElement(kind: string, preface: string, children: UNode[]): UElement {
  const body = children.filter(child => !isText(child) || child.value.trim() !== "");
  const last = body.at(-1);
  let author: UElement | undefined;
  if (isElement(last, "p")) {
    const first = last.children.find(child => !isText(child) || child.value.trim() !== "");
    if (isText(first) && /^作者[：:][ \t]*/.test(first.value)) {
      first.value = first.value.replace(/^作者[：:][ \t]*/, "");
      author = element("p", { className: ["vivlio-verse-author"] }, last.children);
      copySourceProperties(last.properties, author.properties);
      body.pop();
    }
  }
  return element("div", { className: ["vivlio-verse"], "data-verse": kind }, [
    ...(preface ? [element("p", { className: ["vivlio-verse-preface"] }, [text(preface)])] : []),
    element("div", { className: ["vivlio-verse-text"] }, body),
    ...(author ? [author] : []),
  ]);
}

/** Page groups are a print instruction, not an authoring boundary. A heading,
 * prose, or explicit page break always ends the current group. */
export function versePagesPlugin(context: BuildContext, source: string) {
  return function attach() {
    return (tree: UNode): void => {
      visit(tree, node => {
        if (!isElement(node) || !hasClass(node, "vivlio-verse")) return;
        const body = node.children.find(child => isElement(child) && hasClass(child, "vivlio-verse-text"));
        if (!body || !textContent(body).trim()) {
          warn(context, { kind: "config", source, message: t("warning.verseEmpty") });
        }
      });
      if (context.mode === "epub") return;
      const grid = BUNDLED_THEME_GRIDS[context.config.theme];
      const chars = context.config.charsPerLine || grid?.chars || 34;
      const lines = context.config.linesPerPage || grid?.lines || 12;
      const countPerPage = context.config.versePerPage;
      visit(tree, node => {
        if (isElement(node) && (hasClass(node, "vivlio-verse") || hasClass(node, "vivlio-verse-page"))) return SKIP;
        if (!node.children?.some(child => isElement(child) && hasClass(child, "vivlio-verse"))) return;
        const output: UNode[] = [];
        let group: UElement | undefined;
        let count = 0;
        for (const child of node.children) {
          if (isElement(child) && hasClass(child, "vivlio-verse")) {
            // Conservative text estimate only: actual shaping belongs to the
            // viewer. Long prose or many authored lines must not be squeezed
            // into a short-poem slot. Never truncate or shrink the source.
            let estimatedLines = 0;
            visit(child, part => {
              if (!isElement(part, "p")) return;
              const plain = (item: UNode): string => isElement(item, "rt") || isElement(item, "rp") ? "" : isElement(item, "br") ? "\n" : isText(item) ? item.value.replace(/\n/g, "") : (item.children ?? []).map(plain).join("");
              estimatedLines += plain(part).split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil([...line.trim()].length / chars)), 0);
            });
            const long = estimatedLines > Math.max(1, Math.floor(lines / countPerPage) - 1);
            if (long) {
              addClass(child, "vivlio-verse-long");
              warn(context, { kind: "unsupported", source, message: t("warning.verseLong", { text: textContent(child).trim().slice(0, 40) }) });
            }
            if (!group || count === countPerPage || long || hasClass(child, PAGE_BREAK_CLASS)) {
              group = element("div", { className: ["vivlio-verse-page"] }, []);
              // A sequence heading belongs with its opening works, not on an
              // accidental empty divider. Keep the original heading and id.
              const poetryTheme = ["haiku", "tanka"].includes(context.config.theme);
              let previous = output.length - 1;
              while (previous >= 0 && isText(output[previous]) && !textContent(output[previous]).trim()) previous--;
              const heading = output[previous];
              if (poetryTheme && isElement(heading) && /^h[1-6]$/.test(heading.tagName) && !hasClass(heading, "vivlio-chapter-title")) {
                output.splice(previous, 1);
                addClass(group, "vivlio-verse-sequence");
                group.children.push(heading);
              }
              output.push(group);
              count = 0;
            }
            group.children.push(child);
            count++;
            if (long) group = undefined;
          } else if (isText(child) && child.value.trim() === "") {
            output.push(child);
          } else {
            group = undefined;
            output.push(child);
          }
        }
        node.children = output;
      });
    };
  };
}
