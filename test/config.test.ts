/**
 * Configuration and spine-order test.
 *
 * Covers the rules that decide what a book contains and how it is configured:
 * the three configuration layers of SPEC 5.4 and the chapter ordering of
 * SPEC 5.2.
 */
import { TFile, TFolder, type App } from "obsidian";
import { load as loadYaml } from "js-yaml";
import {
  extractFrontmatterConfig,
  resolveConfig,
  camelToKebab,
  kebabToCamel,
  bookValuesFromYaml,
} from "../src/config/resolve";
import { validateConfig } from "../src/config/schema";
import {
  configToYaml,
  referenceYaml,
  frontmatterKeyChoices,
  frontmatterSnippetFor,
} from "../src/config/yaml";
import { configFromSettings } from "../src/config/resolve";
import { DEFAULT_SETTINGS, pageHeightMm, pageWidthMm } from "../src/config/defaults";
import { PRESETS } from "../src/config/presets";
import { SELECTABLE_THEMES } from "../src/vendor/assets";
import { collectNotes } from "../src/build/collect";
import { buildTocEntries } from "../src/build/toc";
import type { BuildContext, Chapter } from "../src/build/context";
import { Workspace } from "../src/build/workspace";
import { baseBookConfig } from "../src/config/defaults";
import { setLanguage, t, type StringKey } from "../src/i18n";

/** The little of a build context that a contents list actually reads. */
function tocContext(chapters: Chapter[]): BuildContext {
  return {
    app: {} as BuildContext["app"],
    settings: { ...DEFAULT_SETTINGS },
    config: baseBookConfig(),
    workspace: new Workspace("toc"),
    mode: "preview",
    bookRoot: "",
    chapters,
    chapterByPath: new Map(),
    imageSizes: new Map(),
    headings: new Map(),
    warnings: [],
    component: {} as BuildContext["component"],
    workspaceBase: "",
    vaultBase: "",
    themeBase: "",
  };
}


const checks: { label: string; ok: boolean; detail?: string }[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  checks.push({ label, ok, detail });
}

function makeFile(path: string, frontmatter?: Record<string, unknown>): TFile {
  const file = new TFile();
  file.path = path;
  file.name = path.split("/").pop() ?? path;
  file.basename = file.name.replace(/\.md$/, "");
  file.extension = "md";
  (file as TFile & { frontmatter?: unknown }).frontmatter = frontmatter;
  return file;
}

function makeApp(files: TFile[], links: Record<string, string[]> = {}): App {
  return {
    metadataCache: {
      getFileCache: (file: TFile) => ({
        frontmatter: (file as TFile & { frontmatter?: Record<string, unknown> }).frontmatter,
        headings: [],
        links: (links[file.path] ?? []).map((link) => ({ link })),
      }),
      getFirstLinkpathDest: (linkpath: string) =>
        files.find(
          (file) => file.basename === linkpath || file.path === linkpath,
        ) ?? null,
    },
    vault: {
      cachedRead: async () => "",
      getFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
    },
  } as unknown as App;
}

function makeFolder(name: string, children: TFile[]): TFolder {
  const folder = new TFolder();
  folder.name = name;
  folder.path = name;
  folder.children = children;
  for (const child of children) child.parent = folder;
  return folder;
}

