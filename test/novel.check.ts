/**
 * Run one real note from a vault through the conversion pipeline.
 *
 *   node test/run.mjs test/novel.check.ts "<path to a .md file>"
 *
 * Reports what the notations turned into, so a note can be checked without
 * launching Obsidian.
 */
import * as fs from "fs";
import { TFile } from "obsidian";
import { convertChapter } from "../src/build/vfm";
import type { BuildContext, Chapter } from "../src/build/context";
import { Workspace } from "../src/build/workspace";
import { DEFAULT_SETTINGS } from "../src/config/defaults";
import { extractFrontmatterConfig, resolveConfig } from "../src/config/resolve";
import { setLanguage } from "../src/i18n";
import { load as loadYaml } from "js-yaml";

// argv[2] is this file, as handed to test/run.mjs; the note follows it.
const target = process.argv[3];
if (!target) {
  console.error('usage: node test/run.mjs test/novel.check.ts "<file.md>"');
  process.exit(1);
}

function frontmatterOf(source: string): Record<string, unknown> {
  if (!source.startsWith("---")) return {};
  const end = source.indexOf("\n---", 3);
  if (end === -1) return {};
  const parsed = loadYaml(source.slice(4, end));
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

function count(haystack: string, needle: RegExp): number {
  return haystack.match(needle)?.length ?? 0;
}

async function main(): Promise<void> {
  setLanguage("ja");
  const markdown = fs.readFileSync(target, "utf8");
  const frontmatter = frontmatterOf(markdown);

  const { config, issues } = resolveConfig({
    settings: DEFAULT_SETTINGS,
    frontmatter: extractFrontmatterConfig(frontmatter),
  });

  const file = new TFile();
  file.path = target.split(/[\\/]/).pop() ?? target;
  file.name = file.path;
  file.basename = file.name.replace(/\.md$/, "");
  file.extension = "md";

  const chapter: Chapter = {
    docName: "ch01.html",
    file,
    title: config.title || file.basename,
    role: null,
    slot: null,
    isBody: true,
    isFrontMatter: false,
    startPage: 1,
  };

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
    workspace: new Workspace("check"),
    mode: "preview",
    bookRoot: "",
    chapters: [chapter],
    chapterByPath: new Map([[file.path, chapter]]),
    headings: new Map(),
    warnings: [],
    component: {} as BuildContext["component"],
    workspaceBase: "http://127.0.0.1:1/s/t/w/check/",
    vaultBase: "http://127.0.0.1:1/s/t/vault/",
    themeBase: "http://127.0.0.1:1/s/t/themes/",
  };

  const started = Date.now();
  const html = await convertChapter(context, chapter, file, markdown);
  const elapsed = Date.now() - started;

  console.log(`source     ${markdown.length.toLocaleString()} chars`);
  console.log(`html       ${html.length.toLocaleString()} chars in ${elapsed} ms`);
  console.log(`title      ${config.title}`);
  console.log(`theme      ${config.theme} / ${config.size} / ${config.writingMode}`);
  console.log(`chars×lines ${config.charsPerLine}×${config.linesPerPage}`);
  console.log(`indent     ${config.paragraphIndent || "(theme default)"}`);
  console.log(`tocDepth   ${config.tocDepth}`);
  console.log("");
  console.log(`<ruby>     ${count(html, /<ruby>/g)}`);
  console.log(`.boten     ${count(html, /class="boten"/g)}`);
  console.log(`.tcy       ${count(html, /class="tcy"/g)}`);
  console.log(`<section>  ${count(html, /<section/g)}`);
  console.log(`h1/h2/h3   ${count(html, /<h1/g)} / ${count(html, /<h2/g)} / ${count(html, /<h3/g)}`);
  console.log(`<strong>   ${count(html, /<strong>/g)}`);

  const leftovers: [string, RegExp][] = [
    ["unconverted ｜ruby《》", /｜[^《\n]{1,20}《/g],
    ["unconverted 《《boten》》", /《《/g],
    ["stray sesame ﹅", /﹅/g],
  ];
  console.log("");
  for (const [label, pattern] of leftovers) {
    const found = count(html, pattern);
    console.log(`${found === 0 ? "ok  " : "WARN"} ${label}: ${found}`);
  }

  if (issues.length > 0) {
    console.log("\nconfig issues:");
    for (const issue of issues) console.log(`  - ${issue.level} ${issue.key}: ${issue.message}`);
  }
  if (context.warnings.length > 0) {
    console.log("\nbuild warnings:");
    for (const warning of context.warnings) console.log(`  - ${warning.kind}: ${warning.message}`);
  }

  const sample = html.match(/<ruby>[\s\S]{0,80}?<\/ruby>/g)?.slice(0, 3) ?? [];
  const boten = html.match(/<span class="boten">[^<]*<\/span>/g)?.slice(0, 3) ?? [];
  const tcy = html.match(/<span class="tcy">[^<]*<\/span>/g)?.slice(0, 3) ?? [];
  console.log("\nsamples:");
  for (const entry of [...sample, ...boten, ...tcy]) console.log(`  ${entry}`);
}

void main();
