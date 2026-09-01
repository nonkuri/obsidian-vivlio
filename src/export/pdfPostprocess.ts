import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  type PDFContext,
} from "pdf-lib";
import type { BookConfig } from "../config/types";
import type { ViewerTocItem } from "./pdf";
import { log } from "../util/log";

export type PageClass = "cover" | "front" | "body";

export interface PostprocessOptions {
  config: BookConfig;
  toc: ViewerTocItem[];
  /** Element id -> zero-based page index, measured in the laid-out document. */
  anchorPages: Record<string, number>;
  /** One entry per page, in order. */
  pageClasses: PageClass[];
  metadata: boolean;
  outline: boolean;
  pageLabels: boolean;
}

/**
 * Finish the PDF: document metadata, bookmarks and page labels.
 *
 * Chromium writes none of these, so they are added afterwards with pdf-lib,
 * the same way vivliostyle-cli does (SPEC 2.5, 5.11).
 */
export async function postprocessPdf(
  bytes: Uint8Array,
  options: PostprocessOptions,
): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes);

  if (options.metadata) applyMetadata(document, options.config);
  if (options.outline) {
    try {
      applyOutline(document, options.toc, options.anchorPages);
    } catch (error) {
      log.error("could not write the PDF outline", error);
    }
  }
  if (options.pageLabels) {
    try {
      applyPageLabels(document, options.pageClasses);
    } catch (error) {
      log.error("could not write PDF page labels", error);
    }
  }

  return document.save({ useObjectStreams: false });
}

function applyMetadata(document: PDFDocument, config: BookConfig): void {
  if (config.title) document.setTitle(config.title);
  if (config.author) document.setAuthor(config.author);
  if (config.subtitle) document.setSubject(config.subtitle);
  if (config.publisher) document.setCreator(config.publisher);
  if (config.lang) document.setLanguage(config.lang);
  document.setProducer("Vivlio for Obsidian (Vivliostyle)");

  const date = config.date ? new Date(config.date) : null;
  if (date && !Number.isNaN(date.getTime())) document.setCreationDate(date);
}

/**
 * Bookmarks from the viewer's table of contents.
 *
 * The viewer reports entries as `chapter.html#anchor`; the anchor is looked up
 * in the page map measured on the laid-out document, so a bookmark points at
 * the page the heading actually fell on.
 */
function applyOutline(
  document: PDFDocument,
  toc: ViewerTocItem[],
  anchorPages: Record<string, number>,
): void {
  const entries = toc.filter((item) => (item.title ?? "").trim().length > 0);
  if (entries.length === 0) return;

  const context = document.context;
  const pages = document.getPages();
  if (pages.length === 0) return;

  const pageRefFor = (href: string | undefined): PDFRef => {
    const fragment = href?.split("#")[1];
    const index = fragment !== undefined ? anchorPages[fragment] : undefined;
    const clamped = Math.max(0, Math.min(pages.length - 1, index ?? 0));
    return pages[clamped].ref;
  };

  const outlinesRef = context.nextRef();

  const build = (items: ViewerTocItem[], parent: PDFRef): { first: PDFRef; last: PDFRef; count: number } | null => {
    const refs = items.map(() => context.nextRef());
    if (refs.length === 0) return null;

    let total = 0;
    items.forEach((item, index) => {
      const children = build(item.children ?? [], refs[index]);
      const dict = context.obj({
        Title: PDFHexString.fromText(item.title ?? ""),
        Parent: parent,
        Dest: context.obj([pageRefFor(item.href), PDFName.of("XYZ"), null, null, null]),
      }) as PDFDict;

      if (index > 0) dict.set(PDFName.of("Prev"), refs[index - 1]);
      if (index < refs.length - 1) dict.set(PDFName.of("Next"), refs[index + 1]);
      if (children) {
        dict.set(PDFName.of("First"), children.first);
        dict.set(PDFName.of("Last"), children.last);
        // A negative count means the branch starts collapsed.
        dict.set(PDFName.of("Count"), PDFNumber.of(-children.count));
      }
      context.assign(refs[index], dict);
      total += 1 + (children?.count ?? 0);
    });

    return { first: refs[0], last: refs[refs.length - 1], count: total };
  };

  const root = build(entries, outlinesRef);
  if (!root) return;

  context.assign(
    outlinesRef,
    context.obj({
      Type: "Outlines",
      First: root.first,
      Last: root.last,
      Count: PDFNumber.of(root.count),
    }) as PDFDict,
  );
  document.catalog.set(PDFName.of("Outlines"), outlinesRef);
}

/**
 * `/PageLabels`, so a reader shows `i, ii, iii, 1, 2 ...` in its page box.
 *
 * The numbering on the paper comes from the stylesheet; without this the
 * viewer's own counter disagrees with it (SPEC 5.11).
 */
function applyPageLabels(document: PDFDocument, classes: PageClass[]): void {
  if (classes.length === 0) return;
  const context: PDFContext = document.context;

  const nums: (PDFNumber | PDFDict)[] = [];
  let index = 0;
  while (index < classes.length) {
    const kind = classes[index];
    const start = index;
    while (index < classes.length && classes[index] === kind) index += 1;

    nums.push(PDFNumber.of(start));
    nums.push(labelDict(context, kind));
  }

  const array = PDFArray.withContext(context);
  for (const entry of nums) array.push(entry);

  const labels = context.obj({}) as PDFDict;
  labels.set(PDFName.of("Nums"), array);
  document.catalog.set(PDFName.of("PageLabels"), context.register(labels));
}

function labelDict(context: PDFContext, kind: PageClass): PDFDict {
  const dict = context.obj({}) as PDFDict;
  if (kind === "cover") {
    // No numbering style: the cover is not a numbered page.
    dict.set(PDFName.of("P"), PDFHexString.fromText("Cover"));
    return dict;
  }
  dict.set(PDFName.of("S"), PDFName.of(kind === "front" ? "r" : "D"));
  dict.set(PDFName.of("St"), PDFNumber.of(1));
  return dict;
}
