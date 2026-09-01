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
  bunko: "@vivliostyle/theme-bunko/theme.css",
  techbook: "@vivliostyle/theme-techbook/theme.css",
  academic: "@vivliostyle/theme-academic/theme.css",
  base: "@vivliostyle/theme-base/theme-all.css",
};

export function isBundledTheme(name: string): boolean {
  return name in BUNDLED_THEMES;
}

/** Path of a bundled theme's entry stylesheet, relative to the themes root. */
export function bundledThemePath(name: string): string | null {
  return BUNDLED_THEMES[name] ?? null;
}
