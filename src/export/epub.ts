import JSZip from "jszip";
import type { BuildContext, Chapter } from "../build/context";
import { BOOK_STYLESHEET } from "../build/vfm";
import { buildTocEntries, type TocEntry } from "../build/toc";
import { bundledThemePath } from "../vendor/assets";
import { flattenBundledTheme, THEME_STYLESHEET } from "../build/theme";
import { isFontPath, mimeType } from "../util/paths";
import { throwIfAborted } from "../util/async";
import type { AssetRef } from "../build/workspace";
import { t } from "../i18n";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const EPUB_NS = "http://www.idpf.org/2007/ops";

/** EPUB landmark types for the parts that have one. */
const LANDMARKS: Record<string, string> = {
  "doc-cover": "cover",
  "doc-toc": "toc",
  "doc-preface": "preface",
  "doc-foreword": "foreword",
  "doc-epilogue": "epilogue",
  "doc-afterword": "afterword",
  "doc-appendix": "appendix",
  "doc-bibliography": "bibliography",
  "doc-acknowledgments": "acknowledgments",
  "doc-colophon": "colophon",
};

/**
 * Pack a built book as EPUB 3 (SPEC 3.3).
 *
 * The result is reflowable, not the paginated layout of the PDF: Vivliostyle's
 * page composition cannot travel inside an EPUB, so the theme's CSS ships with
 * the book and the reader lays it out again. Vertical writing and ruby survive
 * because they are CSS, not pagination.
 */
export async function buildEpub(
  context: BuildContext,
  chapters: Chapter[],
  coverAsset: AssetRef | null,
): Promise<Uint8Array> {
  const zip = new JSZip();

  // The mimetype entry must come first and be stored uncompressed.
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);

  const oebps = zip.folder("OEBPS");
  if (!oebps) throw new Error("could not create the EPUB package folder");

  oebps.file(BOOK_STYLESHEET, epubStylesheet(context));

  const documents: { id: string; href: string; chapter: Chapter }[] = [];
  let index = 0;
  for (const chapter of chapters) {
    throwIfAborted(context.signal);
    const html = context.workspace.getFile(chapter.docName)?.text;
    if (!html) continue;

    index += 1;
    const href = chapter.docName.replace(/\.html$/, ".xhtml");
    const id = `doc${String(index).padStart(3, "0")}`;
    oebps.file(href, toXhtml(context, html));
    documents.push({ id, href, chapter });
  }

  const assets: { id: string; href: string; mime: string; isCover: boolean }[] = [];
  let assetIndex = 0;
  for (const asset of context.workspace.assets.values()) {
    if (!asset.bytes) continue;
    // A Japanese font outruns the rest of the book several times over, and its
    // licence may not allow redistribution, so fonts ship only on request
    // (SPEC 5.10). The `font-family` stays in the CSS either way, so a reader
    // that has the font still uses it.
    if (isFontPath(asset.publicPath) && !context.settings.embedFontsInEpub) continue;
    assetIndex += 1;
    const href = asset.epubPath ?? asset.publicPath;
    oebps.file(href, asset.bytes);
    assets.push({
      id: `asset${String(assetIndex).padStart(3, "0")}`,
      href,
      mime: asset.mime || mimeType(href),
      isCover: asset === coverAsset,
    });
  }

  oebps.file("nav.xhtml", navDocument(context, chapters, documents));
  oebps.file("package.opf", packageDocument(context, documents, assets));

  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

/**
 * Turn a generated document into XHTML.
 *
 * EPUB requires XML well-formedness, which HTML serialization does not give;
 * re-serializing the parsed document through XMLSerializer does.
 */