async function main(): Promise<void> {
  setLanguage("en");

  // --- layer merging (SPEC 5.4) -----------------------------------------
  const layered = resolveConfig({
    settings: { ...DEFAULT_SETTINGS, theme: "techbook", size: "A5" },
    yaml: { theme: "academic", author: "夏目漱石", tocDepth: 3 },
    frontmatter: { theme: "bunko" },
  });
  check("frontmatter beats vivlio.yaml", layered.config.theme === "bunko", layered.config.theme);
  check("vivlio.yaml beats the settings tab", layered.config.tocDepth === 3);
  check("settings fill the gaps", layered.config.size === "A5", layered.config.size);
  check("yaml value survives", layered.config.author === "夏目漱石");

  // --- flat frontmatter keys --------------------------------------------
  check("camel to kebab", camelToKebab("writingMode") === "writing-mode");
  check("kebab to camel", kebabToCamel("writing-mode") === "writingMode");

  const flat = extractFrontmatterConfig({
    title: "第一章",
    "vivlio-writing-mode": "horizontal-tb",
    "vivlio-chars-per-line": 42,
    unrelated: "ignored",
  });
  check("flat keys are read", flat.writingMode === "horizontal-tb", JSON.stringify(flat));
  check("numbers survive", flat.charsPerLine === 42);
  check("unrelated keys are left alone", flat.unrelated === undefined);

  const nested = extractFrontmatterConfig({ vivlio: { theme: "academic" } });
  check("nested form still parses", nested.theme === "academic");

  const coerced = resolveConfig({
    settings: DEFAULT_SETTINGS,
    frontmatter: extractFrontmatterConfig({ "vivlio-chars-per-line": "38" }),
  });
  check("string numbers are coerced", coerced.config.charsPerLine === 38);

  // --- extra colophon lines (SPEC 5.11) ----------------------------------
  // Both shapes YAML makes natural, and an empty value never becomes a line.
  const mapped = resolveConfig({
    settings: DEFAULT_SETTINGS,
    yaml: { colophonExtra: { 装丁: "佐藤 次郎", 校正: "" } },
  }).config.colophonExtra;
  const listed = resolveConfig({
    settings: DEFAULT_SETTINGS,
    yaml: { colophonExtra: [{ label: "装丁", value: "佐藤 次郎" }] },
  }).config.colophonExtra;
  check(
    "a colophon mapping becomes lines",
    mapped.length === 1 && mapped[0].label === "装丁" && mapped[0].value === "佐藤 次郎",
    JSON.stringify(mapped),
  );
  check("an empty colophon value is dropped", mapped.every((row) => row.value !== ""));
  check(
    "a colophon list becomes the same lines",
    listed.length === 1 && listed[0].value === "佐藤 次郎",
    JSON.stringify(listed),
  );

  // --- validation --------------------------------------------------------
  const issues = validateConfig(
    { theme: "bunko", nonsense: 1, sections: { preface: "auto" } },
    "test",
  );
  check(
    "unknown key warns",
    issues.some((issue) => issue.key === "nonsense" && issue.level === "warning"),
  );
  check(
    "auto on a part that cannot be generated is an error",
    issues.some((issue) => issue.key === "sections.preface" && issue.level === "error"),
    JSON.stringify(issues),
  );
  for (const columns of [0, -1, 1.5]) {
    const columnIssues = validateConfig({ columns }, "test");
    check(
      `columns rejects ${columns}`,
      columnIssues.some((issue) => issue.key === "columns" && issue.level === "error"),
      JSON.stringify(columnIssues),
    );
  }
  check(
    "columns accepts a positive integer",
    validateConfig({ columns: 2 }, "test").length === 0,
  );

  // --- generated YAML ----------------------------------------------------
  const yaml = configToYaml(
    { theme: "techbook", title: "本", tocDepth: DEFAULT_SETTINGS.tocDepth },
    configFromSettings(DEFAULT_SETTINGS),
  );
  check("changed keys are written", yaml.includes("theme: techbook"), yaml);
  check("unchanged keys are left out", !yaml.includes("tocDepth"), yaml);

  // The wizard writes the complete file: everything the book could say, with
  // the keys it does not decide left as comments so it still follows the
  // vault. A key nobody ever put in the wizard - the printer, say - is in it
  // too, which is the only way a writer finds out the key exists.
  {
    const full = configToYaml(
      { title: "本", sections: { preface: "まえがき.md" } },
      configFromSettings(DEFAULT_SETTINGS),
      { complete: true },
    );
    check("the complete file writes what was chosen", /^title: 本$/m.test(full), full);
    check(
      "and comments out what was not",
      full.includes("# theme: novel") && !/^theme:/m.test(full),
      full,
    );
    check("it reaches the keys no step asked about", full.includes("printer:"), full);
    check(
      "a chosen part is live, the rest are comments",
      /^ {2}preface: まえがき\.md$/m.test(full) && full.includes("#   colophon: auto"),
      full,
    );
    // It has to survive being read back, comments and all: an empty
    // `sections:` is a key nobody filled in, not a book with no parts.
    const parsed = loadYaml(full) as Record<string, unknown>;
    const reread = resolveConfig({ settings: DEFAULT_SETTINGS, yaml: parsed });
    check("the complete file reads back clean", reread.issues.length === 0, JSON.stringify(reread.issues));
    check(
      "and says what it was given",
      reread.config.title === "本" &&
        reread.config.sections.preface === "まえがき.md" &&
        reread.config.theme === DEFAULT_SETTINGS.theme,
      JSON.stringify(reread.config.sections),
    );
    const empty = loadYaml(
      configToYaml({}, configFromSettings(DEFAULT_SETTINGS), { complete: true }),
    ) as Record<string, unknown>;
    check(
      "an untouched file decides nothing",
      resolveConfig({ settings: DEFAULT_SETTINGS, yaml: empty }).issues.length === 0,
    );
  }

  // --- presets -----------------------------------------------------------
  // A preset that named a sheet nobody can measure would compose at whatever
  // the theme thinks, and one that named a theme the picker does not offer
  // would make a book whose look could not then be adjusted.
  {
    const unmeasured = PRESETS.filter(
      (preset) =>
        preset.values.size !== undefined &&
        (pageWidthMm(preset.values.size) === null ||
          pageHeightMm(preset.values.size) === null),
    );
    check(
      "every preset names a sheet that can be measured",
      unmeasured.length === 0,
      unmeasured.map((preset) => `${preset.id}: ${preset.values.size}`).join(", "),
    );

    const hidden = PRESETS.filter(
      (preset) =>
        preset.values.theme !== undefined &&
        !SELECTABLE_THEMES.includes(preset.values.theme),
    );
    check(
      "and a theme the picker offers",
      hidden.length === 0,
      hidden.map((preset) => `${preset.id}: ${preset.values.theme}`).join(", "),
    );

    check(
      "and every one of them has a label",
      PRESETS.every((preset) => t(preset.labelKey as StringKey) !== preset.labelKey),
      PRESETS.map((preset) => preset.labelKey).join(", "),
    );
  }

  const reference = referenceYaml(DEFAULT_SETTINGS);
  check("the reference lists every part", reference.includes("colophon:"));
  check("the reference is commented", reference.includes("# "));
  // startPage is resolved and used; it was simply named nowhere the writer
  // could find it.
  check("the reference names startPage", reference.includes("startPage:"), reference);
  // `order` and `toc` say where one note sits, so the book's own file has no
  // business offering them.
  check(
    "the reference leaves out the note-only keys",
    !/^order:/m.test(reference) && !/^toc:/m.test(reference),
    reference,
  );

  const snippet = frontmatterSnippetFor(DEFAULT_SETTINGS, ["theme", "cover"]);
  check("the snippet is flat", snippet.startsWith("vivlio-theme: novel"), snippet);
  check(
    "a chosen key with no default is still written",
    snippet.includes("vivlio-cover:") && !snippet.includes("vivlio-cover: "),
    snippet,
  );
  check(
    "a preset list skips what has no value",
    !frontmatterSnippetFor(DEFAULT_SETTINGS, ["theme", "cover"], false).includes("cover"),
  );

  // The printed contents page and the EPUB's navigation answer different
  // questions, so they are asked for different lists.
  {
    const parts: Chapter[] = [
      { docName: "cover.html", file: null, title: "本の名", role: "doc-cover", slot: null, isBody: false, isFrontMatter: true },
      { docName: "titlepage.html", file: null, title: "扉", role: null, slot: "titlePage", isBody: false, isFrontMatter: true },
      { docName: "toc.html", file: null, title: "目次", role: "doc-toc", slot: "toc", isBody: false, isFrontMatter: true },
      { docName: "colophon.html", file: null, title: "奥付", role: "doc-colophon", slot: "colophon", isBody: false, isFrontMatter: false },
    ];
    const docs = (entries: { href: string }[]) =>
      entries.map((e) => e.href.split("#")[0]).join(" ");
    const printed = buildTocEntries(tocContext(parts), parts, "print");
    const nav = buildTocEntries(tocContext(parts), parts, "nav");
    check("the printed contents lists none of the covers and closers",
      docs(printed) === "", docs(printed));
    check("the navigation reaches the cover, the title page and the colophon",
      docs(nav) === "cover.html titlepage.html colophon.html", docs(nav));
    check("neither lists the contents itself",
      !docs(printed).includes("toc.html") && !docs(nav).includes("toc.html"));
    // The cover would otherwise carry the book's title, same as the title page.
    check("the navigation names the cover as the cover",
      nav[0].label !== "本の名" && nav[0].label.length > 0, nav[0].label);
  }

  const choices = frontmatterKeyChoices();
  check(
    "the picker offers a flat key",
    choices.some((choice) => choice.property === "vivlio-writing-mode"),
  );
  // The command for putting settings on a note is where someone looks for the
  // keys that only work on a note.
  check(
    "the picker offers the note-only keys",
    ["vivlio-order", "vivlio-toc"].every((property) =>
      choices.some((choice) => choice.property === property),
    ),
    choices.map((choice) => choice.property).join(" "),
  );
  check(
    "a note-only key is written as a row waiting to be filled in",
    frontmatterSnippetFor(DEFAULT_SETTINGS, ["order"]) === "vivlio-order:",
    frontmatterSnippetFor(DEFAULT_SETTINGS, ["order"]),
  );
  check(
    "the picker leaves out the keys that need nesting",
    !choices.some((choice) => ["sections", "colophonExtra", "embedFonts", "vfm"].includes(choice.key)),
    choices.map((choice) => choice.key).join(","),
  );
  check("every offered key is described", choices.every((choice) => choice.description.length > 0));

  // --- chapter order (SPEC 5.2) -----------------------------------------
  const two = makeFile("book/2.md");
  const ten = makeFile("book/10.md");
  const one = makeFile("book/1.md");
  const natural = makeFolder("book", [ten, two, one]);
  const naturalResult = await collectNotes(
    makeApp([one, two, ten]),
    { kind: "folder", folder: natural },
    { includeToc: false },
  );
  check(
    "file names sort naturally",
    naturalResult.notes.map((file) => file.basename).join(",") === "1,2,10",
    naturalResult.notes.map((file) => file.basename).join(","),
  );

  // A table-of-contents note decides the order, and stays out of the book.
  const chapterA = makeFile("book2/a.md");
  const chapterB = makeFile("book2/b.md");
  const index = makeFile("book2/index.md");
  const withToc = makeFolder("book2", [chapterA, chapterB, index]);
  const tocResult = await collectNotes(
    makeApp([chapterA, chapterB, index], { "book2/index.md": ["b", "a"] }),
    { kind: "folder", folder: withToc },
    { includeToc: false },
  );
  check(
    "the table-of-contents note sets the order",
    tocResult.notes.map((file) => file.basename).join(",") === "b,a",
    tocResult.notes.map((file) => file.basename).join(","),
  );
  check("the table-of-contents note is not a chapter", !tocResult.notes.includes(index));

  // The wizard reopened on a book starts from what its vivlio.yaml says, and a
  // key the file leaves out has to stay on "use the default" - otherwise
  // reopening it would pin every unset key to whatever the settings said that
  // day. That is what tells this apart from resolveConfig, which merges the
  // layers and cannot say which of them answered.
  const carried = bookValuesFromYaml({
    theme: "novel-2col",
    charsPerLine: "23",
    unknownKey: 1,
    order: 3,
  });
  check("a vivlio.yaml's own keys come back", carried.theme === "novel-2col");
  check("coerced the way a layer coerces them", carried.charsPerLine === 23);
  check("a key the file omits stays unset", !("size" in carried));
  check("an unknown key is not a book setting", !("unknownKey" in carried));
  check("nor is a spine hint", !("order" in carried));
  check("and no file means no answers", Object.keys(bookValuesFromYaml(null)).length === 0);

  // `vivlio-order` pins a note to a position.
  const first = makeFile("book3/z.md", { "vivlio-order": 1 });
  const second = makeFile("book3/a.md");
  const third = makeFile("book3/b.md");
  const pinned = makeFolder("book3", [second, third, first]);
  const pinnedResult = await collectNotes(
    makeApp([first, second, third]),
    { kind: "folder", folder: pinned },
    { includeToc: false },
  );
  check(
    "vivlio-order pins a note",
    pinnedResult.notes.map((file) => file.basename).join(",") === "z,a,b",
    pinnedResult.notes.map((file) => file.basename).join(","),
  );

  check("new books use continuous folios", resolveConfig({ settings: DEFAULT_SETTINGS }).config.pageNumbering === "continuous");
  check("existing Roman numbering is preserved", resolveConfig({ settings: { ...DEFAULT_SETTINGS, pageNumbering: "roman-then-arabic" } }).config.pageNumbering === "roman-then-arabic");
  check("startPage follows configuration precedence", resolveConfig({ settings: DEFAULT_SETTINGS, yaml: { startPage: 5 }, frontmatter: { startPage: 7 } }).config.startPage === 7);
  check("a numeric startPage string is coerced", resolveConfig({ settings: DEFAULT_SETTINGS, yaml: { startPage: "5" } }).config.startPage === 5);
  for (const value of [0, -1, -20]) {
    const result = resolveConfig({ settings: DEFAULT_SETTINGS, yaml: { startPage: value } });
    check(`startPage ${value} is accepted`, result.config.startPage === value && !result.issues.some((issue) => issue.key === "startPage"));
  }
  for (const value of [1.5]) {
    const result = resolveConfig({ settings: DEFAULT_SETTINGS, yaml: { startPage: 5 }, frontmatter: { startPage: value } });
    check(`invalid startPage ${value} leaves the previous layer intact`, result.config.startPage === 5 && result.issues.some((issue) => issue.key === "startPage"));
  }
  for (const value of [0, -1, 1.5]) {
    const result = resolveConfig({
      settings: DEFAULT_SETTINGS,
      yaml: { columns: 2 },
      frontmatter: { columns: value },
    });
    check(
      `invalid columns ${value} leaves the previous layer intact`,
      result.config.columns === 2 && result.issues.some((issue) => issue.key === "columns"),
    );
  }

  let failed = 0;
  for (const result of checks) {
    if (!result.ok) failed += 1;
    console.log(
      `${result.ok ? "ok  " : "FAIL"} ${result.label}${
        result.detail && !result.ok ? `\n     ${result.detail}` : ""
      }`,
    );
  }
  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks passed");
}

void main();
