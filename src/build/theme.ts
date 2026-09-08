import type { App, TFile } from "obsidian";
import { warn, type BuildContext } from "./context";
import { SELECTABLE_THEMES, bundledThemePath, themeAssets } from "../vendor/assets";
import {
  assetFileName,
  decodeUrlPath,
  dirname,
  joinPosix,
  mimeType,
  sha1,
} from "../util/paths";
import { log } from "../util/log";
import { t, type StringKey } from "../i18n";
import { mapCssUrls } from "../util/css";

/**
 * Themes the book can be set in: the bundled ones, and any stylesheet the
 * writer keeps in the vault (SPEC 5.10).
 *
 * A vault theme is resolved into one stylesheet before it is used, rather than
 * being linked where it lies. Both outputs then read the same text: the
 * preview links the resolved copy, and the EPUB packs it. It also lets a theme
 * of one's own start from one of the bundled ones, which is what anyone will
 * want to do first and cannot do with a relative path - the bundled themes are
 * embedded in the plugin, not files in the vault.
 *
 * A theme of one's own starts from a bundled one by importing, for example,
 * `vivlio:novel`, `vivlio:english-novel` or `vivlio:base`. Every name in the
 * resolution table remains available; the picker offers only the ones in
 * `SELECTABLE_THEMES`.
 *
 * Anything else is an ordinary import: a path relative to the importing file,
 * read from the vault.
 */

/** Name of the resolved vault theme inside the workspace. */
export const THEME_STYLESHEET = "theme.css";

/** `@import url(...)`, in any of the spellings CSS allows. */
const IMPORT = /@import\s+(?:url\(\s*["']?([^"')]+)["']?\s*\)|["']([^"']+)["'])\s*;/g;

/** How a vault theme names one of the bundled themes. */
const BUNDLED_SCHEME = /^vivlio:(.+)$/;

/** The vault file a `theme` setting points at, or null when it names a bundled one. */
export function vaultThemeFile(context: BuildContext): TFile | null {
  const theme = context.config.theme || "";
  if (!theme || bundledThemePath(theme)) return null;
  return context.app.vault.getFileByPath(theme);
}

/**
 * Resolve a vault theme into a single stylesheet, or null when the book uses a
 * bundled one.
 *
 * Imports are followed once each: a stylesheet that imports itself, directly
 * or round a ring, would otherwise never finish.
 */
export async function resolveVaultTheme(context: BuildContext): Promise<string | null> {
  const file = vaultThemeFile(context);
  if (!file) {
    if (context.config.theme && !bundledThemePath(context.config.theme)) {
      warn(context, {
        kind: "config",
        message: `theme: ${context.config.theme} not found; using the default`,
      });
    }
    return null;
  }
  return flattenVaultTheme(context, file.path, new Set());
}

async function flattenVaultTheme(
  context: BuildContext,
  path: string,
  seen: Set<string>,
): Promise<string> {
  if (seen.has(path)) return "";
  seen.add(path);

  const file = context.app.vault.getFileByPath(path);
  if (!file) return "";

  let source: string;
  try {
    source = await context.app.vault.cachedRead(file);
  } catch (error) {
    log.error(`could not read the theme ${path}`, error);
    return "";
  }

  // The imports are replaced in one pass, so they are collected first: the
  // reads are asynchronous and `String.replace` is not.
  const targets = [...source.matchAll(IMPORT)].map((match) => match[1] ?? match[2]);
  const resolved = new Map<string, string>();
  for (const target of targets) {
    if (resolved.has(target)) continue;
    resolved.set(target, await inlineImport(context, dirname(path), target, seen));
  }

  // Resolve URLs before inserting imported text. Each stylesheet's relative
  // references must use that stylesheet's own directory; doing this after
  // flattening would incorrectly resolve every imported URL beside the root.
  const rewritten = rewriteVaultAssetUrls(context, path, source);
  return rewritten.replace(IMPORT, (match, urlTarget: string, quotedTarget: string) => {
    const target = urlTarget ?? quotedTarget;
    return resolved.get(target) ?? match;
  });
}

async function inlineImport(
  context: BuildContext,
  from: string,
  target: string,
  seen: Set<string>,
): Promise<string> {
  const bundled = BUNDLED_SCHEME.exec(target);
  if (bundled) return flattenBundledTheme(bundledThemePath(bundled[1].trim()) ?? "");

  // A remote stylesheet is left where it is: the preview can fetch it, and an
  // EPUB may not carry it anyway.
  if (/^[a-z]+:/i.test(target)) return `@import url("${target}");`;

  return flattenVaultTheme(context, joinPosix(from, target), seen);
}

