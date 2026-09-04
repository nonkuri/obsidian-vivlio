import { warn, type BuildContext } from "./context";
import { DOCUMENT_ANCHOR } from "./toc";
import { htmlDocument } from "./document";
import { registerVaultAsset, srcFor } from "./hast/assets";
import { escapeHtml } from "./vfm";
import type { AssetRef } from "./workspace";

export interface CoverResult {
  html: string;
  asset: AssetRef;
}

/**
 * Build the cover page from a single image (SPEC 5.9).
 *
 * theme-base already knows `role="doc-cover"`: it hides running heads and
 * folios and keeps the cover out of the page count, so the generated markup
 * only has to carry the role and let the stylesheet size the image.
 */
export function buildCover(context: BuildContext): CoverResult | null {
  const { config } = context;
  if (!config.cover) return null;

  const file = context.app.metadataCache.getFirstLinkpathDest(
    config.cover,
    `${context.bookRoot}/`,
  );
  if (!file) {
    warn(context, { kind: "missing-asset", message: config.cover });
    return null;
  }

  const asset = registerVaultAsset(context, file);
  const body = `<section class="cover" role="doc-cover" id="${DOCUMENT_ANCHOR}">
<img src="${escapeHtml(srcFor(context, asset))}" alt="">
</section>`;

  return {
    html: htmlDocument({
    writingMode: config.writingMode,
      lang: config.lang,
      title: config.title || "cover",
      rootClass: "vivlio-cover",
      body,
    }),
    asset,
  };
}
