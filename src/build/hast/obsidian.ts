import type { BuildContext } from "../context";
import {
  addClass,
  element,
  isElement,
  isText,
  replaceTextNodes,
  text,
  visit,
  type UElement,
  type UNode,
} from "../../util/tree";

/** `> [!note] Title` — the type, an optional fold marker, and the title. */
const CALLOUT = /^\[!([\w-]+)\]([+-])?[ \t]*(.*)$/;

/** `#tag`, `#nested/tag`. Not `#` in a URL and not a heading marker. */
const TAG = /(?<![\w#/&])#([\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu;

/**
 * Obsidian's block-level notations (SPEC 5.3 #10-#12).
 *
 * Callouts and task lists are kept, because a printed book can carry both;
 * tags are editorial metadata and are dropped unless asked for.
 */
export function obsidianPlugin(context: BuildContext) {
  return function attach() {
    return (tree: UNode): void => {
      if (context.config.syntax.callout) convertCallouts(tree);
      if (context.config.syntax.taskList) {
        convertTaskLists(tree);
        markTaskListContainers(tree);
      }
      convertTags(context, tree);
    };
  };
}

function convertCallouts(tree: UNode): void {
  visit(tree, (node, index, parent) => {
    if (!isElement(node, "blockquote") || !parent || !Array.isArray(parent.children)) return;

    const paragraph = (node.children ?? []).find((child) => isElement(child, "p")) as
      | UElement
      | undefined;
    if (!paragraph) return;

    // VFM pretty-prints the document before this runs, so the marker is not
    // necessarily the paragraph's first node - the first node with text is.
    const first = paragraph.children.find(
      (child) => isText(child) && child.value.trim() !== "",
    );
    if (!isText(first)) return;

    const leading = first.value.length - first.value.trimStart().length;
    const marker = first.value.slice(leading);
    const newline = marker.indexOf("\n");
    const firstLine = newline === -1 ? marker : marker.slice(0, newline);
    const match = firstLine.match(CALLOUT);
    if (!match) return;

    const type = match[1].toLowerCase();
    const title = match[3].trim() || defaultTitle(type);

    // Drop the marker line, keeping whatever followed it in the paragraph.
    const rest = newline === -1 ? "" : marker.slice(newline + 1);
    if (rest.trim()) first.value = rest.replace(/^\n+/, "");
    else paragraph.children.splice(paragraph.children.indexOf(first), 1);

    const body = (node.children ?? []).filter(
      (child) => child !== paragraph || paragraph.children.length > 0,
    );

    const aside = element(
      "aside",
      { className: ["callout", `callout-${type}`], "data-callout": type },
      [
        element("p", { className: ["callout-title"] }, [text(title)]),
        ...body,
      ],
    );
    parent.children[index] = aside;
  });
}

function defaultTitle(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * Task lists become a plain list carrying `data-checked`; the box glyph comes
 * from `::marker` in the generated stylesheet, so no form control ends up in
 * the PDF.
 */
function convertTaskLists(tree: UNode): void {
  visit(tree, (node) => {
    if (!isElement(node, "li")) return;
    const item = node as UElement;

    const checkbox = findCheckbox(item);
    if (checkbox) {
      checkbox.parent.children = checkbox.parent.children.filter(
        (child) => child !== checkbox.node,
      );
      addClass(item, "task-list-item");
      item.properties["data-checked"] = checkbox.checked ? "true" : "false";
      return;
    }

    // Fallback for parsers that leave the marker as text.
    const paragraph = isElement(item.children[0], "p")
      ? (item.children[0] as UElement)
      : item;
    const first = paragraph.children[0];
    if (!isText(first)) return;
    const match = first.value.match(/^\[( |x|X)\]\s+/);
    if (!match) return;
    first.value = first.value.slice(match[0].length);
    addClass(item, "task-list-item");
    item.properties["data-checked"] = match[1] === " " ? "false" : "true";
  });
}

interface CheckboxHit {
  node: UNode;
  parent: UElement;
  checked: boolean;
}

function findCheckbox(item: UElement): CheckboxHit | null {
  let hit: CheckboxHit | null = null;
  visit(item, (node, _index, parent) => {
    if (hit || !isElement(node, "input")) return;
    const input = node as UElement;
    if (String(input.properties.type ?? "").toLowerCase() !== "checkbox") return;
    hit = {
      node,
      parent: (parent as UElement | null) ?? item,
      checked: Boolean(input.properties.checked),
    };
  });
  return hit;
}

function convertTags(context: BuildContext, tree: UNode): void {
  const keep = context.config.syntax.keepTags;
  replaceTextNodes(tree, {
    test: TAG,
    replace: (match) =>
      keep ? [element("span", { className: ["tag"] }, [text(`#${match[1]}`)])] : [],
    ignoredTags: ["a"],
  });
}

/** Task lists sit in a `<ul>`; mark it so the stylesheet can drop the bullets. */
function markTaskListContainers(tree: UNode): void {
  visit(tree, (node) => {
    if (!isElement(node, "ul") && !isElement(node, "ol")) return;
    const list = node as UElement;
    const hasTasks = (list.children ?? []).some(
      (child) => isElement(child, "li") && "data-checked" in (child as UElement).properties,
    );
    if (hasTasks) addClass(list, "task-list");
  });
}
