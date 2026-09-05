import type { BuildContext } from "./context";
import type { BookConfig } from "../config/types";
import { pageHeightMm, pageWidthMm, resolvePaperSize } from "../config/defaults";
import { BUNDLED_THEME_GRIDS, bundledThemePath, type ThemeGrid } from "../vendor/assets";
import { THEME_STYLESHEET } from "./theme";
import { DOCUMENT_ANCHOR } from "./toc";
import { TOC_FRONT_MATTER_CLASS } from "./toc";
import { fontFaceRules } from "./fonts";
import { effectiveColumnCount, explicitColumnCount } from "./columns";

/**
 * The stylesheet the plugin generates for a book.
 *
 * Theme-facing settings land as CSS variables (SPEC 5.10): theme-base drives
 * page size, margins, fonts and margin boxes through them, so overriding the
 * variables keeps the theme's own design decisions intact. An explicit
 * column count additionally emits a body rule because margin-laid and custom
 * themes are not required to consume the variable themselves.
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
  const size = sheetSize(config);
  if (size && size !== "auto") root.push(`--vs-page--size: ${size};`);

  // Both numbers are written, or neither: the theme composes its block from
  // the pair, and the body size below is derived from the same pair.
  const grid = resolveGrid(config);
  if (grid) {
    root.push(`--vs-theme--num-of-character: ${grid.chars};`);
    root.push(`--vs-theme--num-of-line: ${grid.lines};`);
    root.push(`--vs-theme--num-of-column: ${grid.columns};`);
  } else {
    // A margin-laid theme has no character grid, but an explicit column
    // count is still a complete instruction: CSS can divide the theme's
    // existing text area without changing its type size or page geometry.
    const columns = explicitColumnCount(config);
    if (columns !== null) root.push(`--vs-theme--num-of-column: ${columns};`);
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

  // Bleed without marks is carried by the sheet itself (see sheetSize), so
  // only the marked case hands the length to the theme.
  if (config.cropMarks) {
    root.push("--vs-page--marks: crop cross;");
    if (config.bleed) root.push(`--vs-page--bleed: ${config.bleed};`);
  }
  // With crop marks, artwork has to leave the trim box by this much. Without
  // marks sheetSize has already put that space inside the physical sheet, so
  // a full-sheet box needs no further offset.
  root.push(
    `--vivlio-bleed-offset: ${config.cropMarks && config.bleed ? config.bleed : "0mm"};`,
  );
  const bleedExtent = fullBleedExtent(config);
  root.push(`--vivlio-bleed-width: ${bleedExtent.width};`);
  root.push(`--vivlio-bleed-height: ${bleedExtent.height};`);

  blocks.push(`:root {\n  ${root.join("\n  ")}\n}`);

  const faces = fontFaceRules(context);
  if (faces) blocks.push(faces);

  blocks.push(columnFlowCss(config));
  blocks.push(NOTATION_CSS);
  blocks.push(imageBackstop(textBlockMm(config)));
  blocks.push(bleedCss());
  blocks.push(coverCss(context));
  blocks.push(sectionCss(context));
  blocks.push(startSideCss(context));
  blocks.push(pageNumberingCss(context));

  if (config.css.trim()) blocks.push(`/* book css */\n${config.css.trim()}`);

  return blocks.filter(Boolean).join("\n\n");
}

/**
 * Apply an explicitly requested column count independently of the theme.
 *
 * A grid theme such as novel also reads `--vs-theme--num-of-column` to size
 * its text block, but a margin-laid theme needs no geometry from us: its
 * existing page area is already the multicol container's fragmentainer. The
 * rule therefore owns only the flow. Keeping it on body documents leaves the
 * cover, title pages, contents and colophon as full-page compositions.
 *
 * `column-fill: auto` consumes the first column before continuing in the
 * next. The initial `balance` value would leave ordinary pages short while it
 * tried to make each fragment's columns the same length. The theme still
 * owns `column-gap`; a novel's two-character gap and a manual theme's normal
 * horizontal gap are different design decisions.
 */
function columnFlowCss(config: BookConfig): string {
  if (explicitColumnCount(config) === null) return "";
  return `
:root.vivlio-body body {
  column-count: var(--vs-theme--num-of-column);
  column-fill: auto;
}`.trim();
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
img:not(.vivlio-bleed),
svg:not(.vivlio-bleed) {
  max-width: ${block.widthMm.toFixed(2)}mm;
  max-height: ${block.heightMm.toFixed(2)}mm;
}`.trim();
}

/**
 * A manuscript can dedicate one page to artwork or a ground colour with the
 * `vivlio-bleed` class. The ordinary image cap intentionally excludes it.
 *
 * In an unmarked PDF the bleed is already part of the enlarged sheet. With
 * crop marks it lies outside the trim box, so the box grows on all four sides
 * and starts one bleed length above and to the left of the trim edge.
 */
