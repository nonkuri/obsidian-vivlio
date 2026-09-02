import {
  readMetadata,
  VFM,
  type Metadata,
  type StringifyMarkdownOptions,
} from "@vivliostyle/vfm";
import type { TFile } from "obsidian";
import { warn, type BuildContext, type Chapter } from "./context";
import { vivlioFrontmatterKeys } from "../config/resolve";
import { embedPlugin } from "./mdast/embed";
import { dynamicRenderPlugin } from "./mdast/render";
import { notationRules } from "./replace/rules";
import { assetsPlugin } from "./hast/assets";
import { linksPlugin } from "./hast/links";
import { obsidianPlugin } from "./hast/obsidian";
import {
  addClass,
  element,
  isElement,
  replaceTextNodes,
  visit,
  type UElement,
  type UNode,
} from "../util/tree";
import { DOCUMENT_ANCHOR } from "./toc";
import { t } from "../i18n";
import { log } from "../util/log";

/** Stylesheet every generated document links to. */
export const BOOK_STYLESHEET = "vivlio.css";

/**
 * Convert one note to a document (SPEC 5.3).
 *
 * All Obsidian-specific handling rides on VFM's two extension hooks rather
 * than on string preprocessing: `editPlugins` head-prepends the two stages
 * that must read other files, and tail-appends the tree rewrites. Nothing
 * touches the Markdown source as text, so code blocks stay untouched by
 * construction.
 */
export async function convertChapter(
  context: BuildContext,
  chapter: Chapter,
  file: TFile,
  markdown: string,
): Promise<string> {
  const metadata = buildMetadata(context, chapter, markdown);
  const rules = notationRules(context.config);

  const processor = VFM(
    {
      style: [BOOK_STYLESHEET],
      title: chapter.title,
      language: context.config.lang,
      footnote: context.config.footnote,
      ...(context.config.vfm as Record<string, never>),
      // The hook is typed against unified's own plugin types; the plugins
      // below are plain transformers, which those types cannot express here.
      editPlugins: (plugins) =>
        ({
        mdastPlugins: [
          // Head: stages that need to read other files (SPEC 5.3 #1, #2).
          ...(context.config.syntax.embed ? [embedPlugin(context, file.path)] : []),
          ...(context.config.syntax.dynamic
            ? [dynamicRenderPlugin(context, file.path)]
            : []),
          ...plugins.mdastPlugins,
        ],
        mdastToHastHandlers: plugins.mdastToHastHandlers,
        hastPlugins: [
          ...plugins.hastPlugins,
          // Tail: the tree rewrites of SPEC 5.3.
          //
          // Link syntax is consumed before the text-level notations, not
          // after as the table in 5.3 lists them: `[[02]]` would otherwise be
          // torn in half by the automatic tate-chu-yoko rule, which sees a
          // two-digit number and knows nothing about the brackets around it.
          // Running links first also means a notation inside a link label
          // still works.
          assetsPlugin(context, file.path),
          linksPlugin(context, file.path),
          obsidianPlugin(context),
          notationPlugin(rules),
          documentShapePlugin(chapter),
        ],
      }) as unknown as ReturnType<NonNullable<StringifyMarkdownOptions["editPlugins"]>>,
    },
    metadata,
  );

  try {
    const vfile = await processor.process(markdown);
    return String(vfile);
  } catch (error) {
    log.error(`failed to convert ${file.path}`, error);
    warn(context, {
      kind: "chapter-error",
      message: `${file.path}: ${errorMessage(error)}`,
      source: file.path,
    });
    return errorDocument(chapter, file.path, error);
  }
}

function buildMetadata(
  context: BuildContext,
  chapter: Chapter,
  markdown: string,
): Metadata {
  // The plugin's own frontmatter keys are declared as custom so VFM does not
  // turn them into <meta> tags (SPEC 5.4).
  const metadata = readMetadata(markdown, vivlioFrontmatterKeys());
  metadata.title = chapter.title || metadata.title;
  metadata.lang = context.config.lang || metadata.lang;

  const classes = [chapter.isFrontMatter ? "vivlio-front-matter" : "", "vivlio-doc"]
    .filter(Boolean)
    .join(" ");
  metadata.class = [metadata.class, classes].filter(Boolean).join(" ");
  return metadata;
}

/** Applies the text-level notation rules, one full pass per rule. */
function notationPlugin(rules: ReturnType<typeof notationRules>) {
  return function attach() {
    return (tree: UNode): void => {
      for (const rule of rules) replaceTextNodes(tree, rule);
      dropEmptyParagraphs(tree);
    };
  };
}

/**
 * Remove paragraphs the notation rules emptied.
 *
 * A line holding only a block id or a comment is not content; leaving the
 * paragraph behind would print as a blank line in the book.
 */
function dropEmptyParagraphs(tree: UNode): void {
  visit(tree, (node, index, parent) => {
    if (!parent || !Array.isArray(parent.children)) return;
    if (!isElement(node, "p")) return;
    const element = node as UElement;
    const hasContent = (element.children ?? []).some((child) =>
      child.type === "text"
        ? String((child as { value?: unknown }).value ?? "").trim() !== ""
        : true,
    );
    if (!hasContent) parent.children.splice(index, 1);
  });
}

/**
 * Give the document the shape the theme expects (SPEC 5.9, 5.11).
 *
 * theme-base keys its page design off DPUB-ARIA roles, so tagging the
 * outermost section with `role="doc-preface"` and friends is all it takes to
 * get the right named page; the two parts with no DPUB role (title page and
 * half title) get a class instead.
 */
function documentShapePlugin(chapter: Chapter) {
  return function attach() {
    return (tree: UNode): void => {
      const body = findBody(tree);
      if (!body) return;

      let host = (body.children ?? []).find((child) => isElement(child, "section")) as
        | UElement
        | undefined;

      if (!host) {
        host = element("section", {}, body.children ?? []);
        body.children = [host];
      }

      // Something for a table-of-contents entry to point at, so a part with
      // no headings still resolves to a page number.
      if (!host.properties.id) host.properties.id = DOCUMENT_ANCHOR;
      if (chapter.role) host.properties.role = chapter.role;
      if (chapter.slot === "titlePage") addClass(host, "titlepage");
      if (chapter.slot === "halfTitle") addClass(host, "halftitle");
      // Marks the pages that get roman numerals; read back after layout to
      // write /PageLabels (SPEC 5.11).
      if (chapter.isFrontMatter) addClass(host, "vivlio-front");

      // Restart the page counter on the first body chapter so front matter can
      // carry roman numerals (SPEC 5.11).
      if (chapter.startPage !== undefined) addClass(host, "vivlio-page-reset");
    };
  };
}

function findBody(tree: UNode): UElement | null {
  let body: UElement | null = null;
  visit(tree, (node) => {
    if (!body && isElement(node, "body")) body = node as UElement;
  });
  return body;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** A chapter that failed to convert becomes a visible page, not a hole. */
export function errorDocument(chapter: Chapter, path: string, error: unknown): string {
  const message = escapeHtml(errorMessage(error));
  return `<!doctype html>
<html lang="ja" class="vivlio-doc">
<head>
<meta charset="utf-8">
<title>${escapeHtml(chapter.title)}</title>
<link rel="stylesheet" type="text/css" href="${BOOK_STYLESHEET}">
</head>
<body>
<section>
<h1>${escapeHtml(chapter.title)}</h1>
<div class="vivlio-error">
<p>${escapeHtml(t("error.chapter"))}</p>
<p><code>${escapeHtml(path)}</code></p>
<pre>${message}</pre>
</div>
</section>
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
