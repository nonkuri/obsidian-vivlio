import { BOOK_STYLESHEET, escapeHtml } from "./vfm";

export interface DocumentOptions {
  lang: string;
  title: string;
  /** Class on `<html>`; front matter carries `vivlio-front-matter`. */
  rootClass?: string;
  /**
   * How the book is set, as a class the theme can select on.
   *
   * Some decisions genuinely differ between the two and no logical property
   * spans them: a colophon belongs at the foot of the *outer* edge in
   * vertical writing, which is the inline end, and at the foot of the inner
   * edge in horizontal, which is the inline start. One rule cannot say both.
   */
  writingMode?: string;
  body: string;
}

/**
 * Wrap generated markup in a document shaped like VFM's output, so generated
 * parts (cover, title page, table of contents, colophon) and converted
 * chapters are indistinguishable to the typesetter.
 */
/**
 * The class saying how the book is set.
 *
 * Both kinds of document carry it - the ones built here and the chapters VFM
 * converts - so a stylesheet can select on it without having to know which
 * path produced the page. Deriving it in one place is what keeps the two
 * from disagreeing, which is how chapters came to carry no such class at all
 * while everything else did.
 */
export function writingModeClass(writingMode: string | undefined): string {
  return writingMode === "horizontal-tb" ? "vivlio-horizontal" : "vivlio-vertical";
}

export function htmlDocument(options: DocumentOptions): string {
  const rootClass = ["vivlio-doc", writingModeClass(options.writingMode), options.rootClass]
    .filter(Boolean)
    .join(" ");
  return `<!doctype html>
<html lang="${escapeHtml(options.lang)}" class="${escapeHtml(rootClass)}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(options.title)}</title>
<link rel="stylesheet" type="text/css" href="${BOOK_STYLESHEET}">
</head>
<body>
${options.body}
</body>
</html>`;
}
