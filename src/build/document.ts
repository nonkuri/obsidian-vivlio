import { BOOK_STYLESHEET, escapeHtml } from "./vfm";

export interface DocumentOptions {
  lang: string;
  title: string;
  /** Class on `<html>`; front matter carries `vivlio-front-matter`. */
  rootClass?: string;
  body: string;
}

/**
 * Wrap generated markup in a document shaped like VFM's output, so generated
 * parts (cover, title page, table of contents, colophon) and converted
 * chapters are indistinguishable to the typesetter.
 */
export function htmlDocument(options: DocumentOptions): string {
  const rootClass = ["vivlio-doc", options.rootClass].filter(Boolean).join(" ");
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
