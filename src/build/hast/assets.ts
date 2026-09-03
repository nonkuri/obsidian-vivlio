import type { TFile } from "obsidian";
import { warn, type BuildContext } from "../context";
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
    const image = node as UElement;
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
  return context.workspace.addAsset({
    publicPath,
    kind: "vault",
    vaultPath: file.path,
    mime: mimeType(file.name),
    label: file.path,
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
 * big is *this* figure against the text block. `%` is the one that matters
 * for a book - an image's percentage inline size resolves against its
 * containing block, which is the text block - and it is the one a book-wide
 * setting could never express, because the answer differs per figure.
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

/** CSS px per millimetre, which is what a `mm` width is worth to the dpi check. */
const PX_PER_MM = 96 / 25.4;

/**
 * Turn Obsidian's pixel width into a logical size.
 *
 * `width` is wrong in vertical writing - the physical axis flips - so the
 * output uses `inline-size` (SPEC 5.8(3)).
 */
function applySize(
  context: BuildContext,
  image: UElement,
  size: SizeHint,
  asset: AssetRef,
): void {
  if (size.width === null) return;

  const unit = size.unit ?? context.config.imageWidthUnit;
  const inline =
    unit === "percent"
      ? `${size.width}%`
      : unit === "mm"
        ? `${size.width}mm`
        : `min(${size.width}px, 100%)`;

  // A figure wider than the text block breaks the page rather than the
  // figure; `px` already caps itself with the `min()` above.
  const declarations = [`inline-size: ${inline}`];
  if (unit !== "px") declarations.push("max-inline-size: 100%");
  if (size.height !== null) declarations.push(`block-size: ${size.height}px`);
  const existing = String(image.properties.style ?? "").trim();
  image.properties.style = [existing, declarations.join("; ")]
    .filter(Boolean)
    .join("; ");

  // What the dpi check compares the intrinsic size against. A percentage is
  // left out: it is a share of a text block whose width depends on margins
  // the theme decides, so any number here would be a guess.
  const displayPx =
    unit === "px" ? size.width : unit === "mm" ? size.width * PX_PER_MM : null;
  if (displayPx !== null) {
    asset.displayWidthPx = Math.max(asset.displayWidthPx ?? 0, displayPx);
  }
}
