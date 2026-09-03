/**
 * Build one note into a workspace and serve it, so the bundled viewer can be
 * pointed at it from an ordinary browser.
 *
 *   node test/run.mjs test/serve.ts test/sample.md
 *
 * `test/sample.md` carries every notation and every colophon field, so the
 * whole design can be looked at; any other note works as well.
 *
 * Prints the viewer URL and stays up. This is the only way to exercise the
 * viewer, the local server and publication.json together without Obsidian.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TFile } from "obsidian";
import { convertChapter, BOOK_STYLESHEET } from "../src/build/vfm";
import { epubStylesheet } from "../src/export/epub";
import { bookStylesheet, themeUrlFor } from "../src/build/css";
import { publicationManifest } from "../src/build/manifest";
import { tocDocument } from "../src/build/toc";
import { colophonDocument, titlePageDocument } from "../src/build/sections";
import type { BuildContext, Chapter } from "../src/build/context";
import { Workspace } from "../src/build/workspace";
import { DEFAULT_SETTINGS } from "../src/config/defaults";
import { extractFrontmatterConfig, resolveConfig } from "../src/config/resolve";
import { PreviewServer } from "../src/server/static";
import { setLanguage } from "../src/i18n";
import { setLogLevel } from "../src/util/log";
import { load as loadYaml } from "js-yaml";
import GithubSlugger from "github-slugger";
import type { HeadingEntry } from "../src/build/context";

/** Name of the packed stylesheet in the EPUB twins below. */
const EPUB_STYLESHEET = "epub.css";

const target = process.argv[3];
if (!target) {
  console.error('usage: node test/run.mjs test/serve.ts "<file.md>"');
  process.exit(1);
}

function frontmatterOf(source: string): Record<string, unknown> {
  if (!source.startsWith("---")) return {};
  const end = source.indexOf("\n---", 3);
  if (end === -1) return {};
  const parsed = loadYaml(source.slice(4, end));
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

/**
 * The vault, as the harness can see it: every file under the note's folder.
 *
 * Stubbing the lookups to null - which is what this did - left images out of
 * the only place the whole pipeline can be looked at, and images are the one
 * part with two code paths that disagree (SPEC 5.8). A real map is a dozen
 * lines and makes `![[…]]` behave here the way it does in Obsidian.
 */
function readVault(root: string): Map<string, TFile> {
  const files = new Map<string, TFile>();
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relative);
        continue;
      }
      const file = new TFile();
      file.path = relative;
      file.name = entry.name;
      file.extension = entry.name.includes(".") ? entry.name.split(".").pop()! : "";
      file.basename = file.extension
        ? entry.name.slice(0, -(file.extension.length + 1))
        : entry.name;
      files.set(relative, file);
    }
  };
  walk(root, "");
  return files;
}

/**
 * Obsidian's link resolution, near enough: an exact path first, then the
 * shortest path whose name matches, then the same again assuming `.md`.
 */
