import GithubSlugger from "github-slugger";
import { warn, type BuildContext } from "../context";
import {
  element,
  isElement,
  replaceTextNodes,
  text,
  visit,
  type UElement,
  type UNode,
} from "../../util/tree";
import { decodeUrlPath } from "../../util/paths";
import { resolveVaultFile } from "./assets";

/** `[[Note]]`, `[[Note#Heading]]`, `[[Note|Alias]]`, `[[#Heading]]` */
const WIKILINK = /(?<!!)\[\[([^\]]+)\]\]/g;

/**
 * Resolve `[[links]]` (SPEC 5.3 #9).
 *
 * A link whose target is part of the book becomes a real cross-reference the
 * typesetter can resolve to a page number; a link pointing outside the book
 * would print as a dead reference, so it is flattened to plain text.
 */
export function linksPlugin(context: BuildContext, sourcePath: string) {
  return function attach() {
    return (tree: UNode): void => {
      if (context.config.syntax.wikilink) {
        replaceTextNodes(tree, {
          test: WIKILINK,
          replace: (match) => [wikilink(context, sourcePath, match[1])],
        });
      }
      rewriteMarkdownLinks(context, sourcePath, tree);
    };
  };
}

function wikilink(context: BuildContext, sourcePath: string, body: string): UNode {
  const [targetPart, aliasPart] = splitAlias(body);
  const [linkpath, heading] = splitHeading(targetPart);
  const label = aliasPart ?? (heading && !linkpath ? heading : linkpath || heading || body);

  // `[[#Heading]]` points inside the current note.
  if (!linkpath) {
    const slug = slugFor(context, sourcePath, heading);
    return anchor(`#${slug}`, label);
  }

  const file = context.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
  if (!file) {
    warn(context, { kind: "broken-link", message: `[[${body}]]`, source: sourcePath });
    return text(label);
  }

  const chapter = context.chapterByPath.get(file.path);
  if (!chapter) {
    // Outside the book: keep the words, drop the link (SPEC decision 13).
    return text(label);
  }

  const fragment = heading ? `#${slugFor(context, file.path, heading)}` : "";
  const href = chapter.file?.path === sourcePath && fragment ? fragment : `${chapter.docName}${fragment}`;
  return anchor(href, label);
}

/** Markdown links to notes inside the book become cross-references too. */
function rewriteMarkdownLinks(
  context: BuildContext,
  sourcePath: string,
  tree: UNode,
): void {
  visit(tree, (node) => {
    if (!isElement(node, "a")) return;
    const link = node as UElement;
    const href = String(link.properties.href ?? "");
    if (!href || /^[a-z]+:/i.test(href) || href.startsWith("#")) return;

    const decoded = decodeUrlPath(href);
    const [pathPart, fragment] = decoded.split("#");
    const file = resolveVaultFile(context, pathPart, sourcePath);
    if (!file || file.extension !== "md") return;

    const chapter = context.chapterByPath.get(file.path);
    if (!chapter) {
      link.properties.href = undefined;
      delete link.properties.href;
      return;
    }
    const slug = fragment ? `#${slugFor(context, file.path, fragment)}` : "";
    link.properties.href = `${chapter.docName}${slug}`;
  });
}

function anchor(href: string, label: string): UElement {
  return element("a", { href, className: ["vivlio-link"] }, [text(label)]);
}

function splitAlias(body: string): [string, string | null] {
  const index = body.indexOf("|");
  if (index === -1) return [body.trim(), null];
  return [body.slice(0, index).trim(), body.slice(index + 1).trim()];
}

function splitHeading(target: string): [string, string] {
  const index = target.indexOf("#");
  if (index === -1) return [target.trim(), ""];
  return [target.slice(0, index).trim(), target.slice(index + 1).replace(/^\^/, "").trim()];
}

/**
 * Heading id for a note, matching VFM's.
 *
 * VFM ids come from `github-slugger` walking the headings in order, so the
 * same slugger over the metadata cache reproduces them, duplicate-heading
 * suffixes and all.
 */
function slugFor(context: BuildContext, notePath: string, heading: string): string {
  if (!heading) return "";
  const entries = context.headings.get(notePath);
  if (entries) {
    const found = entries.find(
      (entry) => entry.text.toLowerCase() === heading.toLowerCase(),
    );
    if (found) return found.slug;
  }
  return new GithubSlugger().slug(heading);
}