function toXhtml(context: BuildContext, html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const root = parsed.documentElement;
  root.setAttribute("xmlns", XHTML_NS);
  root.setAttribute("xmlns:epub", EPUB_NS);

  // Assets that had to be re-encoded moved to a new file name.
  for (const image of Array.from(parsed.images)) {
    const src = image.getAttribute("src") ?? "";
    const asset = context.workspace.getAsset(src);
    if (asset?.epubPath) image.setAttribute("src", asset.epubPath);
  }

  // Cross-document links point at .html inside the workspace.
  for (const anchor of Array.from(parsed.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href") ?? "";
    if (/^[a-z]+:/i.test(href) || href.startsWith("#")) continue;
    anchor.setAttribute("href", href.replace(/\.html(?=$|#)/, ".xhtml"));
  }

  const serialized = new XMLSerializer().serializeToString(parsed);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
}

/**
 * The stylesheet shipped inside the EPUB.
 *
 * The theme's `@import` chain is flattened, because the bundled themes are not
 * in the package, and a few paged-media rules are undone: a reflowable book
 * has no page numbers for the table of contents to point at, and fixed pixel
 * widths break on a phone (SPEC 5.8(7)).
 */
export function epubStylesheet(context: BuildContext): string {
  const generated = context.workspace.getFile(BOOK_STYLESHEET)?.text ?? "";
  const withoutImport = generated.replace(/^@import[^;]+;\s*/m, "");
  const theme = unsizeRoot(bookTheme(context));

  return [theme, withoutImport, EPUB_OVERRIDES, headingSpacingFallback(theme)]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Take the root font size out of the theme.
 *
 * Every reader offers a font size, and a reflowable book has to follow it.
 * Overriding the *value* is not enough: an author declaration outranks the
 * reader's own stylesheet under the cascade, so `html { font-size: … }` wins
 * over the size the reader was asked for and nothing moves. The declaration
 * has to be gone, so the root keeps whatever size the reader gives it and
 * every `rem` in the theme scales with it.
 */
function unsizeRoot(css: string): string {
  return css.replace(
    /font-size:\s*var\(--vs--html-font-size\)\s*;/g,
    "/* font-size: the reader's to choose */",
  );
}

/**
 * Give headings visible space when the theme left them none.
 *
 * theme-bunko sets `--vs-spacing-rlh: 0` and expresses headings through
 * line-taking instead (`--vs--h3-line-height: 2rem`). That is a paged-media
 * design: on paper the heading owns whole lines of the grid. Reflowed in a
 * reader there is no grid, and an h3 whose line box equals the body's leading
 * shows no break at all.
 *
 * The fallback is emitted only for themes that actually zero the spacing, so
 * techbook's rhythm and academic's explicit per-heading margins are left
 * alone.
 */
function headingSpacingFallback(themeCss: string): string {
  if (!/--vs-spacing-rlh:\s*0\s*;/.test(themeCss)) return "";
  return `
/* The theme zeroes heading margins and relies on line-taking, which needs
   paged output; a reflowable book needs real space instead. */
:root {
  --vs--h1-margin-block: 3rem 1.5rem;
  --vs--h2-margin-block: 2.5rem 1.25rem;
  --vs--h3-margin-block: 2rem 1rem;
  --vs--h4-margin-block: 1.5rem 0.75rem;
}
`.trim();
}

/**
 * The book's theme, as one stylesheet.
 *
 * The same theme the preview is set in, so the two agree: a theme of the
 * writer's own has been resolved into the workspace by the build, and a
 * bundled one is flattened over the embedded files, because those are not in
 * the package. Guessing the path from the theme name instead - which is what
 * this did - only ever found the `@vivliostyle/theme-*` packages, so the
 * plugin's own `novel` fell through to bunko and every rule the theme adds,
 * the colophon among them, was missing from the EPUB.
 */
function bookTheme(context: BuildContext): string {
  const resolved = context.workspace.getFile(THEME_STYLESHEET)?.text;
  if (resolved) return resolved;

  const path = bundledThemePath(context.config.theme || "novel");
  return flattenBundledTheme(path ?? bundledThemePath("novel") ?? "");
}

const EPUB_OVERRIDES = `
/* Reflowable output: the reader paginates, so paged-media artefacts go. */
img {
  max-inline-size: 100%;
  block-size: auto;
}

:is(#toc, [role='doc-toc']) li > a::after {
  content: none;
}

/* Should the theme ever declare the root size some other way than the one
   unsizeRoot takes out, this at least keeps it off the millimetre value the
   grid derives for paper (see gridFontSize) and back on the reader's own. */
:root {
  --vs--html-font-size: 100%;
}

/* Front and back matter are composed to fill a page: a fixed block extent and
   an auto margin that pushes the imprint to the far edge of it. Neither means
   anything where the reader decides the page, and a fixed extent in a
   reflowed column just makes a small box in the corner. */
.titlepage,
[role='doc-colophon'] {
  display: block;
  block-size: auto;
}

.titlepage .imprint,
[role='doc-colophon'] .colophon {
  margin-block-start: 4rem;
}

/* Belt and braces: a paragraph opening with a bracket carries its own indent
   in the glyph, and readers are quick to add one of their own. */
p.vivlio-no-indent {
  text-indent: 0;
}
`.trim();

/**
 * `nav.xhtml`: the table of contents and the landmarks (SPEC 5.11).
 *
 * The contents come from the same entries as the printed table of contents,
 * so a reader's navigation lists the book's headings down to `tocDepth`.
 * Listing one line per document instead would leave a single-note book with
 * no navigation at all.
 */
function navDocument(
  context: BuildContext,
  chapters: Chapter[],
  documents: { id: string; href: string; chapter: Chapter }[],
): string {
  const items = renderNavList(buildTocEntries(context, chapters), 2);

  const landmarks = documents
    .map((entry) => {
      const type = entry.chapter.role ? LANDMARKS[entry.chapter.role] : undefined;
      const fallback =
        entry.chapter.slot === "titlePage"
          ? "titlepage"
          : entry.chapter.isBody
            ? undefined
            : undefined;
      const epubType = type ?? fallback;
      if (!epubType) return null;
      return `      <li><a epub:type="${epubType}" href="${entry.href}">${escapeXml(
        entry.chapter.title,
      )}</a></li>`;
    })
    .filter(Boolean)
    .join("\n");

  const bodyStart = documents.find((entry) => entry.chapter.isBody);
  const bodyLandmark = bodyStart
    ? `      <li><a epub:type="bodymatter" href="${bodyStart.href}">${escapeXml(
        bodyStart.chapter.title,
      )}</a></li>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="${XHTML_NS}" xmlns:epub="${EPUB_NS}" lang="${escapeXml(context.config.lang)}">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(t("toc.heading"))}</title>
  <link rel="stylesheet" type="text/css" href="${BOOK_STYLESHEET}"/>
</head>
<body>
  <nav epub:type="toc" id="toc" role="doc-toc">
    <h1>${escapeXml(t("toc.heading"))}</h1>
${items}
  </nav>
  <nav epub:type="landmarks" hidden="hidden">
    <ol>
${[landmarks, bodyLandmark].filter(Boolean).join("\n")}
    </ol>
  </nav>
</body>
</html>
`;
}

/** Nested `<ol>` for the nav, pointing at the packaged `.xhtml` names. */
function renderNavList(entries: TocEntry[], indent: number): string {
  if (entries.length === 0) return "";
  const pad = "  ".repeat(indent);
  const items = entries
    .map((entry) => {
      const href = escapeXml(entry.href.replace(/\.html(?=$|#)/, ".xhtml"));
      const label = escapeXml(entry.label);
      const children = renderNavList(entry.children, indent + 2);
      return children
        ? `${pad}  <li><a href="${href}">${label}</a>\n${children}\n${pad}  </li>`
        : `${pad}  <li><a href="${href}">${label}</a></li>`;
    })
    .join("\n");
  return `${pad}<ol>\n${items}\n${pad}</ol>`;
}

function packageDocument(
  context: BuildContext,
  documents: { id: string; href: string; chapter: Chapter }[],
  assets: { id: string; href: string; mime: string; isCover: boolean }[],
): string {
  const { config } = context;
  const identifier = `urn:uuid:${uuidFrom(`${config.title}:${config.author}:${config.date}`)}`;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  const manifest = [
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `    <item id="css" href="${BOOK_STYLESHEET}" media-type="text/css"/>`,
    ...documents.map(
      (entry) =>
        `    <item id="${entry.id}" href="${entry.href}" media-type="application/xhtml+xml"/>`,
    ),
    ...assets.map(
      (asset) =>
        `    <item id="${asset.id}" href="${asset.href}" media-type="${asset.mime}"${
          asset.isCover ? ' properties="cover-image"' : ""
        }/>`,
    ),
  ].join("\n");

  const spine = documents
    .map((entry) => `    <itemref idref="${entry.id}"/>`)
    .join("\n");

  const meta: string[] = [
    `    <dc:identifier id="pub-id">${identifier}</dc:identifier>`,
    `    <dc:title>${escapeXml(config.title || t("book.untitled"))}</dc:title>`,
    `    <dc:language>${escapeXml(config.lang || "ja")}</dc:language>`,
    `    <meta property="dcterms:modified">${modified}</meta>`,
  ];
  if (config.author) meta.push(`    <dc:creator>${escapeXml(config.author)}</dc:creator>`);
  if (config.publisher) {
    meta.push(`    <dc:publisher>${escapeXml(config.publisher)}</dc:publisher>`);
  }
  if (config.date) meta.push(`    <dc:date>${escapeXml(config.date)}</dc:date>`);
  if (config.writingMode === "vertical-rl") {
    meta.push(`    <meta property="rendition:spread">auto</meta>`);
  }

  // Vertical Japanese books read right to left.
  const direction = config.writingMode === "vertical-rl" ? ' page-progression-direction="rtl"' : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${escapeXml(
    config.lang || "ja",
  )}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${meta.join("\n")}
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine${direction}>
${spine}
  </spine>
</package>
`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Stable identifier: the same book keeps the same id across exports. */
function uuidFrom(seed: string): string {
  let h1 = 0x9e3779b9;
  let h2 = 0x85ebca6b;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 2654435761) >>> 0;
    h2 = Math.imul(h2 ^ seed.charCodeAt(i), 1597334677) >>> 0;
  }
  const hex = (value: number) => value.toString(16).padStart(8, "0");
  const digits = `${hex(h1)}${hex(h2)}${hex(h1 ^ h2)}${hex((h1 + h2) >>> 0)}`;
  return [
    digits.slice(0, 8),
    digits.slice(8, 12),
    `4${digits.slice(13, 16)}`,
    `a${digits.slice(17, 20)}`,
    digits.slice(20, 32),
  ].join("-");
}
