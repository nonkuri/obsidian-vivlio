import type { TFile } from "obsidian";
import { warn, type BuildContext } from "../context";
import { textBlockMm, type TextBlockMm } from "../css";
import { mmToPx, pxToMm } from "../../util/imageSize";
import type { ImageWidthUnit } from "../../config/types";
import {
  addClass,
  element,
  isElement,
  replaceTextNodes,
  text,
  visit,
  type UElement,
  type UNode,
} from "../../util/tree";
import type { AssetRef } from "../workspace";
import {
  assetFileName,
  basename,
  decodeUrlPath,
  extname,
  isImagePath,
  joinPosix,
  mimeType,
  sha1,
  dirname,
} from "../../util/paths";

/** `![[file.ext]]` with the optional `|300` / `|300x200` size suffix. */
const IMAGE_EMBED = /!\[\[([^\]|#^]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

interface SizeHint {
  width: number | null;
  height: number | null;
  /** The unit written on this image; null follows the book's `imageWidthUnit`. */
  unit: ImageWidthUnit | null;
  caption: string | null;
}

/**
 * Resolve image references and collect them as assets (SPEC 5.3 #8, 5.8).
 *
 * Vault links must go through `metadataCache.getFirstLinkpathDest()`: joining
 * paths by hand cannot reproduce Obsidian's shortest-path links or its
 * attachment folder setting.
 */
export function assetsPlugin(context: BuildContext, sourcePath: string) {
  return function attach() {
    return (tree: UNode): void => {
      if (context.config.syntax.imageEmbed) {
        replaceTextNodes(tree, {
          test: IMAGE_EMBED,
          replace: (match) => embedToNodes(context, sourcePath, match[1].trim(), match[2] ?? ""),
        });
      }
      rewriteImageElements(context, sourcePath, tree);
    };
  };
}

function embedToNodes(
  context: BuildContext,
  sourcePath: string,
  linkpath: string,
  suffix: string,
): UNode[] | null {
  const file = context.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
  const extension = extname(linkpath) || (file ? `.${file.extension}` : "");

  // Markdown embeds were already expanded on the mdast side.
  if (extension === ".md" || extension === "") return null;

  if (extension === ".excalidraw") {
    const drawing = findExcalidrawExport(context, linkpath, sourcePath);
    if (!drawing) {
      warn(context, {
        kind: "unsupported",
        message: `${linkpath}: Excalidraw drawings need an exported .svg or .png next to them`,
        source: sourcePath,
      });
      return [placeholder(linkpath)];
    }
    return [imageNode(context, drawing, parseSize(suffix))];
  }

  if (extension === ".canvas" || extension === ".pdf") {
    warn(context, {
      kind: "unsupported",
      message: `${linkpath}: ${extension} embeds are not supported`,
      source: sourcePath,
    });
    return [placeholder(linkpath)];
  }

  if (!isImagePath(linkpath)) return null;

  if (!file) {
    warn(context, { kind: "missing-asset", message: linkpath, source: sourcePath });
    return [placeholder(linkpath)];
  }
  return [imageNode(context, file, parseSize(suffix))];
}

function rewriteImageElements(
  context: BuildContext,
  sourcePath: string,
  tree: UNode,
): void {
  visit(tree, (node) => {
    if (!isElement(node, "img")) return;
    const image = node;
    const rawSrc = String(image.properties.src ?? "");
    if (!rawSrc) return;

    // An `![[embed]]` was already resolved by the pass above, and outside the
    // preview its src is the asset's own path in the output - `assets/…`,
    // which is not a vault path. Resolving it a second time finds nothing, so
    // every wiki-embedded image came out of an export blank. The workspace
    // knows the paths it issued, which is the exact test for "mine already".
    if (context.workspace.getAsset(rawSrc)) return;

    // Obsidian puts the size in the alt text: ![alt|300](fig.png)
    const alt = String(image.properties.alt ?? "");
    const pipe = alt.lastIndexOf("|");
    let size: SizeHint = { width: null, height: null, unit: null, caption: null };
    if (pipe !== -1) {
      const parsed = parseSize(alt.slice(pipe + 1));
      if (parsed.width !== null) {
        size = parsed;
        image.properties.alt = alt.slice(0, pipe);
      }
    }

    if (/^https?:\/\//i.test(rawSrc)) {
      const asset = registerExternal(context, rawSrc);
      image.properties.src =
        context.mode === "preview" ? rawSrc : asset.publicPath;
      applySize(context, image, size, asset);
      return;
    }
    if (/^data:/i.test(rawSrc)) return;

    const target = resolveVaultFile(context, decodeUrlPath(rawSrc), sourcePath);
    if (!target) {
      warn(context, { kind: "missing-asset", message: rawSrc, source: sourcePath });
      image.properties.src = "";
      addClass(image, "vivlio-missing");
      return;
    }
    const asset = registerVaultAsset(context, target);
    image.properties.src = srcFor(context, asset);
    applySize(context, image, size, asset);
  });
}

function imageNode(context: BuildContext, file: TFile, size: SizeHint): UElement {
  const asset = registerVaultAsset(context, file);
  const image = element("img", {
    src: srcFor(context, asset),
    alt: size.caption ?? "",
  });
  applySize(context, image, size, asset);
  return image;
}

function placeholder(label: string): UElement {
  return element("span", { className: ["vivlio-placeholder"] }, [text(`[${label}]`)]);
}

/** Obsidian's Excalidraw plugin can auto-export a drawing next to the source. */
function findExcalidrawExport(
  context: BuildContext,
  linkpath: string,
  sourcePath: string,
): TFile | null {
  for (const extension of [".svg", ".png", ".dark.svg", ".light.svg"]) {
    const candidate = context.app.metadataCache.getFirstLinkpathDest(
      `${linkpath}${extension}`,
      sourcePath,
    );
    if (candidate) return candidate;
  }
  const base = linkpath.replace(/\.excalidraw$/i, "");
  for (const extension of [".svg", ".png"]) {
    const candidate = context.app.metadataCache.getFirstLinkpathDest(
      `${base}${extension}`,
      sourcePath,
    );
    if (candidate) return candidate;
  }
  return null;
}

export function resolveVaultFile(
  context: BuildContext,
  reference: string,
  sourcePath: string,
): TFile | null {
  const cleaned = reference.replace(/^<|>$/g, "").split("#")[0].trim();
  if (!cleaned) return null;

  const direct = context.app.metadataCache.getFirstLinkpathDest(cleaned, sourcePath);
  if (direct) return direct;

  const relative = joinPosix(dirname(sourcePath), cleaned);
  const file = context.app.vault.getFileByPath(relative);
  return file ?? null;
}

/** `assets/<sha1-8>-<name>` keeps same-named files from different folders apart. */
export function registerVaultAsset(context: BuildContext, file: TFile): AssetRef {
  const publicPath = `assets/${sha1(file.path).slice(0, 8)}-${assetFileName(file.name)}`;
  const intrinsic = context.imageSizes?.get(file.path);
  return context.workspace.addAsset({
    publicPath,
    kind: "vault",
    vaultPath: file.path,
    mime: mimeType(file.name),
    label: file.path,
    ...(intrinsic ? { width: intrinsic.width, height: intrinsic.height } : {}),
  });
}

export function registerExternal(context: BuildContext, url: string): AssetRef {
  const name = assetFileName(basename(new URL(url).pathname) || "remote");
  const publicPath = `assets/${sha1(url).slice(0, 8)}-${name}`;
  return context.workspace.addAsset({
    publicPath,
    kind: "external",
    url,
    mime: mimeType(name),
    label: url,
  });
}

/**
 * Where the document should point at an asset.
 *
 * The preview streams straight from the vault so a rebuild never copies
 * anything; exports use the stable `assets/...` name (SPEC 5.8(2)).
 */
export function srcFor(context: BuildContext, asset: AssetRef): string {
  if (context.mode === "preview" && asset.kind === "vault" && asset.vaultPath) {
    return `${context.vaultBase}${asset.vaultPath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  }
  return asset.publicPath;
}

/**
 * The `|…` suffix of an embed: `300`, `300x200`, `60%`, `80mm`.
 *
 * A bare number is Obsidian's own syntax and keeps meaning whatever the book
 * says (`imageWidthUnit`), so nothing already written moves. A number with a
 * unit is this plugin's, and answers the question a bare number cannot: how
 * big is *this* figure on the paper. `%` is the one a book-wide setting could
 * never express, because the answer differs per figure.
 *
 * Every one of them names the picture's **width as printed**, in both writing
 * modes - which is what the writer is looking at in the editor, and what they
 * mean by "this one is 60%". Saying it in logical terms instead made a number
 * mean the height of the picture in a vertical book, and the width in a
 * horizontal one.
 *
 * Anything else is a caption, as before.
 */
function parseSize(suffix: string): SizeHint {
  const value = suffix.trim();
  const none: SizeHint = { width: null, height: null, unit: null, caption: null };
  if (!value) return none;

  const box = value.match(/^(\d+)x(\d+)$/);
  if (box) return { width: Number(box[1]), height: Number(box[2]), unit: null, caption: null };

  const sized = value.match(/^(\d+(?:\.\d+)?)(%|mm|px)?$/);
  if (!sized) return { ...none, caption: value };
  return {
    width: Number(sized[1]),
    height: null,
    unit: sized[2] ? UNIT_BY_SUFFIX[sized[2]] : null,
    caption: null,
  };
}

const UNIT_BY_SUFFIX: Record<string, ImageWidthUnit> = {
  "%": "percent",
  mm: "mm",
  px: "px",
};

/**
 * Size a picture, on paper, to the width it was asked for.
 *
 * The plugin works the box out itself rather than handing CSS a size and a
 * maximum and hoping. It cannot be left to CSS: a definite size on one axis
 * makes a replaced element's ratio non-negotiable, and a maximum on the other
 * axis then trims the *box* instead of rescaling the picture. Measured, in
 * plain Chromium as well as in the typesetter: a 1400x900 picture given
 * `inline-size: 100%` in a 300x400 frame came out in a 300x400 box - so a
 * figure at 60% and the same figure at 100% printed at identical size, and
 * only the blank reserved around them changed.
 *
 * With the intrinsic size in hand there is nothing to negotiate. One axis is
 * written, the other is left automatic, and the number is brought inside the
 * text block here, before CSS sees it.
 *
 * The width is written physically. `width` on its own is safe in any writing
 * mode - what made it wrong before was the *percentage*, which resolves
 * against a containing block that shrink-wraps the picture in vertical text.
 * These are absolute lengths.
 */
function applySize(
  context: BuildContext,
  image: UElement,
  size: SizeHint,
  asset: AssetRef,
): void {
  const block = textBlockMm(context.config);
  const ratio =
    asset.width && asset.height ? asset.width / asset.height : null;

  // `300x200` names a box outright. That is an instruction, not a request to
  // fit something, so it is passed through as given.
  if (size.width !== null && size.height !== null) {
    addStyle(image, [
      `width: ${size.width}px`,
      `height: ${size.height}px`,
    ]);
    asset.displayWidthPx = Math.max(asset.displayWidthPx ?? 0, size.width);
    return;
  }

  const asked = requestedWidthMm(context, size, block);

  // Nothing to do: no size asked for, and no way to check the fit either.
  if (asked === null && !(block && ratio)) return;

  let widthMm = asked ?? pxToMm(asset.width ?? 0);
  if (widthMm <= 0) return;

  if (block && ratio) {
    // Fit inside the text block, along whichever axis runs out first. Both
    // are checked, because a picture can be too wide, too tall, or both.
    widthMm = Math.min(widthMm, block.widthMm, block.heightMm * ratio);
  } else if (block) {
    widthMm = Math.min(widthMm, block.widthMm);
  }

  // A picture nobody sized, that already fits, is left exactly as it is.
  if (asked === null && ratio && Math.abs(widthMm - pxToMm(asset.width ?? 0)) < 0.01) {
    return;
  }

  addStyle(image, [widthDeclaration(context, widthMm, block), "height: auto"]);
  asset.displayWidthPx = Math.max(asset.displayWidthPx ?? 0, mmToPx(widthMm));
}

/** The width the writer asked for, in millimetres, or null if they did not. */
function requestedWidthMm(
  context: BuildContext,
  size: SizeHint,
  block: TextBlockMm | null,
): number | null {
  if (size.width === null) return null;
  const unit = size.unit ?? context.config.imageWidthUnit;
  if (unit === "mm") return size.width;
  if (unit === "px") return pxToMm(size.width);
  // A percentage is a share of the printed width of the text block, which is
  // the thing a reader compares a figure against. Without a text block there
  // is nothing to take a share of.
  return block ? (block.widthMm * size.width) / 100 : null;
}

/**
 * Millimetres for print, `rem` for a reflowable reader.
 *
 * An EPUB has no page whose width is known here, and its root font size is
 * deliberately left to the reader (see epubStylesheet), so a figure given in
 * `rem` keeps its proportion to the type at whatever size that reader has
 * chosen. In paged output the root size is the one derived from the paper, so
 * the two spellings describe the same picture.
 */
function widthDeclaration(
  context: BuildContext,
  widthMm: number,
  block: TextBlockMm | null,
): string {
  if (context.mode === "epub" && block) {
    return `width: ${(widthMm / block.fontMm).toFixed(3)}rem`;
  }
  return `width: ${widthMm.toFixed(2)}mm`;
}

function addStyle(image: UElement, declarations: string[]): void {
  const existing = String(image.properties.style ?? "").trim();
  image.properties.style = [existing, declarations.join("; ")]
    .filter(Boolean)
    .join("; ");
}
