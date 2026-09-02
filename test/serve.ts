/**
 * Build one note into a workspace and serve it, so the bundled viewer can be
 * pointed at it from an ordinary browser.
 *
 *   node test/run.mjs test/serve.ts "<file.md>"
 *
 * Prints the viewer URL and stays up. This is the only way to exercise the
 * viewer, the local server and publication.json together without Obsidian.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TFile } from "obsidian";
import { convertChapter, BOOK_STYLESHEET } from "../src/build/vfm";
import { bookStylesheet, themeUrlFor } from "../src/build/css";
import { publicationManifest } from "../src/build/manifest";
import { tocDocument } from "../src/build/toc";
import { titlePageDocument } from "../src/build/sections";
import type { BuildContext, Chapter } from "../src/build/context";
import { Workspace } from "../src/build/workspace";
import { DEFAULT_SETTINGS } from "../src/config/defaults";
import { extractFrontmatterConfig, resolveConfig } from "../src/config/resolve";
import { PreviewServer } from "../src/server/static";
import { setLanguage } from "../src/i18n";
import { setLogLevel } from "../src/util/log";
import { load as loadYaml } from "js-yaml";

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
  await server.start({ vaultRoot: path.dirname(target) });

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
  ];

  const context: BuildContext = {
    app: {
      metadataCache: {
        getFirstLinkpathDest: () => null,
        getFileCache: () => ({ frontmatter, headings: [] }),
      },
      vault: { cachedRead: async () => "", getFileByPath: () => null },
    } as unknown as BuildContext["app"],
    settings: DEFAULT_SETTINGS,
    config,
    workspace,
    mode: "preview",
    bookRoot: "",
    chapters,
    chapterByPath: new Map([[file.path, chapters[2]]]),
    headings: new Map(),
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
  workspace.putText("publication.json", publicationManifest(context, chapters));
  server.addWorkspace(workspace);

  const publicationUrl = `${context.workspaceBase}publication.json`;
  const viewerUrl = server.bookViewerUrl(publicationUrl, { renderAllPages: true });

  const report = [
    `viewer: ${viewerUrl}`,
    `publication: ${publicationUrl}`,
    `chapter: ${context.workspaceBase}ch01.html`,
    `stylesheet: ${context.workspaceBase}${BOOK_STYLESHEET}`,
  ].join("\n");

  const out = path.join(os.tmpdir(), "vivlio-serve.txt");
  fs.writeFileSync(out, `${report}\n`, "utf8");
  console.log(report);
  console.log(`\n(urls also written to ${out}; press Ctrl+C to stop)`);

  // Stay up for the browser.
  setInterval(() => undefined, 1 << 30);
}

void main();