function linkpathResolver(files: Map<string, TFile>) {
  const byName = [...files.values()].sort((a, b) => a.path.length - b.path.length);
  return (linkpath: string): TFile | null => {
    const target = linkpath.replace(/^\.\//, "");
    return (
      files.get(target) ??
      files.get(`${target}.md`) ??
      byName.find((file) => file.name === target || file.basename === target) ??
      null
    );
  };
}

/** Headings with the ids VFM will give them. */
function parseHeadings(markdown: string): HeadingEntry[] {
  const slugger = new GithubSlugger();
  const out: HeadingEntry[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (!match) continue;
    const text = match[2].trim();
    out.push({ level: match[1].length, text, slug: slugger.slug(text) });
  }
  return out;
}

async function main(): Promise<void> {
  setLanguage("ja");
  setLogLevel("debug");

  const markdown = fs.readFileSync(target, "utf8");
  const frontmatter = frontmatterOf(markdown);
  const { config } = resolveConfig({
    settings: DEFAULT_SETTINGS,
    frontmatter: extractFrontmatterConfig(frontmatter),
  });

  const file = new TFile();
  file.path = path.basename(target);
  file.name = file.path;
  file.basename = file.name.replace(/\.md$/, "");
  file.extension = "md";

  const workspace = new Workspace("book");
  const server = new PreviewServer();
  const vaultRoot = path.dirname(target);
  await server.start({ vaultRoot });

  const vault = readVault(vaultRoot);
  const resolveLink = linkpathResolver(vault);

  const chapters: Chapter[] = [
    {
      docName: "titlepage.html",
      file: null,
      title: config.title,
      role: null,
      slot: "titlePage",
      isBody: false,
      isFrontMatter: true,
    },
    {
      docName: "toc.html",
      file: null,
      title: "目次",
      role: "doc-toc",
      slot: "toc",
      isBody: false,
      isFrontMatter: true,
    },
    {
      docName: "ch01.html",
      file,
      title: config.title,
      role: null,
      slot: null,
      isBody: true,
      isFrontMatter: false,
      startPage: 1,
    },
    {
      docName: "colophon.html",
      file: null,
      title: "奥付",
      role: "doc-colophon",
      slot: "colophon",
      isBody: false,
      isFrontMatter: false,
    },
  ];

  const context: BuildContext = {
    app: {
      metadataCache: {
        getFirstLinkpathDest: (linkpath: string) => resolveLink(linkpath),
        getFileCache: () => ({ frontmatter, headings: [] }),
      },
      vault: {
        cachedRead: async () => "",
        getFileByPath: (target: string) => vault.get(target) ?? null,
      },
    } as unknown as BuildContext["app"],
    settings: DEFAULT_SETTINGS,
    config,
    workspace,
    mode: "preview",
    bookRoot: "",
    chapters,
    chapterByPath: new Map([[file.path, chapters[2]]]),
    // Obsidian supplies these from its metadata cache; parse them here so the
    // generated table of contents is the real one.
    headings: new Map([[file.path, parseHeadings(markdown)]]),
    warnings: [],
    component: {} as BuildContext["component"],
    workspaceBase: `${server.base}/w/${workspace.id}/`,
    vaultBase: `${server.base}/vault/`,
    themeBase: `${server.base}/themes/`,
  };

  workspace.putText(BOOK_STYLESHEET, bookStylesheet(context, themeUrlFor(context)));
  workspace.putText("ch01.html", await convertChapter(context, chapters[2], file, markdown));
  workspace.putText("titlepage.html", titlePageDocument(context));
  workspace.putText("toc.html", tocDocument(context, chapters));
  workspace.putText("colophon.html", colophonDocument(context));
  workspace.putText("publication.json", publicationManifest(context, chapters));
  server.addWorkspace(workspace);

  // EPUB output has no viewer of its own, so each document gets a twin that
  // links the packed stylesheet instead. Opening one in a browser is what a
  // reflowable reader does with the same two files.
  workspace.putText(EPUB_STYLESHEET, epubStylesheet(context));
  for (const chapter of chapters) {
    const html = workspace.getFile(chapter.docName)?.text;
    if (!html) continue;
    workspace.putText(
      `epub-${chapter.docName}`,
      html.replace(`href="${BOOK_STYLESHEET}"`, `href="${EPUB_STYLESHEET}"`),
    );
  }

  const publicationUrl = `${context.workspaceBase}publication.json`;
  const viewerUrl = server.bookViewerUrl(publicationUrl, { renderAllPages: true });

  const report = [
    `viewer: ${viewerUrl}`,
    `publication: ${publicationUrl}`,
    `chapter: ${context.workspaceBase}ch01.html`,
    `stylesheet: ${context.workspaceBase}${BOOK_STYLESHEET}`,
    "",
    "as an EPUB reader sees it (reflowable, no viewer):",
    ...chapters.map((chapter) => `  ${context.workspaceBase}epub-${chapter.docName}`),
  ].join("\n");

  const out = path.join(os.tmpdir(), "vivlio-serve.txt");
  fs.writeFileSync(out, `${report}\n`, "utf8");
  console.log(report);
  console.log(`\n(urls also written to ${out}; press Ctrl+C to stop)`);

  // Stay up for the browser.
  setInterval(() => undefined, 1 << 30);
}

void main();
