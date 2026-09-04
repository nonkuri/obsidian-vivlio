import type { BuildContext } from "./context";
import type { BookConfig } from "../config/types";
import { pageHeightMm, pageWidthMm, resolvePaperSize } from "../config/defaults";
import { BUNDLED_THEME_GRIDS, bundledThemePath } from "../vendor/assets";
import { THEME_STYLESHEET } from "./theme";
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

  // The running head of a right-hand page names the book. A `string-set` can
  // only carry what some element in the flow says, and no body chapter says
  // the title, so it travels as a variable instead (see novel.css).
  if (config.title) root.push(`--vivlio-book-title: ${cssString(config.title)};`);

  // Sheet size only.
  //
  // `--vs-page--width` / `--vs-page--height` are not the sheet: they are the
  // text block, which theme-bunko computes from `charsPerLine` /
  // `linesPerPage` and centres with `margin: auto`. Forcing them to `auto`
  // makes the block fill the sheet, which collapses every margin to zero and
  // leaves the running head printing on top of the text.
  const size = resolvePaperSize(config.size);
  if (size && size !== "auto") root.push(`--vs-page--size: ${size};`);

  // Both numbers are written, or neither: the theme composes its block from
  // the pair, and the body size below is derived from the same pair.
  const grid = resolveGrid(config);
  if (grid) {
    root.push(`--vs-theme--num-of-character: ${grid.chars};`);
    root.push(`--vs-theme--num-of-line: ${grid.lines};`);
  }

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
  const derivedSize = gridFontSize(config, grid);
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
  blocks.push(imageBackstop(textBlockMm(config)));
  blocks.push(coverCss(context));
  blocks.push(sectionCss(context));
  blocks.push(pageNumberingCss(context));

  if (config.css.trim()) blocks.push(`/* book css */\n${config.css.trim()}`);

  return blocks.filter(Boolean).join("\n\n");
}

/**
 * The backstop, for pictures the plugin could not measure itself.
 *
 * Sizing is done in `applySize` now, from the intrinsic size: it works out
 * the box and writes one definite axis, leaving the other automatic, so the
 * ratio is never in contention and nothing here has to bite. What is left is
 * the case where the intrinsic size was unreadable - a format the header
 * parser does not know, a file that could not be read - and a picture whose
 * shape is unknown still must not print off the page.
 *
 * Two maxima with no definite size is the one combination that keeps the
 * ratio: the element sizes itself and shrinks to fit, exactly the way a
 * picture with no CSS at all does. (Measured: a 1400x900 picture in a 300x400
 * frame comes out 300x193, its own ratio. The same picture with a definite
 * inline size and one maximum comes out 300x400 - the box, not the picture.)
 *
 * Physical, not logical, because "does it fit on the paper" is a question
 * about the paper.
 */
function imageBackstop(block: TextBlockMm | null): string {
  if (!block) return "";
  return `
img,
svg {
  max-width: ${block.widthMm.toFixed(2)}mm;
  max-height: ${block.heightMm.toFixed(2)}mm;
}`.trim();
}

/** Running heads and folios sit below the body size, as in a printed book. */
const MBOX_FONT_RATIO = 0.75;

/**
 * A CSS string literal.
 *
 * A book title is arbitrary text; a quote or a backslash in it would otherwise
 * end the literal early and take the rest of the stylesheet with it. Newlines
 * are not allowed inside a CSS string at all, so they become spaces.
 */
