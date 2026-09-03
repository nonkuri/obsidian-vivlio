import type { App, TFile } from "obsidian";
import { warn, type BuildContext } from "./context";
import { SELECTABLE_THEMES, bundledThemePath, themeAssets } from "../vendor/assets";
import { dirname, joinPosix } from "../util/paths";
import { log } from "../util/log";

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
 * A theme of one's own starts from a bundled one by importing `vivlio:novel`,
 * or `vivlio:base`, `vivlio:bunko`, `vivlio:techbook`, `vivlio:academic`. All
 * five still resolve; the picker offers only the ones in `SELECTABLE_THEMES`.
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
  return flattenVaultTheme(context.app, file.path, new Set());
}

async function flattenVaultTheme(
  app: App,
  path: string,
  seen: Set<string>,
): Promise<string> {
  if (seen.has(path)) return "";
  seen.add(path);

  const file = app.vault.getFileByPath(path);
  if (!file) return "";

  let source: string;
  try {
    source = await app.vault.cachedRead(file);
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
    resolved.set(target, await inlineImport(app, dirname(path), target, seen));
  }

  return source.replace(IMPORT, (match, urlTarget: string, quotedTarget: string) => {
    const target = urlTarget ?? quotedTarget;
    return resolved.get(target) ?? match;
  });
}

async function inlineImport(
  app: App,
  from: string,
  target: string,
  seen: Set<string>,
): Promise<string> {
  const bundled = BUNDLED_SCHEME.exec(target);
  if (bundled) return flattenBundledTheme(bundledThemePath(bundled[1].trim()) ?? "");

  // A remote stylesheet is left where it is: the preview can fetch it, and an
  // EPUB may not carry it anyway.
  if (/^[a-z]+:/i.test(target)) return `@import url("${target}");`;

  return flattenVaultTheme(app, joinPosix(from, target), seen);
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
  const choices: ThemeChoice[] = SELECTABLE_THEMES.map((name) => ({
    value: name,
    label: name,
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
