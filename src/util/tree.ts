/**
 * A tiny unist walker.
 *
 * VFM pins mdast/hast utility packages at versions that predate their ESM
 * rewrites; importing a second copy here would risk two incompatible
 * `unist-util-visit` generations in one bundle. Walking these trees is a few
 * lines, so the plugin does it itself.
 */

export interface UNode {
  type: string;
  children?: UNode[];
  [key: string]: unknown;
}

export interface UText extends UNode {
  type: "text";
  value: string;
}

export interface UElement extends UNode {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: UNode[];
}

export const SKIP = Symbol("skip");

export type Visitor = (
  node: UNode,
  index: number,
  parent: UNode | null,
) => void | typeof SKIP;

/** Depth-first walk. Return `SKIP` from the visitor to skip a subtree. */
export function visit(tree: UNode, visitor: Visitor): void {
  const walk = (node: UNode, index: number, parent: UNode | null): void => {
    if (visitor(node, index, parent) === SKIP) return;
    const children = node.children;
    if (!Array.isArray(children)) return;
    for (let i = 0; i < children.length; i++) {
      const before = children.length;
      walk(children[i], i, node);
      // A visitor may splice siblings in; keep the cursor on the same element.
      i += children.length - before;
    }
  };
  walk(tree, 0, null);
}

export function isElement(node: UNode | undefined, tagName?: string): node is UElement {
  if (!node || node.type !== "element") return false;
  return tagName === undefined || (node as UElement).tagName === tagName;
}

export function isText(node: UNode | undefined): node is UText {
  return !!node && node.type === "text";
}

/** Concatenated text content of a subtree. */
export function textContent(node: UNode): string {
  if (isText(node)) return node.value;
  const children = node.children;
  if (!Array.isArray(children)) return "";
  return children.map(textContent).join("");
}

export function element(
  tagName: string,
  properties: Record<string, unknown> = {},
  children: UNode[] = [],
): UElement {
  return { type: "element", tagName, properties, children };
}

export function text(value: string): UText {
  return { type: "text", value };
}

/** Raw HTML node (rehype-raw has already run by the time these are used). */
export function raw(value: string): UNode {
  return { type: "raw", value } as UNode;
}

export function addClass(node: UElement, ...names: string[]): void {
  const current = node.properties.className;
  const list = Array.isArray(current)
    ? [...(current as string[])]
    : typeof current === "string"
      ? current.split(/\s+/).filter(Boolean)
      : [];
  for (const name of names) if (!list.includes(name)) list.push(name);
  node.properties.className = list;
}

export function hasClass(node: UElement, name: string): boolean {
  const current = node.properties.className;
  if (Array.isArray(current)) return (current as string[]).includes(name);
  if (typeof current === "string") return current.split(/\s+/).includes(name);
  return false;
}

/**
 * Elements whose text must never be rewritten: code, of course, but also the
 * places where a replacement would produce invalid markup.
 *
 * VFM's own `replace` hook uses hast-util-find-and-replace's default ignore
 * list, which does *not* include `code` / `pre`; the plugin therefore runs its
 * own pass rather than passing rules to `replace`, so that the promise made in
 * SPEC 5.3 ("code blocks are structurally out of reach") actually holds.
 */
export const DEFAULT_IGNORED_TAGS = [
  "title",
  "script",
  "style",
  "svg",
  "math",
  "code",
  "pre",
  "kbd",
  "samp",
  "var",
  "textarea",
  "head",
  "rt",
  "rp",
];

export interface TextRule {
  /** Must carry the `g` flag. */
  test: RegExp;
  /** Return replacement nodes, or `null` to leave the match alone. */
  replace: (match: RegExpExecArray) => UNode[] | null;
  /** Extra tags to leave alone, on top of {@link DEFAULT_IGNORED_TAGS}. */
  ignoredTags?: string[];
  /** Skip an element and its subtree, e.g. one an earlier rule produced. */
  skipElement?: (node: UElement) => boolean;
}

/**
 * Apply one text rule across a tree, skipping ignored elements.
 *
 * Rules are applied one whole pass at a time, in order, so that a rule listed
 * earlier consumes its syntax before a later rule can see it (SPEC 5.3: the
 * emphasis-dot rule must run before the ruby rule).
 */
export function replaceTextNodes(tree: UNode, rule: TextRule): void {
  const ignoredTags = rule.ignoredTags
    ? [...DEFAULT_IGNORED_TAGS, ...rule.ignoredTags]
    : DEFAULT_IGNORED_TAGS;

  const walk = (node: UNode): void => {
    if (isElement(node)) {
      if (ignoredTags.includes(node.tagName)) return;
      if (rule.skipElement?.(node)) return;
    }
    const children = node.children;
    if (!Array.isArray(children)) return;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (isText(child)) {
        const replacement = applyRule(child.value, rule);
        if (replacement) {
          children.splice(i, 1, ...replacement);
          i += replacement.length - 1;
        }
      } else {
        walk(child);
      }
    }
  };
  walk(tree);
}

function applyRule(value: string, rule: TextRule): UNode[] | null {
  rule.test.lastIndex = 0;
  if (!rule.test.test(value)) return null;
  rule.test.lastIndex = 0;

  const out: UNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let changed = false;

  while ((match = rule.test.exec(value)) !== null) {
    // A zero-length match would loop forever.
    if (match[0].length === 0) {
      rule.test.lastIndex += 1;
      continue;
    }
    const nodes = rule.replace(match);
    if (!nodes) continue;
    changed = true;
    if (match.index > last) out.push(text(value.slice(last, match.index)));
    out.push(...nodes);
    last = match.index + match[0].length;
  }
  if (!changed) return null;
  if (last < value.length) out.push(text(value.slice(last)));
  return out;
}
