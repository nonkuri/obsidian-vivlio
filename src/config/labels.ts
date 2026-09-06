import type { BookConfig, BookLabelOverrides, BookLabels } from "./types";

const JAPANESE_LABELS: BookLabels = {
  untitled: "無題",
  cover: "表紙",
  halfTitle: "半扉",
  titlePage: "扉",
  toc: "目次",
  authorRole: "著",
  translatorRole: "訳",
  copyrightPage: {
    heading: "著作権表示",
    by: "{author} 著",
    translatedBy: "{translator} 訳",
    published: "{date} 発行",
    publisher: "{publisher} 発行",
    publishedBy: "{date} {publisher} 発行",
  },
  colophon: {
    heading: "奥付",
    author: "著者",
    translator: "訳者",
    publisher: "発行所",
    printer: "印刷",
    issued: "{date}　発行",
    issuedEdition: "{date}　{version}発行",
  },
};

const ENGLISH_LABELS: BookLabels = {
  untitled: "Untitled",
  cover: "Cover",
  halfTitle: "Half title",
  titlePage: "Title page",
  toc: "Contents",
  authorRole: "written by",
  translatorRole: "translated by",
  copyrightPage: {
    heading: "Copyright page",
    by: "By {author}",
    translatedBy: "Translated by {translator}",
    published: "This edition published {date}",
    publisher: "Published by {publisher}",
    publishedBy: "This edition published {date} by {publisher}",
  },
  colophon: {
    heading: "Colophon",
    author: "Author",
    translator: "Translator",
    publisher: "Publisher",
    printer: "Printer",
    issued: "Published {date}",
    issuedEdition: "{version}, published {date}",
  },
};

/**
 * Generated book text follows the book, never the Obsidian interface.
 *
 * Japanese gets Japanese conventions; English is the safe fallback for the
 * other language tags the open `lang` field can carry. Returned objects are
 * copies so callers may safely hand them to a YAML serializer.
 */
export function defaultBookLabels(lang: string): BookLabels {
  const source = lang.trim().toLowerCase().startsWith("ja")
    ? JAPANESE_LABELS
    : ENGLISH_LABELS;
  return {
    ...source,
    copyrightPage: { ...source.copyrightPage },
    colophon: { ...source.colophon },
  };
}

/** Fill a book's partial YAML overrides from its language defaults. */
export function resolveBookLabels(
  config: Pick<BookConfig, "lang" | "labels">,
): BookLabels {
  const defaults = defaultBookLabels(config.lang);
  return {
    ...defaults,
    ...config.labels,
    copyrightPage: {
      ...defaults.copyrightPage,
      ...config.labels.copyrightPage,
    },
    colophon: {
      ...defaults.colophon,
      ...config.labels.colophon,
    },
  };
}

/** Apply the placeholders supported by publication-line labels. */
export function formatBookLabel(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{([^{}]+)\}/g, (match, key: string) => values[key] ?? match);
}

/** Deep-merge two YAML label layers. */
export function mergeBookLabelOverrides(
  base: BookLabelOverrides,
  next: BookLabelOverrides,
): BookLabelOverrides {
  return {
    ...base,
    ...next,
    copyrightPage:
      base.copyrightPage || next.copyrightPage
        ? { ...base.copyrightPage, ...next.copyrightPage }
        : undefined,
    colophon:
      base.colophon || next.colophon
        ? { ...base.colophon, ...next.colophon }
        : undefined,
  };
}
