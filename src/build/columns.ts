import type { BookConfig } from "../config/types";
import { BUNDLED_THEME_GRIDS } from "../vendor/assets";

/** A valid explicit count, or null when the theme is meant to decide. */
export function explicitColumnCount(config: BookConfig): number | null {
  const columns = config.columns;
  if (columns === null || !Number.isSafeInteger(columns) || columns < 1) return null;
  return columns;
}

/**
 * The count Vivlio can determine before layout.
 *
 * A vault theme may apply columns of its own while `columns` is null; that is
 * deliberately outside this answer because its arbitrary CSS cannot be
 * inferred safely. Bundled grid themes declare their defaults in one place.
 */
export function effectiveColumnCount(config: BookConfig): number {
  return explicitColumnCount(config) ?? BUNDLED_THEME_GRIDS[config.theme]?.columns ?? 1;
}