function bleedCss(): string {
  return `
@page vivlio-bleed {
  margin: 0;
  width: auto;
  height: auto;
  --vs-page--mbox-visibility: hidden;
}

.vivlio-bleed {
  page: vivlio-bleed;
  break-before: page;
  break-after: page;
  box-sizing: border-box;
  width: var(--vivlio-bleed-width);
  height: var(--vivlio-bleed-height);
  margin: calc(var(--vivlio-bleed-offset) * -1);
  overflow: hidden;
  max-inline-size: none;
  max-block-size: none;
  max-width: none;
  max-height: none;
}

/* Vivliostyle discards an entirely empty box when it decides the page type.
   Give a ground-colour-only page one zero-sized in-flow glyph so its named
   page (zero margins, no folio) is retained. */
.vivlio-bleed:empty::before {
  content: "\\00a0";
  display: block;
  font-size: 0;
  line-height: 0;
}

img.vivlio-bleed,
svg.vivlio-bleed {
  display: block;
  object-fit: cover;
}
`.trim();
}

/** Definite paper dimensions keep a nested, empty ground-colour box tall. */
function fullBleedExtent(config: BookConfig): { width: string; height: string } {
  const width = pageWidthMm(config.size);
  const height = pageHeightMm(config.size);
  if (width === null || height === null) {
    return {
      width: `calc(100% + var(--vivlio-bleed-offset) + var(--vivlio-bleed-offset))`,
      height: `calc(100% + var(--vivlio-bleed-offset) + var(--vivlio-bleed-offset))`,
    };
  }

  const bleed = /^(\d+(?:\.\d+)?)mm$/.exec(config.bleed.trim());
  if (bleed) {
    const extra = Number(bleed[1]) * 2;
    return {
      width: `${(width + extra).toFixed(3)}mm`,
      height: `${(height + extra).toFixed(3)}mm`,
    };
  }

  // Non-mm bleed is supported by CSS when marks are present. Keep it as a
  // calculation instead of pretending to know its physical conversion.
  if (config.cropMarks && config.bleed) {
    return {
      width: `calc(${width}mm + ${config.bleed} + ${config.bleed})`,
      height: `calc(${height}mm + ${config.bleed} + ${config.bleed})`,
    };
  }
  return { width: `${width}mm`, height: `${height}mm` };
}

/**
 * The sheet the book is printed on.
 *
 * Normally the trim size. But `bleed` on its own - no crop marks - is a real
 * combination and a common one: a good many Japanese printers ask for
 * "トンボなし・塗り足し3mm", a PDF whose page is the finished size with three
 * millimetres of artwork past every edge and nothing drawn in the margin.
 *
 * CSS cannot say that directly. `bleed` "only has effect if crop marks are
 * enabled" (CSS Paged Media 3), so asking for one without the other gets a
 * sheet cut to the trim line and artwork that stops there. What the printer
 * wants is simply a larger sheet: the trim size plus twice the bleed, with the
 * text block still centred - which it is, because the margins are `auto` and
 * the same length is added to every edge, so the block keeps its place
 * relative to the trim. A full-bleed picture then fills the enlarged sheet,
 * which is the bleed itself.
 *
 * With marks on, the theme is handed the bleed as a length and Vivliostyle
 * enlarges the sheet and draws the marks itself; nothing here has to help.
 */
function sheetSize(config: BookConfig): string {
  const size = resolvePaperSize(config.size);
  if (config.cropMarks || !config.bleed) return size;

  const bleed = /^([\d.]+)mm$/.exec(config.bleed.trim());
  const width = pageWidthMm(config.size);
  const height = pageHeightMm(config.size);
  // A bleed in some other unit, or a sheet whose millimetres are not knowable,
  // is left alone rather than guessed at.
  if (!bleed || !width || !height) return size;

  const margin = Number(bleed[1]) * 2;
  return `${(width + margin).toFixed(3)}mm ${(height + margin).toFixed(3)}mm`;
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
 * The gap between two columns, in characters.
 *
 * Mirrors `--vs-novel--column-gap` in the two-column theme, the way the
 * constant above mirrors `--vs-line-height`: the theme lays the gap out and
 * the size derived here has to have paid for it, or the block is wider than
 * the sheet by exactly the gaps.
 */
const COLUMN_GAP_CHARS = 2;

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

  // Columns divide the character axis and nothing else: each one is a full
  // line's worth of characters, and every column is as long as the page is
  // wide, so the line count is per column and does not multiply.
  const charsAcross = grid.columns * chars + (grid.columns - 1) * COLUMN_GAP_CHARS;
  const byChars = (alongChars * TEXT_BLOCK_FILL) / charsAcross;
  const byLines = (alongLines * TEXT_BLOCK_FILL) / (lines * GRID_LINE_HEIGHT);
  return `${Math.min(byChars, byLines).toFixed(3)}mm`;
}

