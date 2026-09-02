import {
  themeAssets as embeddedThemes,
  viewerAssets as embeddedViewer,
  type EmbeddedAsset,
} from "virtual:vivlio-assets";

/**
 * The prebuilt Vivliostyle viewer and the CC0 themes, embedded into the
 * bundle at build time (see esbuild.config.mjs) so the plugin ships as a
 * single main.js and the local server still has real files to hand out.
 */
export const viewerAssets: Record<string, EmbeddedAsset> = embeddedViewer;
export const themeAssets: Record<string, EmbeddedAsset> = embeddedThemes;

export type { EmbeddedAsset };

/** Bundled themes, in the order they are offered in the UI. */
export const BUNDLED_THEMES: Record<string, string> = {
  novel: "vivlio/novel.css",
  bunko: "@vivliostyle/theme-bunko/theme.css",
  techbook: "@vivliostyle/theme-techbook/theme.css",
  academic: "@vivliostyle/theme-academic/theme.css",
  base: "@vivliostyle/theme-base/theme-all.css",
};

/**
 * The character grid a bundled theme builds its text block from.
 *
 * A grid theme sizes the block from the type - `chars x 1em` by
 * `lines x line-height em` - and uses these numbers when the book gives none
 * of its own. The plugin derives the body size from the same pair (see
 * gridFontSize in src/build/css.ts), so the block fits the sheet by
 * construction. Knowing them on one side only is what made the default
 * configuration - novel, bunko-sized paper, no grid in the YAML - compose a
 * 40x16 block at the theme's untouched 16px and overrun the sheet.
 *
 * The themes not listed here lay out from margins, not from a grid, and must
 * keep their own body size unless the book asks for a grid explicitly.
 */
export const BUNDLED_THEME_GRIDS: Record<string, { chars: number; lines: number }> = {
  novel: { chars: 40, lines: 16 },
  bunko: { chars: 39, lines: 15 },
};

export function isBundledTheme(name: string): boolean {
  return name in BUNDLED_THEMES;
}

/** Path of a bundled theme's entry stylesheet, relative to the themes root. */
export function bundledThemePath(name: string): string | null {
  return BUNDLED_THEMES[name] ?? null;
}
