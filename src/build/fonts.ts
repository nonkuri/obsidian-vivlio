import { warn, type BuildContext } from "./context";
import type { EmbedFont } from "../config/types";
import { normalizeAbsolute, sanitizeFileName, sha1, mimeType, extname } from "../util/paths";
import { log } from "../util/log";

interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
}

let localFontCache: LocalFontData[] | null = null;

/**
 * Installed font families (SPEC 5.10).
 *
 * `queryLocalFonts()` is granted without a prompt inside Electron, which is
 * what makes the font picker possible; when it is unavailable the caller falls
 * back to free text plus the canvas check below.
 */
export async function queryLocalFonts(): Promise<LocalFontData[] | null> {
  if (localFontCache) return localFontCache;
  const query = (window as unknown as {
    queryLocalFonts?: () => Promise<LocalFontData[]>;
  }).queryLocalFonts;
  if (typeof query !== "function") return null;
  try {
    localFontCache = await query();
    return localFontCache;
  } catch (error) {
    log.info("queryLocalFonts unavailable", error);
    return null;
  }
}

/** Distinct family names, Japanese-capable ones first. */
export async function localFontFamilies(): Promise<string[]> {
  const fonts = await queryLocalFonts();
  if (!fonts) return [];
  const families = [...new Set(fonts.map((font) => font.family))];
  families.sort((a, b) => {
    const ja = Number(hasJapanese(b)) - Number(hasJapanese(a));
    return ja !== 0 ? ja : a.localeCompare(b);
  });
  return families;
}

function hasJapanese(value: string): boolean {
  return /[぀-ヿ一-鿿]/.test(value);
}

/** First family in a CSS font stack, unquoted. */
export function firstFamily(stack: string): string {
  const first = stack.split(",")[0]?.trim() ?? "";
  return first.replace(/^['"]|['"]$/g, "");
}

export interface FontCheck {
  family: string;
  found: boolean;
  /** What the browser actually draws with, when the family is missing. */
  actual: string;
}

/**
 * Check that the requested families exist (SPEC 5.10).
 *
 * Chromium silently substitutes a missing font, which is the single most
 * common way a book comes out looking wrong on another machine, so both a
 * lookup and a width measurement are used.
 */
export async function checkFonts(stacks: string[]): Promise<FontCheck[]> {
  const installed = await queryLocalFonts();
  const installedSet = installed ? new Set(installed.map((font) => font.family)) : null;
  const out: FontCheck[] = [];

  for (const stack of stacks) {
    const family = firstFamily(stack);
    if (!family || isGenericFamily(family)) continue;

    let found = installedSet ? installedSet.has(family) : false;
    if (!found) found = measuresDifferently(family);

    out.push({ family, found, actual: found ? family : resolvedFamily(stack) });
  }
  return out;
}

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);

function isGenericFamily(family: string): boolean {
  return GENERIC.has(family.toLowerCase());
}

/**
 * Canvas measurement: a family that is not installed measures exactly like the
 * fallback, so a difference proves the font resolved.
 */
function measuresDifferently(family: string): boolean {
  try {
    if (typeof document.fonts?.check === "function" && document.fonts.check(`16px "${family}"`)) {
      return true;
    }
    const canvas = document.createElement("canvas");
    const gc = canvas.getContext("2d");
    if (!gc) return false;
    const sample = "あ漢A0";
    gc.font = "72px monospace";
    const fallback = gc.measureText(sample).width;
    gc.font = `72px "${family}", monospace`;
    return Math.abs(gc.measureText(sample).width - fallback) > 0.5;
  } catch {
    return false;
  }
}

/** The family the stack actually resolves to, for the warning text. */
function resolvedFamily(stack: string): string {
  for (const raw of stack.split(",")) {
    const family = raw.trim().replace(/^['"]|['"]$/g, "");
    if (!family) continue;
    if (isGenericFamily(family)) return family;
    if (measuresDifferently(family)) return family;
  }
  return "serif";
}

/**
 * `@font-face` rules for fonts shipped with the book (SPEC 5.10, methods B/C).
 *
 * These are embedded in the PDF whether or not the machine has them
 * installed, which is what makes a vault reproduce the same typesetting
 * everywhere.
 */
export function fontFaceRules(context: BuildContext): string {
  const rules: string[] = [];

  for (const font of context.config.embedFonts) {
    const url = resolveFontUrl(context, font);
    if (!url) continue;
    const format = fontFormat(font.src);
    rules.push(
      [
        "@font-face {",
        `  font-family: ${quoteFamily(font.family)};`,
        `  src: url("${url}")${format ? ` format("${format}")` : ""};`,
        `  font-weight: ${font.weight ?? 400};`,
        `  font-style: ${font.style ?? "normal"};`,
        "  font-display: block;",
        "}",
      ].join("\n"),
    );
  }
  return rules.join("\n\n");
}

function resolveFontUrl(context: BuildContext, font: EmbedFont): string | null {
  const isAbsolute = /^([a-zA-Z]:[\\/]|\/)/.test(font.src);

  if (!isAbsolute) {
    const file = context.app.vault.getFileByPath(font.src);
    if (!file) {
      warn(context, { kind: "missing-font", message: `${font.family}: ${font.src}` });
      return null;
    }
    if (context.mode === "preview") {
      return `${context.vaultBase}${file.path.split("/").map(encodeURIComponent).join("/")}`;
    }
    const asset = context.workspace.addAsset({
      publicPath: `assets/${sha1(file.path).slice(0, 8)}-${sanitizeFileName(file.name)}`,
      kind: "vault",
      vaultPath: file.path,
      mime: mimeType(file.name),
      label: file.path,
    });
    return asset.publicPath;
  }

  if (!context.settings.allowOutsideVaultPaths) {
    warn(context, {
      kind: "missing-font",
      message: `${font.family}: files outside the vault are not allowed`,
    });
    return null;
  }

  // Serving a path outside the vault needs an explicit root (SPEC 5.12).
  const absolute = normalizeAbsolute(font.src);
  const root = absolute.slice(0, absolute.lastIndexOf("/"));
  context.workspace.extraRoots.add(root);
  const asset = context.workspace.addAsset({
    publicPath: `assets/${sha1(absolute).slice(0, 8)}-${sanitizeFileName(
      font.src.split(/[\\/]/).pop() ?? "font",
    )}`,
    kind: "absolute",
    absolutePath: font.src,
    mime: mimeType(font.src),
    label: font.src,
  });
  return asset.publicPath;
}

function fontFormat(src: string): string {
  switch (extname(src)) {
    case ".woff2":
      return "woff2";
    case ".woff":
      return "woff";
    case ".otf":
      return "opentype";
    case ".ttf":
      return "truetype";
    default:
      return "";
  }
}

export function quoteFamily(family: string): string {
  const trimmed = family.trim();
  if (/^['"]/.test(trimmed)) return trimmed;
  return /^[A-Za-z][A-Za-z0-9 -]*$/.test(trimmed) ? trimmed : `"${trimmed}"`;
}