/** One column's grid, and how many columns of it the page carries. */
type Grid = ThemeGrid;

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
  // A book that says nothing takes the theme's own count, and a theme that is
  // not laid on a grid has none to take: one column, which is what every rule
  // here reduces to.
  const columns = effectiveColumnCount(config);
  return chars > 0 && lines > 0 ? { chars, lines, columns } : null;
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
 * The cover gets no folio and does not advance the page counter. theme-base's
 * vs-counter-doc counts documents, not pages, so it cannot do this for us.
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
  counter-increment: page 0;
  --vs-page--mbox-visibility: hidden;
}

.vivlio-cover,
.vivlio-cover body {
  margin: 0;
  block-size: 100%;
}

.cover,
[role='doc-cover'] {
  /* Named here rather than relying on theme-base, which assigns
     \`cover-document\` through \`body:has([role='doc-cover'])\` - a selector the
     typesetter did not act on, which is how the cover kept being laid out
     inside the text block however the page rule was written. */
  page: cover;
  box-sizing: border-box;
  width: var(--vivlio-bleed-width);
  height: var(--vivlio-bleed-height);
  margin: calc(var(--vivlio-bleed-offset) * -1);
  overflow: hidden;
}

.cover img,
[role='doc-cover'] img {
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

/* The pages that carry no folio.
 *
 * A contents page lists what follows it, so nothing laid out before it is a
 * page anyone looks up, and a Japanese book prints a number on none of them:
 * the half title, the title page, the dedication, the epigraph. The contents
 * page hides its own (the theme does that, by the root class).
 *
 * The colophon joins them at the back for the same reason. It is where the
 * book says who made it, not a page anyone is counting, and the contents does
 * not list it either (see buildTocEntries).
 *
 * theme-base gives the dedication and the epigraph a named page from their
 * DPUB role, so naming those pages here is all it takes. */
@page titlepage, halftitle, dedication, epigraph, colophon {
  --vs-page--mbox-visibility: hidden;
}

.titlepage,
.halftitle {
  break-after: page;
}

/* A leaf the typesetter put in to carry a part over to the side it opens on
   (see startSideCss). Nothing is printed on it. Ordinary blanks count; the
   viewer patch separately excludes the one immediately behind the cover. */
@page :blank {
  --vs-page--mbox-visibility: hidden;
}

`.trim();
}

/**
 * Which side of the spread a chapter or a part opens on (SPEC 5.11).
 *
 * Japanese binding runs right to left, so the odd page is the left one, and a
 * chapter, a dedication or a title page is conventionally set to open there.
 * `break-before: left` says exactly that, and where the text does not reach
 * the side on its own the typesetter puts a blank leaf in and leaves it blank
 * by the rule in sectionCss. Ordinary blanks count; the viewer patch excludes
 * the one immediately behind the cover.
 *
 * The break goes on the first block *inside* a part, not on the part itself.
 * A part is the outermost box of its own document and the typesetter has
 * already opened a page for it, so a break there is nothing to act on -
 * measured, `#vivlio-start { break-before: left }` left the title page on the
 * right and computed to `auto`. One box further in there is a break to take,
 * and the page it opens is the one the part begins on.
 *
 * The cover is left out: it is the first leaf, and there is nothing in front
 * of it to break from. The parts are named by the anchor every generated and
 * converted document carries on its outermost element, plus the two that
 * carry an id or a class of their own instead.
 *
 * `h2` as well, for a book written as one note: the theme already opens a page
 * on it, and this says which page.
 */
function startSideCss(context: BuildContext): string {
  const side = context.config.startSide;
  if (side !== "left" && side !== "right") return "";
  return `
h2,
#${DOCUMENT_ANCHOR}:not(.cover) > :first-child,
#toc > :first-child,
.halftitle > :first-child {
  break-before: ${side};
}`.trim();
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
    // A book that prints no folio has no page for a contents line to name.
    // theme-base builds the leader and the number as one `::after`, so both
    // go together; what is left is the title against the margin, which is
    // what a contents page without page numbers looks like.
    return `
:root { --vs-page--mbox-visibility: hidden; }

:is(#toc, [role='doc-toc']) li > a::after {
  content: none;
}
`.trim();
  }

  // Continuous numbering is initialized on the reading-order item, before a
  // possible opening blank. Split numbering resets at the body element. Core
  // applies an element reset after the page increment, so it takes the printed
  // value directly; the viewer patch carries it into the next document.
  const start = context.config.startPage ?? 1;
  const reset = `.vivlio-page-reset { counter-reset: page ${start}; }`;
  if (mode === "continuous") return "";

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

/* The contents page has to read the numbers the same way the pages print
   them. theme-base takes the style from one variable set on the root, which
   is the body's - so every front-matter line came out in arabic while the
   page it pointed at was numbered in roman: a dedication printed iii was
   listed as 3, and the list then appeared to count 3, 4, 6, 1 down the page.
   The counter is the same one either way; only the style differs, so it is
   set per entry (see TOC_FRONT_MATTER_CLASS). */
:is(#toc, [role='doc-toc']) li.${TOC_FRONT_MATTER_CLASS} > a {
  --vs-toc--page-counter-style: lower-roman;
}
`.trim();
}
