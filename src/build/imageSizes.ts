import type { App, TFile } from "obsidian";
import { imageSize, type ImageSize } from "../util/imageSize";
import { isImagePath } from "../util/paths";
import { throwIfAborted } from "../util/async";
import { log } from "../util/log";

/**
 * The intrinsic size of every picture the book refers to, read before it is
 * converted (SPEC 5.8(5), 5.8(3)).
 *
 * Knowing the shape of a picture is what lets the plugin work out the box it
 * should occupy instead of asking CSS to. CSS cannot do it: giving a replaced
 * element a definite size on one axis makes its ratio non-negotiable, so a
 * maximum on the other axis then trims the box rather than rescaling the
 * picture - which is how a figure at `60%` and one at `100%` came out the same
 * size, differing only in the blank reserved around them.
 *
 * `materializeAssets` already reads these on export, but it runs after the
 * documents are built, which is too late to size anything, and the preview
 * never ran it at all. Here it happens up front, for both.
 */

/**
 * Sizes already read, keyed by path *and* content stamp.
 *
 * The preview rebuilds on every keystroke-ish change, and re-reading every
 * picture each time would be the most expensive thing in the build. Keying on
 * mtime and length means an edited picture is still read again.
 */
const cache = new Map<string, ImageSize | null>();

function stamp(file: TFile): string {
  return `${file.path}:${file.stat.mtime}:${file.stat.size}`;
}

/**
 * Every picture reachable from the book's notes.
 *
 * `resolvedLinks` is Obsidian's own index and covers links and embeds alike,
 * so no Markdown has to be parsed to find them. Notes are followed as well as
 * pictures, because `![[Note]]` brings that note's figures into the book.
 */
function referencedImages(app: App, notes: TFile[], extra: TFile[]): TFile[] {
  const links = app.metadataCache.resolvedLinks ?? {};
  const seenNote = new Set<string>();
  const images = new Map<string, TFile>();

  for (const file of extra) {
    if (isImagePath(file.path)) images.set(file.path, file);
  }

  const queue = notes.slice();
  while (queue.length > 0) {
    const note = queue.shift()!;
    if (seenNote.has(note.path)) continue;
    seenNote.add(note.path);

    for (const target of Object.keys(links[note.path] ?? {})) {
      if (isImagePath(target)) {
        if (images.has(target)) continue;
        const file = app.vault.getFileByPath(target);
        if (file) images.set(target, file);
        continue;
      }
      if (!target.endsWith(".md") || seenNote.has(target)) continue;
      const file = app.vault.getFileByPath(target);
      if (file) queue.push(file);
    }
  }

  return [...images.values()];
}

async function readSize(app: App, file: TFile): Promise<ImageSize | null> {
  try {
    const bytes = new Uint8Array(await app.vault.readBinary(file));
    return imageSize(bytes, file.path);
  } catch (error) {
    log.info(`could not read the size of ${file.path}`, error);
    return null;
  }
}

/** Vault path -> intrinsic size, for the pictures whose format we can read. */
export async function collectImageSizes(
  app: App,
  notes: TFile[],
  extra: TFile[] = [],
  signal?: AbortSignal,
): Promise<Map<string, ImageSize>> {
  const sizes = new Map<string, ImageSize>();

  for (const file of referencedImages(app, notes, extra)) {
    throwIfAborted(signal);
    const key = stamp(file);
    let size = cache.get(key);
    if (size === undefined) {
      size = await readSize(app, file);
      cache.set(key, size);
    }
    if (size) sizes.set(file.path, size);
  }

  return sizes;
}
