import type { BuildContext } from "./context";
import type { BookConfig } from "../config/types";
import { pageHeightMm, pageWidthMm, resolvePaperSize } from "../config/defaults";
import { bundledThemePath } from "../vendor/assets";
import { fontFaceRules } from "./fonts";

/**
 * The stylesheet the plugin generates for a book.
 *
 * Every setting lands as an override of a theme CSS variable rather than as a
 * rule of its own (SPEC 5.10): theme-base drives page size, margins, fonts and
 * margin boxes through variables, so overriding them keeps the theme's own
 * design decisions intact.
 */
export function bookStylesheet(context: BuildContext, themeUrl: string): string {
  const { config } = context;
  const blocks: string[] = [];

  blocks.push(`@import url("${themeUrl}");`);

  const root: string[] = [];
  root.push(`--vs-writing-mode: ${config.writingMode};`);

  // Sheet size only.
  //
  // `--vs-page--width` / `--vs-page--height` are not the sheet: they are the
  // text block, which theme-bunko computes from `charsPerLine` /
  // `linesPerPage` and centres with `margin: auto`. Forcing them to `auto`
  // makes the block fill the sheet, which collapses every margin to zero and
  // leaves the running head printing on top of the text.
  const size = resolvePaperSize(config.size);
  if (size && size !== "auto") root.push(`--vs-page--size: ${size};`);
  if (config.charsPerLine) root.push(`--vs-theme--num-of-character: ${config.charsPerLine};`);
  if (config.linesPerPage) root.push(`--vs-theme--num-of-line: ${config.linesPerPage};`);

  if (config.fontFamily) root.push(`--vs-font-family: ${config.fontFamily};`);
  if (config.headingFontFamily) {
    root.push(`--vs--heading-font-family: ${config.headingFontFamily};`);
  }
  if (config.monospaceFontFamily) {
    root.push(`--vs--monospace-font-family: ${config.monospaceFontFamily};`);
  }
  if (config.mboxFontFamily) root.push(`--vs-page--mbox-font-family: ${config.mboxFontFamily};`);
  if (config.fontFeatureSettings) {
    root.push(`--vs-font-feature-settings: ${config.fontFeatureSettings};`);
  }
  const derivedSize = gridFontSize(config);
  const bodySize = config.baseFontSize || derivedSize;
  if (bodySize) root.push(`--vs--html-font-size: ${bodySize};`);
  // theme-bunko pins the running head and folio at 8.5pt. Once the body is
  // sized from the paper that is as large as the text itself, so the margin
  // boxes follow the body instead of a fixed value.
  if (derivedSize && !config.baseFontSize) {
    root.push(`--vs-page--mbox-font-size: ${scaleLength(derivedSize, MBOX_FONT_RATIO)};`);
  }

  // A manuscript that already starts its paragraphs with an ideographic space
  // must not also get the theme's indent (SPEC 5.10).
  if (config.paragraphIndent !== "") {
    root.push(`--vs--p-text-indent: ${normalizeLength(config.paragraphIndent)};`);
  }
  if (config.rubyFontSize) root.push(`--vs--rt-font-size: ${config.rubyFontSize};`);
  root.push(`--vs--tcy-font-family: ${config.tcyFontFamily || "inherit"};`);

  if (config.cropMarks) root.push("--vs-page--marks: crop cross;");
  if (config.bleed) root.push(`--vs-page--bleed: ${config.bleed};`);

  blocks.push(`:root {\n  ${root.join("\n  ")}\n}`);

  const faces = fontFaceRules(context);
  if (faces) blocks.push(faces);

  blocks.push(NOTATION_CSS);
  blocks.push(coverCss(context));
  blocks.push(sectionCss());
  blocks.push(pageNumberingCss(context));

  if (config.css.trim()) blocks.push(`/* book css */\n${config.css.trim()}`);

  return blocks.filter(Boolean).join("\n\n");
}

/** Running heads and folios sit below the body size, as in a printed book. */
const MBOX_FONT_RATIO = 0.75;

/** Scale a `<number>mm` length. */
function scaleLength(length: string, factor: number): string {
  const value = Number(length.replace("mm", ""));
  return Number.isFinite(value) ? `${(value * factor).toFixed(3)}mm` : length;
}

/** Proportion of the sheet the text block takes; the rest becomes margin. */
const TEXT_BLOCK_FILL = 0.85;

/** theme-bunko's `--vs-line-height`, the grid the character count sits on. */
const GRID_LINE_HEIGHT = 2;

/**
 * Body size derived from the paper and the character grid.
 *
 * A grid theme sizes the text block from the type: theme-bunko makes it
 * `chars × 1em` by `lines × line-height em` and centres it with `margin:
 * auto`. Ask for 39 characters and 15 lines at the theme's own 16px and the
 * block comes out larger than a bunko sheet, so the margins collapse to zero
 * and the running head prints over the text. The theme papers over this under
 * print media by shrinking the type to 83.33%, which is both not enough and
 * different from what the preview shows.
 *
 * Deriving the size from the paper instead makes the grid fit by
 * construction, and makes the preview and the PDF agree, because the value no
 * longer depends on the media type.
 */
function gridFontSize(config: BookConfig): string | null {
  const chars = config.charsPerLine;
  const lines = config.linesPerPage;
  if (!chars || !lines) return null;

  const width = pageWidthMm(config.size);
  const height = pageHeightMm(config.size);
  if (!width || !height) return null;

  // In vertical writing the characters of a line run down the page and the
  // lines march across it; horizontally it is the other way round.
  const vertical = config.writingMode === "vertical-rl";
  const alongChars = vertical ? height : width;
  const alongLines = vertical ? width : height;

  const byChars = (alongChars * TEXT_BLOCK_FILL) / chars;
  const byLines = (alongLines * TEXT_BLOCK_FILL) / (lines * GRID_LINE_HEIGHT);
  return `${Math.min(byChars, byLines).toFixed(3)}mm`;
}

