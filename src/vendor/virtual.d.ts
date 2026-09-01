declare module "virtual:vivlio-assets" {
  export interface EmbeddedAsset {
    text?: string;
    base64?: string;
  }
  /** `@vivliostyle/viewer/lib/**`, keyed by path relative to `lib/`. */
  export const viewerAssets: Record<string, EmbeddedAsset>;
  /** Theme CSS, keyed by `@vivliostyle/theme-<name>/<path>`. */
  export const themeAssets: Record<string, EmbeddedAsset>;
}