/** Register and rewrite local files referenced by one Vault stylesheet. */
function rewriteVaultAssetUrls(
  context: BuildContext,
  sourcePath: string,
  source: string,
): string {
  // `url(...)` inside @import names another stylesheet, not an asset. Imports
  // are expanded separately below and retain their original spelling here.
  const imports = [...source.matchAll(IMPORT)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));

  return mapCssUrls(source, ({ value, start }) => {
    if (imports.some((range) => start >= range.start && start < range.end)) return value;

    const reference = decodeCssUrl(value.trim());
    if (
      !reference ||
      reference.startsWith("#") ||
      reference.startsWith("//") ||
      /^[a-z][a-z0-9+.-]*:/i.test(reference)
    ) {
      return value;
    }

    const suffixAt = reference.search(/[?#]/);
    const rawPath = suffixAt === -1 ? reference : reference.slice(0, suffixAt);
    const suffix = suffixAt === -1 ? "" : reference.slice(suffixAt);
    if (!rawPath) return value;

    const decoded = decodeUrlPath(rawPath);
    const vaultPath = decoded.startsWith("/")
      ? joinPosix(decoded.slice(1))
      : joinPosix(dirname(sourcePath), decoded);
    const file = context.app.vault.getFileByPath(vaultPath);
    if (!file) {
      warn(context, { kind: "missing-asset", message: rawPath, source: sourcePath });
      return value;
    }

    const publicPath = `assets/${sha1(file.path).slice(0, 8)}-${assetFileName(file.name)}`;
    const intrinsic = context.imageSizes?.get(file.path);
    const asset = context.workspace.addAsset({
      publicPath,
      kind: "vault",
      vaultPath: file.path,
      mime: mimeType(file.name),
      label: file.path,
      stylesheetAsset: true,
      ...(intrinsic ? { width: intrinsic.width, height: intrinsic.height } : {}),
    });
    // The same file may already have been registered by a generated cover.
    // Asset registration deduplicates by public path, so merge its CSS usage.
    asset.stylesheetAsset = true;
    return `${asset.publicPath}${suffix}`;
  });
}

/** Decode the CSS escapes commonly used for spaces and non-ASCII paths. */
function decodeCssUrl(value: string): string {
  return value.replace(
    /\\(?:([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\r\n|([\s\S]))/gi,
    (_match, hex: string | undefined, escaped: string | undefined) =>
      hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : (escaped ?? ""),
  );
}

/** Inline the `@import` chain of a bundled theme over the embedded files. */
export function flattenBundledTheme(path: string, seen = new Set<string>()): string {
  if (!path || seen.has(path)) return "";
  seen.add(path);

  const source = themeAssets[path]?.text;
  if (source === undefined) return "";

  return source.replace(IMPORT, (match, urlTarget: string, quotedTarget: string) => {
    const target = urlTarget ?? quotedTarget;
    const bundled = BUNDLED_SCHEME.exec(target);
    if (bundled) return flattenBundledTheme(bundledThemePath(bundled[1].trim()) ?? "", seen);
    if (/^[a-z]+:/i.test(target)) return "";
    return flattenBundledTheme(joinPosix(dirname(path), target), seen);
  });
}

export interface ThemeChoice {
  /** What goes in `theme`: a bundled name, or a vault path. */
  value: string;
  label: string;
}

/**
 * Every theme a picker can offer: the bundled ones ready to be chosen, plus
 * every stylesheet in the vault.
 *
 * The current value is kept even when nothing matches it, so a setting that
 * points at a stylesheet since renamed - or at a bundled theme the picker no
 * longer lists - is visible rather than silently replaced by whatever the
 * list happens to start with.
 */
export function themeChoices(app: App, current = ""): ThemeChoice[] {
  // A bundled theme is named for the kind of book it sets, which is what a
  // picker has to say: "novel" alone does not tell anyone it is the vertical
  // one. A vault stylesheet is shown by its path, which already says it.
  const choices: ThemeChoice[] = SELECTABLE_THEMES.map((name) => ({
    value: name,
    label: t(`theme.${name}` as StringKey),
  }));

  const vault = app.vault
    .getFiles()
    .filter((file) => file.extension === "css")
    .map((file) => file.path)
    .sort((a, b) => a.localeCompare(b));
  for (const path of vault) choices.push({ value: path, label: path });

  if (current && !choices.some((choice) => choice.value === current)) {
    choices.push({ value: current, label: current });
  }
  return choices;
}
