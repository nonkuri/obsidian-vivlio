import { isElement, SKIP, visit, type UElement, type UNode } from "../../util/tree";
import { warn, type BuildContext } from "../context";

/**
 * Take the executable parts out of a manuscript (SPEC 5.3).
 *
 * VFM runs `rehype-raw`, so any HTML a note contains arrives in the tree as
 * real elements rather than as text. That is what makes `<div class="...">`
 * and inline `<span>` work, and it is also how a `<script>` would arrive.
 *
 * Nothing downstream would stop it. Vivliostyle executes the scripts it finds
 * in a publication unless it is told not to - the plugin now tells it not to,
 * in `bookViewerUrl` - but an EPUB leaves this house entirely, and the reader
 * that opens it makes its own decision. A book is a static object; the
 * manuscript is not the place to write code, and a note that tries to is
 * either mistaken or hostile. Neither case is served by carrying it through.
 *
 * Obsidian's own reading view draws the same line. Until this ran, the
 * typesetting path was the more permissive of the two, which is the wrong way
 * round for the path that also writes files other people open.
 */

/** Elements that exist to run code or to host a document that can. */
const EXECUTABLE_TAGS = new Set(["script", "iframe", "object", "embed"]);

/**
 * Properties naming something the reader's software will follow or load.
 *
 * hast gives attributes their property names, so these are camelCased even
 * though the manuscript wrote them in lowercase.
 */
const URL_PROPERTIES = [
  "href",
  "src",
  "srcSet",
  "action",
  "formAction",
  "poster",
  "xlinkHref",
  "data",
  "background",
];

/**
 * Whether a URL is a way of writing code rather than of naming a resource.
 *
 * The scheme is compared with its whitespace and control characters removed,
 * because that is how a browser reads it: `java&#9;script:` is one word to
 * the parser that resolves the link, and would otherwise slip past a plain
 * `startsWith`.
 */
function isCodeUrl(value: string): boolean {
  const colon = value.indexOf(":");
  if (colon === -1) return false;
  const scheme = value
    .slice(0, colon + 1)
    // eslint-disable-next-line no-control-regex -- matching control characters is the point: a browser ignores them inside a scheme, so a check that does not would be looking at a different string than the one the link resolver sees.
    .replace(/[\s\u0000-\u001f]/g, "")
    .toLowerCase();
  if (scheme === "javascript:" || scheme === "vbscript:") return true;
  // A `data:` image is ordinary; a `data:` document is a script with a
  // costume on.
  return scheme === "data:" && /^data:\s*text\/html/i.test(value.replace(/\s/g, ""));
}

/** Strip the executable parts, and say so once per note that had any. */
export function sanitizePlugin(context: BuildContext, sourcePath: string) {
  return function attach() {
    return (tree: UNode): void => {
      let removed = 0;
      let disarmed = 0;

      visit(tree, (node, index, parent) => {
        if (!isElement(node)) return;

        if (EXECUTABLE_TAGS.has(node.tagName) && parent && Array.isArray(parent.children)) {
          parent.children.splice(index, 1);
          removed++;
          // The subtree goes with it; there is nothing left to walk.
          return SKIP;
        }

        disarmed += disarm(node);
      });

      if (removed > 0) {
        warn(context, {
          kind: "unsupported",
          message: `${removed} script or embedded-object element(s) removed; a book does not run code`,
          source: sourcePath,
        });
      }
      if (disarmed > 0) {
        warn(context, {
          kind: "unsupported",
          message: `${disarmed} event handler(s) or code URL(s) removed; a book does not run code`,
          source: sourcePath,
        });
      }
    };
  };
}

/** Drop this element's event handlers and code URLs. Returns how many. */
function disarm(node: UElement): number {
  const properties = node.properties;
  if (!properties || typeof properties !== "object") return 0;

  let count = 0;
  for (const name of Object.keys(properties)) {
    // `onClick`, `onload`, `onAnimationEnd`: every handler starts this way and
    // nothing a manuscript legitimately writes does.
    if (/^on/i.test(name)) {
      delete properties[name];
      count++;
    }
  }

  for (const name of URL_PROPERTIES) {
    const value = properties[name];
    if (typeof value === "string" && isCodeUrl(value)) {
      delete properties[name];
      count++;
    } else if (Array.isArray(value)) {
      const kept = value.filter((entry) => !(typeof entry === "string" && isCodeUrl(entry)));
      if (kept.length !== value.length) {
        count += value.length - kept.length;
        if (kept.length === 0) delete properties[name];
        else properties[name] = kept;
      }
    }
  }

  // `srcdoc` is a whole document written inline; there is no safe reading of
  // it here, and the element that carries it is removed above anyway.
  if (typeof properties.srcDoc === "string") {
    delete properties.srcDoc;
    count++;
  }

  return count;
}
