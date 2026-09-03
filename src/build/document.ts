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
export function htmlDocument(options: DocumentOptions): string {
  const mode =
    options.writingMode === "horizontal-tb" ? "vivlio-horizontal" : "vivlio-vertical";
  const rootClass = ["vivlio-doc", mode, options.rootClass].filter(Boolean).join(" ");
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
