import type { App, TFile } from "obsidian";
import { joinPosix } from "../util/paths";

/** Resolve YAML resources deterministically before asking Obsidian for a
 * short-name match. Its link resolver can prefer another images/cover.png
 * even when sourcePath points into this book.
 */
export function resolveBookFile(
  app: App,
  bookRoot: string,
  path: string,
  markdown = false,
): TFile | null {
  const input = path.replace(/\\/g, "/");
  if (!input) return null;
  const explicitRelative = /^\.{1,2}\//.test(input);
  const rootRelative = input.startsWith("/");
  const exact = (candidate: string): TFile | null => {
    const normalized = joinPosix(candidate).replace(/^\/+/, "");
    if (!normalized || normalized === ".." || normalized.startsWith("../")) return null;
    return app.vault.getFileByPath(normalized) ??
      (markdown && !/\.[^/]+$/.test(normalized)
        ? app.vault.getFileByPath(`${normalized}.md`) : null);
  };
  if (rootRelative) return exact(input);
  const local = exact(joinPosix(bookRoot, input));
  if (local || explicitRelative) return local;
  const fromRoot = exact(input);
  if (fromRoot) return fromRoot;
  // A path with directories is not permission to select a different folder.
  if (input.includes("/")) return null;
  return app.metadataCache.getFirstLinkpathDest(input, joinPosix(bookRoot, "vivlio.yaml"));
}
