import { normalizePath } from "obsidian";
import { warn, type BuildContext } from "./context";
import { DOCUMENT_ANCHOR } from "./toc";
import { htmlDocument } from "./document";
import { registerVaultAsset, srcFor } from "./hast/assets";
import { escapeHtml } from "./vfm";
import type { AssetRef } from "./workspace";
import { pageWidthMm } from "../config/defaults";
import { mmToPx } from "../util/imageSize";

export interface CoverResult {
  html: string;
  asset: AssetRef;
}

/**
 * Build the cover page from a single image (SPEC 5.9).
 *
 * The cover role and class select our page-counter and full-sheet image
 * rules in bookStylesheet, including exclusion from the folio count.
 */
export function buildCover(context: BuildContext, back = false): CoverResult | null {
  const { config } = context;
  const path = back ? config.backCover : config.cover;
  if (!path) return null;

  const file = context.app.metadataCache.getFirstLinkpathDest(
    normalizePath(path),
    `${context.bookRoot}/`,
  );
  if (!file) {
    warn(context, { kind: "missing-asset", message: path });
    return null;
  }

  const asset = registerVaultAsset(context, file);
  asset.fullBleed = true;
  const pageWidth = pageWidthMm(config.size);
  const bleed = /^(\d+(?:\.\d+)?)mm$/.exec(config.bleed.trim());
  if (pageWidth !== null) {
    const widthMm = pageWidth + (bleed ? Number(bleed[1]) * 2 : 0);
    asset.displayWidthPx = Math.max(asset.displayWidthPx ?? 0, mmToPx(widthMm));
  }
  const image = `<section class="${back ? "back-cover" : "cover"}"${back ? "" : ' role="doc-cover"'} id="${back ? "vivlio-back-cover" : DOCUMENT_ANCHOR}">
<img src="${escapeHtml(srcFor(context, asset))}" alt="">
</section>`;
  // EPUB is reflowable: include the image, without physical padding pages.
  const body = back && context.mode !== "epub"
    ? `<div class="back-cover-pages"><div class="back-cover-inside" aria-hidden="true"></div>${image}</div>`
    : image;

  return {
    html: htmlDocument({
      writingMode: config.writingMode,
      lang: config.lang,
      title: config.title || "cover",
      rootClass: back ? "vivlio-back-cover" : "vivlio-cover",
      body,
    }),
    asset,
  };
}
