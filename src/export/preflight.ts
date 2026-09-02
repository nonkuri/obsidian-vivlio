import type { BuildContext } from "../build/context";
import { checkFonts } from "../build/fonts";
import { effectiveDpi, pxToMm } from "../util/imageSize";
import { isImagePath } from "../util/paths";
import { pageHeightMm, pageWidthMm } from "../config/defaults";
import { t } from "../i18n";

export { pageWidthMm, pageHeightMm };

export interface PreflightIssue {
  level: "warning" | "error";
  message: string;
}

/**
 * Checks run before an export (SPEC 5.8(6), 5.9, 5.10).
 *
 * The dpi check is the one that matters in practice: Chromium embeds the
 * original pixels, so an image's real resolution is decided by how wide it
 * sits on the paper, and a book only finds out at the printer.
 */
export async function preflight(
  context: BuildContext,
  options: { forEpub: boolean },
): Promise<PreflightIssue[]> {
  const issues: PreflightIssue[] = [];

  for (const warning of context.warnings) {
    if (warning.kind === "broken-link") {
      issues.push({ level: "warning", message: t("preflight.brokenLink", { link: warning.message }) });
    } else if (warning.kind === "missing-asset") {
      issues.push({ level: "warning", message: t("preflight.missingAsset", { path: warning.message }) });
    } else {
      issues.push({ level: "warning", message: warning.message });
    }
  }

  issues.push(...checkResolution(context));
  issues.push(...(await checkFontAvailability(context)));
  issues.push(...checkCover(context, options.forEpub));

  return issues;
}

function checkResolution(context: BuildContext): PreflightIssue[] {
  const threshold = context.settings.dpiWarnThreshold;
  if (!threshold) return [];

  const pageWidth = pageWidthMm(context.config.size);
  if (!pageWidth) return [];
  // Without a measured layout the text block is the honest approximation:
  // theme-base leaves roughly 18 mm of margin on each side.
  const measure = Math.max(20, pageWidth - 36);

  const issues: PreflightIssue[] = [];
  for (const asset of context.workspace.assets.values()) {
    if (!asset.width || !isImagePath(asset.publicPath)) continue;
    // SVG is vector and stays sharp at any size.
    if (asset.mime === "image/svg+xml") continue;

    const widthMm = asset.displayWidthPx ? pxToMm(asset.displayWidthPx) : measure;
    const dpi = effectiveDpi(asset.width, Math.min(widthMm, measure));
    if (dpi > 0 && dpi < threshold) {
      issues.push({
        level: "warning",
        message: t("preflight.lowDpi", { name: asset.label, dpi, threshold }),
      });
    }
  }
  return issues;
}

async function checkFontAvailability(context: BuildContext): Promise<PreflightIssue[]> {
  if (!context.settings.warnMissingFonts) return [];
  const checks = await checkFonts([
    context.config.fontFamily,
    context.config.headingFontFamily,
    context.config.monospaceFontFamily,
  ]);
  return checks
    .filter((check) => !check.found)
    .map((check) => ({
      level: "warning" as const,
      message: t("preflight.missingFont", { family: check.family, actual: check.actual }),
    }));
}

/**
 * A cover cropped by `object-fit: cover` loses whatever does not fit, and
 * `bleed` / `marks` cannot be set for one page only (SPEC 5.9), so the size
 * mismatch is reported rather than worked around.
 */
function checkCover(context: BuildContext, forEpub: boolean): PreflightIssue[] {
  const { config } = context;
  if (!config.cover && !config.coverPage) {
    return forEpub ? [{ level: "warning", message: t("preflight.noCover") }] : [];
  }
  if (!config.cover || config.coverFit !== "cover") return [];

  const width = pageWidthMm(config.size);
  const height = pageHeightMm(config.size);
  if (!width || !height) return [];

  const asset = [...context.workspace.assets.values()].find(
    (candidate) => candidate.label.endsWith(config.cover) && candidate.width && candidate.height,
  );
  if (!asset?.width || !asset.height) return [];

  const pageRatio = width / height;
  const imageRatio = asset.width / asset.height;
  const difference = Math.abs(imageRatio - pageRatio) / pageRatio;
  if (difference < 0.02) return [];

  const croppedMm =
    imageRatio > pageRatio
      ? Math.round((1 - pageRatio / imageRatio) * width * 10) / 10
      : Math.round((1 - imageRatio / pageRatio) * height * 10) / 10;

  return [
    {
      level: "warning",
      message: t("preflight.coverAspect", {
        percent: Math.round(difference * 100),
        mm: croppedMm,
      }),
    },
  ];
}
