import type { TFile } from "obsidian";
import { warn, type BuildContext } from "../context";
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
  basename,
  decodeUrlPath,
  extname,
  isImagePath,
  joinPosix,
  mimeType,
  sanitizeFileName,
  sha1,
  dirname,
} from "../../util/paths";

/** `![[file.ext]]` with the optional `|300` / `|300x200` size suffix. */
const IMAGE_EMBED = /!\[\[([^\]|#^]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

interface SizeHint {
  width: number | null;
  height: number | null;
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

    // Obsidian puts the size in the alt text: ![alt|300](fig.png)
    const alt = String(image.properties.alt ?? "");
    const pipe = alt.lastIndexOf("|");
    let size: SizeHint = { width: null, height: null, caption: null };
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
  const publicPath = `assets/${sha1(file.path).slice(0, 8)}-${sanitizeFileName(file.name)}`;
  return context.workspace.addAsset({
    publicPath,
    kind: "vault",
    vaultPath: file.path,
    mime: mimeType(file.name),
    label: file.path,
  });
}

export function registerExternal(context: BuildContext, url: string): AssetRef {
  const name = sanitizeFileName(basename(new URL(url).pathname) || "remote");
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

function parseSize(suffix: string): SizeHint {
  const value = suffix.trim();
  if (!value) return { width: null, height: null, caption: null };
  const match = value.match(/^(\d+)(?:x(\d+))?$/);
  if (!match) return { width: null, height: null, caption: value };
  return {
    width: Number(match[1]),
    height: match[2] ? Number(match[2]) : null,
    caption: null,
  };
}

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

  const unit = context.config.imageWidthUnit;
  const inline =
    unit === "percent"
      ? `${size.width}%`
      : unit === "mm"
        ? `${size.width}mm`
        : `min(${size.width}px, 100%)`;

  const declarations = [`inline-size: ${inline}`];
  if (size.height !== null) declarations.push(`block-size: ${size.height}px`);
  const existing = String(image.properties.style ?? "").trim();
  image.properties.style = [existing, declarations.join("; ")]
    .filter(Boolean)
    .join("; ");

  if (unit === "px") {
    asset.displayWidthPx = Math.max(asset.displayWidthPx ?? 0, size.width);
  }
}