/**
 * Accept a bare number as a CSS length.
 *
 * `vivlio-paragraph-indent: 0` comes back from YAML as the number 0, and `0`
 * is valid CSS; anything else needs a unit, which the user supplies.
 */
function normalizeLength(value: string): string {
  const trimmed = String(value).trim();
  return /^-?\d+(\.\d+)?$/.test(trimmed) && Number(trimmed) !== 0
    ? `${trimmed}em`
    : trimmed;
}

/** URL of the theme entry stylesheet, bundled or from the vault. */
export function themeUrlFor(context: BuildContext): string {
  const theme = context.config.theme || "bunko";
  const bundled = bundledThemePath(theme);
  if (bundled) return `${context.themeBase}${bundled}`;

  const file = context.app.vault.getFileByPath(theme);
  if (file) {
    return `${context.vaultBase}${file.path.split("/").map(encodeURIComponent).join("/")}`;
  }
  return `${context.themeBase}${bundledThemePath("bunko")}`;
}

/**
 * Styling for the notations the plugin introduces (SPEC 5.3).
 *
 * `.boten` is shared by the Kakuyomu emphasis-dot syntax and by
 * `==highlight==` in its default mode, so there is one place to restyle.
 */
const NOTATION_CSS = `
.boten {
  font-style: normal;
  text-emphasis: filled sesame;
  text-emphasis-position: over right;
}

.tcy {
  text-combine-upright: all;
  font-family: var(--vs--tcy-font-family, inherit);
}

.callout {
  display: block;
  break-inside: avoid;
  border: 1px solid currentColor;
  border-radius: 2px;
  padding: 0.6rem 0.8rem;
  margin-block: 1rem;
}

.callout-title {
  font-weight: bold;
  margin-block: 0 0.4rem;
}

.callout > :last-child {
  margin-block-end: 0;
}

ul.task-list,
ol.task-list {
  list-style: none;
  padding-inline-start: 1.4em;
}

/* The box is drawn as content rather than as a form control, so the PDF gets
   a glyph instead of a widget. */
.task-list-item {
  list-style: none;
}

.task-list-item::before {
  content: "\\2610\\0020";
}

.task-list-item[data-checked="true"]::before {
  content: "\\2611\\0020";
}

.vivlio-placeholder {
  outline: 1px dashed currentColor;
  padding: 0 0.2em;
  opacity: 0.7;
}

.vivlio-rendered {
  break-inside: avoid;
  margin-block: 1rem;
}

/* Rendered dataview output arrives with Obsidian's class names; give it a
   minimal print style rather than depending on the app's own theme. */
.vivlio-rendered table {
  border-collapse: collapse;
  inline-size: 100%;
}

.vivlio-rendered th,
.vivlio-rendered td {
  border: 0.5px solid currentColor;
  padding: 0.2em 0.4em;
}

.vivlio-rendered svg {
  max-inline-size: 100%;
  block-size: auto;
}

.vivlio-error {
  color: #b00;
  border: 1px solid currentColor;
  padding: 0.5rem;
}

.tag {
  font-size: 0.85em;
}
`.trim();

/**
 * Cover styling (SPEC 5.9).
 *
 * theme-base already understands `role="doc-cover"`: it hides the margin boxes
 * and keeps the cover out of the page count, so only the image fit is left.
 */
function coverCss(context: BuildContext): string {
  const fit = context.config.coverFit === "contain" ? "contain" : "cover";
  return `
@page cover {
  margin: 0;
}

.cover {
  block-size: 100%;
  margin: 0;
}

.cover img {
  inline-size: 100%;
  block-size: 100%;
  object-fit: ${fit};
}
`.trim();
}

/** Named pages for the two front-matter parts DPUB-ARIA has no role for. */
function sectionCss(): string {
  return `
.titlepage {
  page: titlepage;
}

.halftitle {
  page: halftitle;
}

@page titlepage, halftitle {
  --vs-page--mbox-visibility: hidden;
}

.titlepage,
.halftitle {
  text-align: center;
  break-after: page;
}

.titlepage .title,
.halftitle .title {
  font-size: 1.6rem;
  font-weight: bold;
  margin-block: 6rem 2rem;
}

.titlepage .subtitle {
  font-size: 1.1rem;
  margin-block-end: 4rem;
}

.titlepage .author {
  margin-block-start: 6rem;
}

[role="doc-colophon"] table {
  border-collapse: collapse;
}

[role="doc-colophon"] th {
  text-align: start;
  padding-inline-end: 1em;
  font-weight: normal;
}
`.trim();
}

/**
 * Page numbering (SPEC 5.11).
 *
 * Front matter carries `vivlio-front-matter` on its root element, so the
 * roman numerals are set through the same margin-box variables the theme
 * uses; the page counter restarts on the first body chapter.
 */
function pageNumberingCss(context: BuildContext): string {
  const mode = context.config.pageNumbering;

  if (mode === "none") {
    return `:root { --vs-page--mbox-visibility: hidden; }`;
  }

  // The page counter is incremented before an element's `counter-reset` is
  // applied, so the value written here is the one the page shows: 1, not 0.
  const reset = `.vivlio-page-reset { counter-reset: page 1; }`;
  if (mode === "continuous") return reset;

  return `
${reset}

:root.vivlio-front-matter {
  --vs-theme--page-top-left-content: counter(page, lower-roman);
  --vs-theme--page-top-right-content: counter(page, lower-roman);
  --vs-page--mbox-content-bottom-center: counter(page, lower-roman);
}
`.trim();
}
