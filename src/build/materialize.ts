import { requestUrl } from "obsidian";
import { warn, type BuildContext } from "./context";
import type { AssetRef } from "./workspace";
import { imageSize } from "../util/imageSize";
import { EPUB_IMAGE_EXTENSIONS, extname, stripExtension } from "../util/paths";
import { throwIfAborted } from "../util/async";
import { log } from "../util/log";

export interface MaterializeOptions {
  /** EPUB has to carry every byte, and only core media types (SPEC 5.8(7)). */
  forEpub: boolean;
  /** Keep bytes in memory after reading them. */
  keepBytes: boolean;
}

/**
 * Prepare the assets a book refers to before exporting (SPEC 5.8(2)).
 *
 * The preview never comes through here: it streams straight from the vault.
 * Exporting has to resolve remote images (EPUB 3 forbids remote references),
 * read intrinsic sizes for the dpi check, and convert media types EPUB
 * readers do not accept.
 */
export async function materializeAssets(
  context: BuildContext,
  options: MaterializeOptions,
): Promise<void> {
  for (const asset of context.workspace.assets.values()) {
    throwIfAborted(context.signal);

    let bytes: Uint8Array | null = null;
    if (asset.kind === "vault") {
      bytes = await readVaultAsset(context, asset);
    } else if (asset.kind === "absolute") {
      bytes = await readAbsoluteAsset(context, asset);
    } else if (asset.kind === "external") {
      bytes = await downloadAsset(context, asset);
    }
    if (!bytes) continue;

    const size = imageSize(bytes, asset.publicPath);
    if (size) {
      asset.width = size.width;
      asset.height = size.height;
    }

    if (options.forEpub) {
      const converted = await ensureEpubMediaType(context, asset, bytes);
      asset.bytes = converted;
      continue;
    }

    // For PDF the file itself is streamed from disk; only remote downloads and
    // conversions have to stay in memory.
    if (options.keepBytes || asset.kind === "external") asset.bytes = bytes;
  }
}

async function readVaultAsset(
  context: BuildContext,
  asset: AssetRef,
): Promise<Uint8Array | null> {
  const file = context.app.vault.getFileByPath(asset.vaultPath ?? "");
  if (!file) {
    warn(context, { kind: "missing-asset", message: asset.label });
    return null;
  }
  try {
    return new Uint8Array(await context.app.vault.readBinary(file));
  } catch (error) {
    log.error(`could not read ${asset.label}`, error);
    warn(context, { kind: "missing-asset", message: asset.label });
    return null;
  }
}

async function readAbsoluteAsset(
  context: BuildContext,
  asset: AssetRef,
): Promise<Uint8Array | null> {
  try {
    const fs = await import("fs");
    return new Uint8Array(await fs.promises.readFile(asset.absolutePath ?? ""));
  } catch (error) {
    log.error(`could not read ${asset.label}`, error);
    warn(context, { kind: "missing-asset", message: asset.label });
    return null;
  }
}

/**
 * Remote images are downloaded on export because EPUB 3 does not allow remote
 * resources, and because a PDF should not depend on a server still being up.
 */
async function downloadAsset(
  context: BuildContext,
  asset: AssetRef,
): Promise<Uint8Array | null> {
  if (!context.settings.downloadRemoteImages) {
    warn(context, {
      kind: "missing-asset",
      message: `${asset.label} (downloading remote images is turned off)`,
    });
    return null;
  }
  try {
    const response = await requestUrl({ url: asset.url ?? "", throw: true });
    const contentType = response.headers?.["content-type"];
    if (contentType) asset.mime = contentType.split(";")[0].trim();
    return new Uint8Array(response.arrayBuffer);
  } catch (error) {
    log.error(`could not download ${asset.label}`, error);
    warn(context, { kind: "missing-asset", message: asset.label });
    return null;
  }
}

/**
 * EPUB 3 core media types are GIF / JPEG / PNG / SVG / WebP, so anything else
 * is re-encoded as PNG in the renderer (SPEC 5.8(7)).
 */
async function ensureEpubMediaType(
  context: BuildContext,
  asset: AssetRef,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const extension = extname(asset.publicPath);
  if (EPUB_IMAGE_EXTENSIONS.includes(extension)) return bytes;
  if (!extension || extension === ".ttf" || extension === ".otf") return bytes;
  if (extension === ".woff" || extension === ".woff2") return bytes;

  try {
    const blob = new Blob([bytes as unknown as BlobPart], { type: asset.mime });
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const gc = canvas.getContext("2d");
    if (!gc) throw new Error("no 2d context");
    gc.drawImage(bitmap, 0, 0);
    const png = await canvas.convertToBlob({ type: "image/png" });
    asset.mime = "image/png";
    // The documents keep pointing at the original name; the packer rewrites
    // them when it serializes each chapter.
    asset.epubPath = `${stripExtension(asset.publicPath)}.png`;
    return new Uint8Array(await png.arrayBuffer());
  } catch (error) {
    log.error(`could not convert ${asset.label} for EPUB`, error);
    warn(context, {
      kind: "unsupported",
      message: `${asset.label}: ${extension} is not an EPUB media type and could not be converted`,
    });
    return bytes;
  }
}
