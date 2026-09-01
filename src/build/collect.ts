import { TFile, TFolder, type App } from "obsidian";
import GithubSlugger from "github-slugger";
import type { HeadingEntry } from "./context";
import { naturalCompare, stripExtension } from "../util/paths";

/** What the user asked to typeset. */
export type BuildTarget =
  | { kind: "note"; file: TFile }
  | { kind: "folder"; folder: TFolder }
  | { kind: "toc"; file: TFile };

export interface CollectedNote {
  file: TFile;
  /** `vivlio-order`, used as the primary sort key when present. */
  order: number | null;
}

const WIKILINK = /!?\[\[([^\]]+)\]\]/g;

/** Vault-relative folder that owns the book configuration. */
export function bookRootOf(target: BuildTarget): string {
  if (target.kind === "folder") return target.folder.path === "/" ? "" : target.folder.path;
  return target.file.parent?.path === "/" ? "" : (target.file.parent?.path ?? "");
}

/**
 * A note is a table-of-contents note when it is called `index`, shares the
 * folder's name, or says so in its frontmatter (SPEC 5.2).
 */
export function isTocNote(app: App, file: TFile, folder: TFolder): boolean {
  const base = file.basename.toLowerCase();
  if (base === "index") return true;
  if (folder.name && file.basename === folder.name) return true;
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as
    | Record<string, unknown>
    | undefined;
  if (!frontmatter) return false;
  if (frontmatter["vivlio-toc"] === true) return true;
  const nested = frontmatter["vivlio"];
  if (nested && typeof nested === "object" && (nested as Record<string, unknown>)["toc"] === true) {
    return true;
  }
  return false;
}

function orderOf(app: App, file: TFile): number | null {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as
    | Record<string, unknown>
    | undefined;
  if (!frontmatter) return null;
  const flat = frontmatter["vivlio-order"];
  const nested = (frontmatter["vivlio"] as Record<string, unknown> | undefined)?.["order"];
  const value = flat ?? nested;
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Markdown files directly inside a folder (sub-folders are not descended). */
function markdownChildren(folder: TFolder): TFile[] {
  return folder.children.filter(
    (child): child is TFile => child instanceof TFile && child.extension === "md",
  );
}

/** Links in body order, resolved against the vault. */
export function linkedNotes(app: App, file: TFile, source: string): TFile[] {
  const cache = app.metadataCache.getFileCache(file);
  const out: TFile[] = [];
  const seen = new Set<string>();

  // `cache.links` is already in document order and has aliases resolved, but
  // it drops embeds; the raw scan below is the fallback for unindexed notes.
  const fromCache = cache?.links ?? [];
  for (const link of fromCache) {
    const target = app.metadataCache.getFirstLinkpathDest(
      link.link.split("#")[0].split("|")[0],
      source,
    );
    if (target && target.extension === "md" && !seen.has(target.path)) {
      seen.add(target.path);
      out.push(target);
    }
  }
  return out;
}

/** Scan raw Markdown for `[[links]]` when the metadata cache is cold. */
export function linkedNotesFromText(app: App, text: string, source: string): TFile[] {
  const out: TFile[] = [];
  const seen = new Set<string>();
  WIKILINK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKILINK.exec(text)) !== null) {
    if (match[0].startsWith("!")) continue;
    const linkpath = match[1].split("#")[0].split("|")[0].trim();
    const target = app.metadataCache.getFirstLinkpathDest(linkpath, source);
    if (target && target.extension === "md" && !seen.has(target.path)) {
      seen.add(target.path);
      out.push(target);
    }
  }
  return out;
}

export interface CollectResult {
  notes: TFile[];
  /** The table-of-contents note, when the order came from one. */
  tocNote: TFile | null;
}

/**
 * Decide the chapter order (SPEC 5.2):
 *   1. a table-of-contents note's `[[link]]` order, when there is one
 *   2. otherwise the natural order of the file names
 *   3. `vivlio-order` overrides both, as a primary sort key
 *   4. the table-of-contents note itself stays out of the spine
 */
export async function collectNotes(
  app: App,
  target: BuildTarget,
  options: { includeToc: boolean },
): Promise<CollectResult> {
  if (target.kind === "note") {
    return { notes: [target.file], tocNote: null };
  }

  if (target.kind === "toc") {
    const source = target.file.path;
    let notes = linkedNotes(app, target.file, source);
    if (notes.length === 0) {
      const text = await app.vault.cachedRead(target.file);
      notes = linkedNotesFromText(app, text, source);
    }
    if (options.includeToc) notes = [target.file, ...notes];
    return { notes: applyOrderOverrides(app, notes), tocNote: target.file };
  }

  const folder = target.folder;
  const children = markdownChildren(folder);
  const tocNote = children.find((file) => isTocNote(app, file, folder)) ?? null;

  if (tocNote) {
    const source = tocNote.path;
    let ordered = linkedNotes(app, tocNote, source);
    if (ordered.length === 0) {
      const text = await app.vault.cachedRead(tocNote);
      ordered = linkedNotesFromText(app, text, source);
    }
    // Notes in the folder that the table of contents forgot keep their natural
    // place at the end, so nothing silently disappears from the book.
    const listed = new Set(ordered.map((file) => file.path));
    const rest = children
      .filter((file) => file !== tocNote && !listed.has(file.path))
      .sort((a, b) => naturalCompare(a.name, b.name));
    const notes = [...ordered, ...rest].filter(
      (file) => options.includeToc || file !== tocNote,
    );
    return { notes: applyOrderOverrides(app, notes), tocNote };
  }

  const notes = children.sort((a, b) => naturalCompare(a.name, b.name));
  return { notes: applyOrderOverrides(app, notes), tocNote: null };
}

/**
 * Slot notes carrying `vivlio-order` into a fixed position (SPEC 5.2, rule 3).
 *
 * The value is a 1-based position in the finished spine, so a single note can
 * be pinned ("this belongs third") without renaming everything around it.
 */
function applyOrderOverrides(app: App, notes: TFile[]): TFile[] {
  const pinned: { file: TFile; order: number }[] = [];
  const rest: TFile[] = [];
  for (const file of notes) {
    const order = orderOf(app, file);
    if (order === null) rest.push(file);
    else pinned.push({ file, order });
  }
  if (pinned.length === 0) return notes;

  pinned.sort((a, b) => a.order - b.order);
  const out = [...rest];
  for (const { file, order } of pinned) {
    const index = Math.max(0, Math.min(out.length, Math.round(order) - 1));
    out.splice(index, 0, file);
  }
  return out;
}

/**
 * Heading slugs for a note, reproducing VFM's ids.
 *
 * VFM derives ids with `github-slugger` over the headings in document order,
 * so running the same slugger over the metadata cache gives the same answers -
 * duplicate-heading suffixes included - without converting the note first.
 */
export function headingsOf(app: App, file: TFile): HeadingEntry[] {
  const cache = app.metadataCache.getFileCache(file);
  const slugger = new GithubSlugger();
  const out: HeadingEntry[] = [];
  for (const heading of cache?.headings ?? []) {
    const text = heading.heading;
    out.push({ level: heading.level, text, slug: slugger.slug(text) });
  }
  return out;
}

/** Title shown for a note in the table of contents and the spine. */
export function titleOf(app: App, file: TFile): string {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as
    | Record<string, unknown>
    | undefined;
  const title = frontmatter?.["title"];
  if (typeof title === "string" && title.trim()) return title.trim();
  const headings = app.metadataCache.getFileCache(file)?.headings ?? [];
  const first = headings.find((heading) => heading.level === 1);
  if (first) return first.heading;
  return stripExtension(file.name);
}