function cssString(value: string): string {
  const escaped = value.replace(/[\\"]/g, "\\$&").replace(/\s+/g, " ");
  return `"${escaped}"`;
}

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
function gridFontSize(config: BookConfig, grid: Grid | null): string | null {
  if (!grid) return null;
  const { chars, lines } = grid;

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

interface Grid {
  chars: number;
  lines: number;
}

/** The printed text block: physical, so a picture can be measured against it. */
export interface TextBlockMm {
  widthMm: number;
  heightMm: number;
  /** Root font size, which is what a `rem` is worth on this page. */
  fontMm: number;
}

/**
 * The text block the book will actually be composed on, in millimetres.
 *
 * Physical rather than logical on purpose. Everything that has to *fit* a
 * picture - is it wider than the block, is it taller - is a question about
 * the paper, and the answer must not change when the writing mode does.
 * The logical axes are derived here instead: the characters run along the
 * inline axis, the lines stack along the block axis, and which of those is
 * the width depends on the writing mode.
 *
 * Null when the numbers are not knowable: a theme that lays out from margins
 * has no grid, and a book that sets `baseFontSize` in a unit that is not
 * millimetres has a block this cannot measure. Callers fall back to letting
 * CSS do what it can.
 */
export function textBlockMm(config: BookConfig): TextBlockMm | null {
  const grid = resolveGrid(config);
  if (!grid) return null;

  const explicit = config.baseFontSize.trim();
  const derived = gridFontSize(config, grid);
  const source = explicit || derived;
  if (!source) return null;

  const match = /^([\d.]+)mm$/.exec(source);
  if (!match) return null;
  const fontMm = Number(match[1]);
  if (!Number.isFinite(fontMm) || fontMm <= 0) return null;

  const alongChars = grid.chars * fontMm;
  const alongLines = grid.lines * GRID_LINE_HEIGHT * fontMm;
  const vertical = config.writingMode !== "horizontal-tb";

  return vertical
    ? { widthMm: alongLines, heightMm: alongChars, fontMm }
    : { widthMm: alongChars, heightMm: alongLines, fontMm };
}

/**
 * The character grid the book will actually be composed on.
 *
 * A grid theme has its own numbers and falls back to them when the book gives
 * none; the plugin has to use the same ones, or the block it sizes the type
 * for is not the block the theme draws. A theme that lays out from margins
 * instead keeps its own body size unless the book asks for a grid outright.
 */
function resolveGrid(config: BookConfig): Grid | null {
  const themeGrid = BUNDLED_THEME_GRIDS[config.theme] ?? null;
  const chars = config.charsPerLine || themeGrid?.chars || 0;
  const lines = config.linesPerPage || themeGrid?.lines || 0;
  return chars > 0 && lines > 0 ? { chars, lines } : null;
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

/**
 * URL of the theme entry stylesheet.
 *
 * A theme kept in the vault has been resolved into the workspace by then (see
 * resolveVaultTheme), imports and all, so both the preview and the EPUB read
 * the same text. Anything else names a bundled theme, and a name that names
 * nothing falls back to the default rather than leaving the book unstyled.
 */
export function themeUrlFor(context: BuildContext): string {
  if (context.workspace.getFile(THEME_STYLESHEET)) {
    return `${context.workspaceBase}${THEME_STYLESHEET}`;
  }
  const bundled = bundledThemePath(context.config.theme || "novel");
  return `${context.themeBase}${bundled ?? bundledThemePath("novel")}`;
}

/**
 * Styling for the notations the plugin introduces (SPEC 5.3).
 *
 * `.boten` is shared by the Kakuyomu emphasis-dot syntax and by
 * `==highlight==` in its default mode, so there is one place to restyle.
 */
const NOTATION_CSS = `
/* Emphasis dots are written as ruby carrying a sesame dot over each character
   (see notationRules). Ruby reserves the same band on every line, so a line
   with emphasis keeps the measure of its neighbours; text-emphasis draws
   outside the character and widens only the lines that carry it. */
ruby.boten {
  font-style: normal;
}

ruby.boten > rt {
  font-weight: normal;
  letter-spacing: 0;
}

.tcy {
  text-combine-upright: all;
  font-family: var(--vs--tcy-font-family, inherit);
}

/* Blank lines the manuscript left, as whole lines of the grid so the text below
   still sits on it (see blankLinesPlugin).

   Padding rather than margin. A margin here does not add to the one the block
   already carries, it collapses with it - and a margin-laid theme sizes that
   margin as one line, exactly what a three-blank-line run asks for, so the
   space the manuscript wanted replaced the paragraph break instead of
   following it and the page did not move at all. (theme-base: both
   --vs--p-margin-block and --vs--figure-margin-block are --vs-spacing-rlh.)
   Padding is added to whatever the theme spaces blocks by, which is what a
   run of blank lines means: this much again, past the usual gap. */
.vivlio-blank-lines {
  padding-block-start: calc(
    1rem * var(--vs-line-height, 1.5) * var(--vivlio-blank-lines, 1)
  );
}

/* A forced page break (see notationRules). The class lands on the block that
   is to start the page, not on a marker of its own - a box with no height can
   be placed again and again without filling the page, and the typesetter never
   finishes. The legacy spelling is there because a good many EPUB readers
   still only understand that one. */
.vivlio-page-break {
  break-before: page;
  page-break-before: always;
}

/* A paragraph opening with 「 takes no indent: the bracket is drawn in the
   right half of its em box, so the empty half already reads as one (see
   indentPlugin). */
p.vivlio-no-indent {
  text-indent: 0;
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
/* theme-base assigns the cover \`page: cover-document\`, not \`cover\`, so a
   \`@page cover\` rule never reached it - which is why the cover was still
   being laid out inside the text block.

   \`width\` / \`height\` in \`@page\` are the page *area*: theme-bunko and the
   novel theme set them from the character grid and let the margins take the
   rest, which is right for a page of text and wrong for a cover. A cover is
   not set inside the text block, it is the sheet. */
@page cover, cover-document {
  margin: 0;
  width: auto;
  height: auto;
}

.vivlio-cover,
.vivlio-cover body {
  margin: 0;
  block-size: 100%;
}

.cover {
  /* Named here rather than relying on theme-base, which assigns
     \`cover-document\` through \`body:has([role='doc-cover'])\` - a selector the
     typesetter did not act on, which is how the cover kept being laid out
     inside the text block however the page rule was written. */
  page: cover;
  block-size: 100%;
  inline-size: 100%;
  margin: 0;
}

.cover img {
  inline-size: 100%;
  block-size: 100%;
  /* The cover is not set inside the text block, it *is* the page: full bleed,
     no margin, no folio. So it has to say so, because the cap in
     imageBlockCap is a max constraint and a max clamps the used value however
     specific the rule that asked for 100% was - the cover came out at the
     text block's 85% with white below it. */
  max-inline-size: none;
  max-block-size: none;
  max-width: none;
  max-height: none;
  object-fit: ${fit};
  display: block;
}
`.trim();
}

/**
 * Named pages for the two front-matter parts DPUB-ARIA has no role for.
 *
 * Only the page assignment lives here. How those parts *look* is the theme's
 * decision, and this stylesheet is imported after the theme, so anything set
 * here would silently outrank it.
 */
function sectionCss(context: BuildContext): string {
  void context;
  return `
.titlepage {
  page: titlepage;
}

.halftitle {
  page: halftitle;
}

[role='doc-colophon'] {
  page: colophon;
}

/* A colophon is where the book says who made it, not a page anyone is
   counting. Japanese books print no folio on it, and the contents page does
   not list it either (see buildTocEntries). It joins the two parts that were
   already unnumbered, through the one mechanism proven to do it. */
@page titlepage, halftitle, colophon {
  --vs-page--mbox-visibility: hidden;
}

.titlepage,
.halftitle {
  break-after: page;
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

  // Only the foot: setting a running-head variable as well printed the number
  // twice on every front-matter page.
  //
  // Where the foot is, though, is the theme's business. A theme that places
  // the folio itself - the novel theme puts it in the outer bottom corner,
  // which is a different margin box on each side - reads `--vivlio-folio` and
  // declares `--vivlio-folio-own-box`, which turns the centred fallback off so
  // the number is not also printed a second time in the middle.
  return `
${reset}

:root.vivlio-front-matter {
  --vivlio-folio: counter(page, lower-roman);
  --vs-page--mbox-content-bottom-center: var(
    --vivlio-folio-own-box,
    counter(page, lower-roman)
  );
}
`.trim();
}
