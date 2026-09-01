import { createHash } from "crypto";
import * as nodePath from "path";

/** Natural order: `2.md` sorts before `10.md` (SPEC 5.2). */
export function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const ax = a.match(re) ?? [];
  const bx = b.match(re) ?? [];
  const length = Math.min(ax.length, bx.length);
  for (let i = 0; i < length; i++) {
    const an = Number(ax[i]);
    const bn = Number(bx[i]);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) {
      if (an !== bn) return an - bn;
    } else if (ax[i] !== bx[i]) {
      return ax[i] < bx[i] ? -1 : 1;
    }
  }
  return ax.length - bx.length;
}

export function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "" : path.slice(0, i);
}

export function extname(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i).toLowerCase();
}

export function stripExtension(path: string): string {
  const ext = extname(path);
  return ext ? path.slice(0, -ext.length) : path;
}

/** Join POSIX-style path segments and collapse `.` / `..`. */
export function joinPosix(...parts: string[]): string {
  const joined = parts.filter(Boolean).join("/");
  const absolute = joined.startsWith("/");
  const out: string[] = [];
  for (const segment of joined.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!absolute) out.push("..");
      continue;
    }
    out.push(segment);
  }
  return (absolute ? "/" : "") + out.join("/");
}

/** Turn arbitrary text into something safe for a file name. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return cleaned || "untitled";
}

/**
 * Normalize an absolute filesystem path for containment checks: resolves
 * `..`, unifies separators and strips the Windows `\\?\` long-path prefix
 * (SPEC 5.12, defence 5).
 */
export function normalizeAbsolute(path: string): string {
  let normalized = nodePath.resolve(path);
  if (normalized.startsWith("\\\\?\\")) normalized = normalized.slice(4);
  normalized = normalized.split("\\").join("/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** True when `child` is `root` itself or lives under it. */
export function isInside(root: string, child: string): boolean {
  const r = normalizeAbsolute(root).replace(/\/+$/, "");
  const c = normalizeAbsolute(child);
  return c === r || c.startsWith(`${r}/`);
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".xhtml": "application/xhtml+xml; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".apng": "image/apng",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
};

export function mimeType(path: string): string {
  return MIME_TYPES[extname(path)] ?? "application/octet-stream";
}

/** Image extensions the plugin resolves (SPEC 5.8(2)). */
export const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".gif",
  ".webp",
  ".apng",
  ".avif",
  ".bmp",
];

/** EPUB 3 core media types; `avif` / `bmp` are not among them (SPEC 5.8(7)). */
export const EPUB_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"];

export const FONT_EXTENSIONS = [".ttf", ".otf", ".woff", ".woff2"];

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.includes(extname(path));
}

export function isFontPath(path: string): boolean {
  return FONT_EXTENSIONS.includes(extname(path));
}

/** Percent-decode a Markdown URL, tolerating malformed escapes. */
export function decodeUrlPath(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}
