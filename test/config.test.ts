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
  frontmatterValueFor,
  frontmatterPatch,
  readFrontmatterProperties,
  writeScalar,
  type FrontmatterPatch,
} from "../src/config/yaml";
import { configFromSettings } from "../src/config/resolve";
import { DEFAULT_SETTINGS, pageHeightMm, pageWidthMm } from "../src/config/defaults";
import { PRESETS } from "../src/config/presets";
import { SELECTABLE_THEMES } from "../src/vendor/assets";
import { collectNotes } from "../src/build/collect";
import { buildTocEntries } from "../src/build/toc";
import type { BuildContext, Chapter } from "../src/build/context";
import { Workspace } from "../src/build/workspace";
import { themeChoices } from "../src/build/theme";
import { baseBookConfig } from "../src/config/defaults";
import { setLanguage, t, type StringKey } from "../src/i18n";
import { resolveBookLabels } from "../src/config/labels";
import {
  configTargetsInSelection,
  targetForActiveFile,
  wizardConfigTarget,
} from "../src/build/target";
import { buildBook, readBookYaml, type BuildRequest } from "../src/build/pipeline";
import { fontFaceRules } from "../src/build/fonts";
import { BOOK_STYLESHEET } from "../src/build/vfm";

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
  file.basename = file.name.replace(/\.[^.]+$/, "");
  file.extension = file.name.includes(".") ? (file.name.split(".").pop() ?? "") : "";
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

/** A note with one frontmatter patch applied, as the editor would apply it. */
function apply(content: string, patch: FrontmatterPatch | null): string {
  if (!patch) return content;
  const lines = content.split("\n");
  const block = patch.text ? patch.text.replace(/\n$/, "").split("\n") : [];
  return [...lines.slice(0, patch.fromLine), ...block, ...lines.slice(patch.toLine)].join("\n");
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

  // Exercise YAML parsing and the consumers together, against an API stub
  // that only accepts Obsidian's forward-slash paths.
  {
    const sources: Record<string, string> = {
      "book/vivlio.yaml": String.raw`
theme: 'themes\mine.css'
cover: 'book\cover.svg'
backCover: 'book\back.svg'
backCoverFit: contain
sections:
  preface: 'book\preface.md'
embedFonts:
  - family: MyFont
    src: 'fonts\MyFont.woff2'
css: 'p::before { content: "\2192"; }'
`,
      "themes/mine.css": "p { color: rebeccapurple; }",
      "themes/extra.css": "p { letter-spacing: 0.1em; }",
      "fonts/MyFont.woff2": "",
      "book/cover.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="200"></svg>',
      "book/back.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="200"></svg>',
      "book/cover.md": "# Cover note",
      "book/preface.md": "# Preface",
      "book/01.md": "# Chapter",
    };
    const files = Object.keys(sources).map((path) => makeFile(path));
    const app = makeApp(files);
    app.vault.cachedRead = async (file) => sources[file.path];
    app.vault.readBinary = async (file) => new TextEncoder().encode(sources[file.path]).buffer;
    const yamlFile = files.find((file) => file.path === "book/vivlio.yaml")!;
    const folder = makeFolder("book", files.filter((file) => file.path.startsWith("book/")));
    const request: BuildRequest = {
      app,
      settings: { ...DEFAULT_SETTINGS, extraCssPath: String.raw`themes\extra.css` },
      server: { base: "http://localhost", addWorkspace: () => {} } as unknown as BuildRequest["server"],
      component: {} as BuildRequest["component"],
      target: { kind: "config", file: yamlFile, folder },
      mode: "preview",
    };
    const result = await buildBook(request);
    check("Windows theme path loads the custom stylesheet", result.workspace.getFile("theme.css")?.text === sources["themes/mine.css"]);
    check("Windows cover path creates a cover", result.chapters.some((chapter) => chapter.role === "doc-cover" && !chapter.file));
    check("Windows cover path also measures the image", result.context.imageSizes.get("book/cover.svg")?.width === 100);
    check("Windows section path resolves the preface", result.chapters.some((chapter) => chapter.slot === "preface" && chapter.file?.path === "book/preface.md"));
    check("Windows font path generates a preview URL", fontFaceRules(result.context).includes("/vault/fonts/MyFont.woff2"));
    check("Windows extra CSS path loads the stylesheet", result.workspace.getFile(BOOK_STYLESHEET)?.text?.includes(sources["themes/extra.css"]) === true);
    check("inline CSS escapes are preserved", result.context.config.css.includes(String.raw`\2192`));
    check("Windows paths do not produce missing-file warnings", result.warnings.length === 0, JSON.stringify(result.warnings));
    check("Windows back cover path measures the image", result.context.imageSizes.get("book/back.svg")?.width === 120);
    check("back cover is the final spine item", result.chapters.at(-1)?.isBackCover === true);
    check("back cover fit is read from YAML", result.context.config.backCoverFit === "contain");
    check("print back cover includes an inside blank", result.workspace.getFile("back-cover.html")?.text?.includes('class="back-cover-inside"') === true);
    for (const audience of ["print", "nav"] as const) {
      check(`back cover is absent from ${audience} contents`, !buildTocEntries(result.context, result.chapters, audience).some((entry) => entry.href.startsWith("back-cover.html")));
    }

    const omitted = await buildBook({ ...request, mode: "pdf", overrides: { coverInPdf: false } });
    check("exclude covers omits both front and back in PDF", !omitted.chapters.some((chapter) => chapter.isBackCover || chapter.role === "doc-cover"));
    const missing = await buildBook({ ...request, overrides: { backCover: "missing.png" } });
    check("missing back cover warns without adding blank pages", !missing.chapters.some((chapter) => chapter.isBackCover) && missing.warnings.some((warning) => warning.kind === "missing-asset" && warning.message === "missing.png"));
    const frontmatter = resolveConfig({ settings: DEFAULT_SETTINGS, frontmatter: extractFrontmatterConfig({ "vivlio-back-cover": "back.png", "vivlio-back-cover-fit": "contain" }) });
    check("back cover properties resolve from note frontmatter", frontmatter.config.backCover === "back.png" && frontmatter.config.backCoverFit === "contain");

    const exported = await buildBook({ ...request, mode: "epub", overrides: { coverPage: String.raw`book\cover.md` } });
    check("Windows coverPage path resolves its note", exported.chapters[0].file?.path === "book/cover.md");
    check("Windows font path registers an export asset", [...exported.workspace.assets.values()].some((asset) => asset.vaultPath === "fonts/MyFont.woff2"));
    const backHtml = exported.workspace.getFile("back-cover.html")?.text ?? "";
    check("EPUB includes the back image without padding", backHtml.includes('class="back-cover"') && !backHtml.includes('class="back-cover-inside"'));
    check("back cover does not claim EPUB cover metadata", !backHtml.includes('role="doc-cover"'));

    // File-based themes must work through the real build for every output.
    const originalYaml = sources[yamlFile.path];
    for (const mode of ["preview", "pdf", "epub"] as const) {
      sources[yamlFile.path] = "theme: ../themes/mine.css";
      const relative = await buildBook({ ...request, mode });
      check(`relative theme loads in ${mode}`, relative.workspace.getFile("theme.css")?.text === sources["themes/mine.css"]);
    }
    sources[yamlFile.path] = "theme: ./themes/mine.css";
    const noFallback = await buildBook(request);
    check("missing relative theme does not fall back to same vault-root path", !noFallback.workspace.getFile("theme.css") && noFallback.warnings.some(w => w.kind === "config"));
    sources[yamlFile.path] = "theme: ../../themes/mine.css";
    const escaped = await buildBook(request);
    check("theme outside the vault is rejected", !escaped.workspace.getFile("theme.css") && escaped.warnings.some(w => w.kind === "config"));
    const note = files.find(file => file.path === "book/01.md")!;
    (note as TFile & { frontmatter: Record<string, unknown> }).frontmatter = { "vivlio-theme": "../themes/mine.css" };
    const fromNote = await buildBook({ ...request, target: { kind: "note", file: note } });
    check("single-note build resolves its frontmatter theme", fromNote.workspace.getFile("theme.css")?.text === sources["themes/mine.css"]);
    (note as TFile & { frontmatter?: unknown }).frontmatter = undefined;
    sources[yamlFile.path] = originalYaml;

    app.vault.getFiles = () => files;
    check("global picker retains root paths", themeChoices(app).some(c => c.value === "themes/mine.css"));
    check("book picker offers relative paths", themeChoices(app, "", yamlFile.path).some(c => c.value === "../themes/mine.css"));
    check("book picker preserves existing root selection", themeChoices(app, "themes/mine.css", yamlFile.path).some(c => c.value === "themes/mine.css"));

    const movedSources = Object.fromEntries(Object.entries(sources).map(([path, source]) => [`library/renamed/${path}`, source]));
    movedSources["library/renamed/book/print.yaml"] = "theme: ../themes/mine.css";
    const movedFiles = Object.keys(movedSources).map(path => makeFile(path));
    const movedApp = makeApp(movedFiles);
    movedApp.vault.cachedRead = async file => movedSources[file.path];
    const movedFolder = makeFolder("library/renamed/book", movedFiles.filter(file => file.path.startsWith("library/renamed/book/")));
    const movedYaml = movedFiles.find(file => file.path.endsWith("/print.yaml"))!;
    const relocated = await buildBook({ ...request, app: movedApp, settings: DEFAULT_SETTINGS, target: { kind: "config", file: movedYaml, folder: movedFolder } });
    check("moving and renaming a package preserves the selected YAML theme", relocated.workspace.getFile("theme.css")?.text === sources["themes/mine.css"]);

    for (const src of [String.raw`C:\Fonts\MyFont.ttf`, String.raw`\\server\fonts\MyFont.ttf`]) {
      const context = tocContext([]);
      context.config.embedFonts = [{ family: "Outside", src }];
      check("absolute fonts retain the outside-vault permission check", fontFaceRules(context) === "" && context.warnings.some((warning) => warning.message.includes("outside the vault")));
    }
  }

  // --- targets chosen from the File Explorer ----------------------------
  {
    const config = makeFile("book/print.yaml");
    const chapter = makeFile("book/01.md");
    const folder = makeFolder("book", [config, chapter]);
    const otherConfig = makeFile("book/ebook.yaml");
    otherConfig.parent = folder;
    const yml = makeFile("book/other.yml");
    yml.parent = folder;

    const activeConfig = targetForActiveFile(config);
    check(
      "an active YAML targets its whole folder and preserves the selected config",
      activeConfig?.kind === "config" &&
        activeConfig.folder === folder &&
        activeConfig.file === config,
    );
    check("an active Markdown file remains a note target", targetForActiveFile(chapter)?.kind === "note");
    check("the .yml extension is not treated as a requested .yaml config", targetForActiveFile(yml) === null);

    const oneBook = configTargetsInSelection([config, chapter, yml]);
    check(
      "one YAML in a multi-selection still identifies one configuration",
      oneBook.length === 1 &&
        oneBook[0].kind === "config" &&
        oneBook[0].file === config,
    );
    check(
      "two configs beside the same manuscript stay distinct",
      configTargetsInSelection([config, otherConfig]).length === 2,
    );

    const selected = await readBookYaml(
      {
        vault: {
          cachedRead: async (file: TFile) =>
            file === config ? "title: Print edition" : "title: Wrong edition",
          getFileByPath: () => otherConfig,
        },
      } as unknown as App,
      folder.path,
      config,
    );
    check(
      "the build reads the explicitly selected YAML instead of vivlio.yaml",
      selected?.title === "Print edition",
    );

    const selectedWizard = wizardConfigTarget(config);
    check(
      "the wizard writes back to the selected YAML",
      selectedWizard.bookRoot === "book" && selectedWizard.configPath === "book/print.yaml",
    );
    const markdownWizard = wizardConfigTarget(chapter);
    check(
      "the wizard keeps vivlio.yaml as the Markdown default",
      markdownWizard.bookRoot === "book" && markdownWizard.configPath === "book/vivlio.yaml",
    );
  }

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

  // Resolve paths before merging away the identity of their source layer.
  for (const [theme, expected] of [
    ["./style.css", "books/one/style.css"],
    ["../style.css", "books/style.css"],
    [String.raw`.\装丁\style.css`, "books/one/装丁/style.css"],
    ["themes/shared.css", "themes/shared.css"],
    ["novel", "novel"],
  ]) {
    const yaml = { theme };
    const result = resolveConfig({ settings: DEFAULT_SETTINGS, yaml, yamlPath: "books/one/print.yaml" });
    check(`theme resolves from its YAML: ${theme}`, result.config.theme === expected);
    check("theme resolution does not rewrite the source", yaml.theme === theme);
  }
  const themeLayers = {
    settings: { ...DEFAULT_SETTINGS, theme: "shared/default.css" },
    yaml: { theme: "./book.css" }, yamlPath: "parent/vivlio.yaml",
    frontmatterPath: "parent/chapters/index.md",
  };
  check("frontmatter theme uses the note directory", resolveConfig({ ...themeLayers, frontmatter: { theme: "./note.css" } }).config.theme === "parent/chapters/note.css");
  check("absent frontmatter theme keeps the YAML base", resolveConfig({ ...themeLayers, frontmatter: { title: "Book" } }).config.theme === "parent/book.css");
  check("null frontmatter theme keeps the YAML base", resolveConfig({ ...themeLayers, frontmatter: { theme: null } }).config.theme === "parent/book.css");
  check("global theme stays vault-relative", resolveConfig({ ...themeLayers, yaml: {} }).config.theme === "shared/default.css");
  check("root YAML supports explicit relative theme", resolveConfig({ settings: DEFAULT_SETTINGS, yaml: { theme: "./style.css" }, yamlPath: "vivlio.yaml" }).config.theme === "style.css");

  const customBoten = resolveConfig({
    settings: { ...DEFAULT_SETTINGS, botenMark: "●" },
    yaml: { botenMark: "○" },
    frontmatter: { botenMark: "☆" },
  });
  check(
    "a custom emphasis mark follows configuration precedence",
    customBoten.config.botenMark === "☆",
    customBoten.config.botenMark,
  );

  const labelled = resolveConfig({
    settings: DEFAULT_SETTINGS,
    yaml: {
      lang: "en",
      labels: { toc: "Table of Contents", colophon: { author: "Written by" } },
    },
  });
  const resolvedLabels = resolveBookLabels(labelled.config);
  check("book labels can be overridden in YAML", resolvedLabels.toc === "Table of Contents");
  check("nested label overrides are merged", resolvedLabels.colophon.author === "Written by");
  check("unoverridden labels still follow the book language", resolvedLabels.colophon.publisher === "Publisher");

  const englishSections = resolveConfig({
    settings: DEFAULT_SETTINGS,
    yaml: { lang: "en" },
  }).config.sections;
  check(
    "English books default to a front-matter copyright page",
    englishSections.copyrightPage === "auto",
    JSON.stringify(englishSections),
  );
  check(
    "English books do not default to a Japanese-style colophon",
    englishSections.colophon === "off",
    JSON.stringify(englishSections),
  );
  const explicitEnglishSections = resolveConfig({
    settings: DEFAULT_SETTINGS,
    yaml: { lang: "en", sections: { copyrightPage: "off", colophon: "auto" } },
  }).config.sections;
  check(
    "an English book can explicitly choose either publication part",
    explicitEnglishSections.copyrightPage === "off" && explicitEnglishSections.colophon === "auto",
    JSON.stringify(explicitEnglishSections),
  );

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
  check(
    "a custom emphasis mark is valid",
    validateConfig({ botenMark: "☆" }, "test").length === 0,
  );

  // --- generated YAML ----------------------------------------------------
  const yaml = configToYaml(
    { theme: "techbook", title: "本", tocDepth: DEFAULT_SETTINGS.tocDepth },
    configFromSettings(DEFAULT_SETTINGS),
  );
  check("changed keys are written", yaml.includes("theme: techbook"), yaml);
  check("unchanged keys are left out", !yaml.includes("tocDepth"), yaml);
  check(
    "a chosen emphasis mark is written",
    configToYaml(
      { botenMark: "○" },
      configFromSettings(DEFAULT_SETTINGS),
    ).includes("botenMark: ○"),
  );

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
    check("it writes generated labels into the book", /^labels:$/m.test(full), full);
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

    const englishFile = configToYaml(
      { lang: "en" },
      configFromSettings(DEFAULT_SETTINGS),
      { complete: true },
    );
    const englishParsed = loadYaml(englishFile) as Record<string, unknown>;
    const englishLabels = (englishParsed.labels ?? {}) as Record<string, unknown>;
    const englishColophon = (englishLabels.colophon ?? {}) as Record<string, unknown>;
    const englishGeneratedSections = (englishParsed.sections ?? {}) as Record<string, unknown>;
    check("English books generate an English contents label", englishLabels.toc === "Contents", englishFile);
    check("English books generate English colophon labels", englishColophon.author === "Author", englishFile);
    check(
      "English publication text is generated as a template",
      englishColophon.issuedEdition === "{version}, published {date}",
      englishFile,
    );
    check(
      "English YAML generates a copyright page instead of a colophon",
      englishGeneratedSections.copyrightPage === "auto" &&
        englishGeneratedSections.colophon === "off",
      englishFile,
    );

    const japaneseFile = configToYaml(
      { lang: "ja" },
      configFromSettings(DEFAULT_SETTINGS),
      { complete: true },
    );
    const japaneseLabels = ((loadYaml(japaneseFile) as Record<string, unknown>).labels ?? {}) as Record<string, unknown>;
    check("Japanese books generate a Japanese contents label", japaneseLabels.toc === "目次", japaneseFile);
  }

  // --- presets -----------------------------------------------------------
  // A preset that named a sheet nobody can measure would compose at whatever
  // the theme thinks, and one that named a theme the picker does not offer
  // would make a book whose look could not then be adjusted.
  {
    check(
      "the English novel preset sets the book language",
      PRESETS.find((preset) => preset.id === "englishNovel")?.values.lang === "en",
    );
    const englishPresetSections = PRESETS.find(
      (preset) => preset.id === "englishNovel",
    )?.values.sections;
    check(
      "the English novel preset chooses a copyright page rather than a colophon",
      englishPresetSections?.copyrightPage === "auto" && englishPresetSections.colophon === "off",
      JSON.stringify(englishPresetSections),
    );
    check("6x9 trade trim resolves to 152.4 mm wide", pageWidthMm("6x9") === 152.4);
    check("6x9 trade trim resolves to 228.6 mm high", pageHeightMm("6x9") === 228.6);

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
  check(
    "the reference lists every part",
    reference.includes("copyrightPage:") && reference.includes("colophon:"),
  );
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
      { docName: "copyrightpage.html", file: null, title: "Copyright page", role: null, slot: "copyrightPage", isBody: false, isFrontMatter: true },
      { docName: "toc.html", file: null, title: "目次", role: "doc-toc", slot: "toc", isBody: false, isFrontMatter: true },
      { docName: "colophon.html", file: null, title: "奥付", role: "doc-colophon", slot: "colophon", isBody: false, isFrontMatter: false },
    ];
    const docs = (entries: { href: string }[]) =>
      entries.map((e) => e.href.split("#")[0]).join(" ");
    const printed = buildTocEntries(tocContext(parts), parts, "print");
    const nav = buildTocEntries(tocContext(parts), parts, "nav");
    check("the printed contents lists none of the covers and closers",
      docs(printed) === "", docs(printed));
    check("the navigation reaches the cover, title page, copyright page and colophon",
      docs(nav) === "cover.html titlepage.html copyrightpage.html colophon.html", docs(nav));
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
  // The picker names a key the way the wizard names it. An unresolved string
  // key comes back as itself ("settings.botenMark"), which is what this looks
  // for: a key documented but never named would show up as its own id.
  check(
    "every offered key is named in words",
    choices.every(
      (choice) => choice.label.length > 0 && !/^(settings|colophon|book|key)\./.test(choice.label),
    ),
    choices.map((choice) => choice.label).join(" "),
  );
  // Each row says what ticking it would put in the note.
  check(
    "the picker can say what value a key would arrive with",
    frontmatterValueFor(DEFAULT_SETTINGS, "theme") === "novel",
    frontmatterValueFor(DEFAULT_SETTINGS, "theme"),
  );
  check(
    "a key with nothing to fill in arrives empty",
    frontmatterValueFor(DEFAULT_SETTINGS, "cover") === "",
    frontmatterValueFor(DEFAULT_SETTINGS, "cover"),
  );

  // --- editing a note's own properties (SPEC 5.4) ------------------------
  {
    const note = [
      "---",
      "title: 遠雷",
      'vivlio-theme: "novel"',
      "vivlio-order: 3",
      "vivlio-vfm:",
      "  hardLineBreaks: true",
      "---",
      "",
      "# 一章",
      "",
    ].join("\n");

    const properties = readFrontmatterProperties(note);
    // A quoted value and a bare one are the same theme; a dropdown handed the
    // quotes would match none of its options.
    check(
      "a written value is read as a field shows it",
      properties.get("vivlio-theme")?.value === "novel",
      properties.get("vivlio-theme")?.value,
    );
    check("a number reads as its digits", properties.get("vivlio-order")?.value === "3");
    check(
      "a nested property is read but not offered for rewriting",
      properties.get("vivlio-vfm")?.editable === false,
    );
    check(
      "a property the note does not carry is absent",
      !properties.has("vivlio-size"),
    );

    const changed = apply(
      note,
      frontmatterPatch(note, [
        { property: "vivlio-theme", value: "novel-2col" },
        { property: "vivlio-order", value: null },
        { property: "vivlio-size", value: "A5" },
      ]),
    );
    check("the changed property carries its new value", changed.includes("vivlio-theme: novel-2col"), changed);
    check("the removed property is gone", !changed.includes("vivlio-order"), changed);
    check("the added property is appended to the block", changed.includes("vivlio-size: A5"), changed);
    // Everything nobody mentioned stays where the writer put it.
    check("a property of someone else's is untouched", changed.includes("title: 遠雷"), changed);
    check("the nested property is untouched", changed.includes("  hardLineBreaks: true"), changed);
    check("the body is untouched", changed.endsWith("# 一章\n"), JSON.stringify(changed.slice(-12)));

    // Removing a nested property takes the lines that belong to it.
    const pruned = apply(note, frontmatterPatch(note, [{ property: "vivlio-vfm", value: null }]));
    check(
      "removing a property takes its indented lines with it",
      !pruned.includes("hardLineBreaks"),
      pruned,
    );

    // Nothing to do is nothing written: the picker compares values before it
    // asks for a patch, and the patch checks the text it would leave behind.
    check(
      "a property set to what it already says is not rewritten",
      frontmatterPatch(note, [{ property: "vivlio-order", value: "3" }]) === null,
    );

    const bare = "# 一章\n\n本文\n";
    const started = apply(bare, frontmatterPatch(bare, [{ property: "vivlio-theme", value: "novel" }]));
    check(
      "a note with no frontmatter gets a block",
      started.startsWith("---\nvivlio-theme: novel\n---\n\n# 一章"),
      started,
    );
    check(
      "and a removal alone writes nothing at all",
      frontmatterPatch(bare, [{ property: "vivlio-theme", value: null }]) === null,
    );
  }

  // A value is written as YAML when YAML can read it back, and quoted when it
  // cannot: `装丁: 架空花子` would otherwise turn the property into a mapping.
  check("a plain value is written as typed", writeScalar("novel") === "novel");
  check("a number stays a number", writeScalar("39") === "39");
  check(
    "a value YAML would read as something else is quoted",
    writeScalar("装丁: 架空花子") === '"装丁: 架空花子"',
    writeScalar("装丁: 架空花子"),
  );

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

  check("verse page count follows frontmatter precedence", resolveConfig({ settings: DEFAULT_SETTINGS, yaml: { versePerPage: 3 }, frontmatter: { versePerPage: 1 } }).config.versePerPage === 1);
  check("verse page count dropdown strings are coerced", resolveConfig({ settings: DEFAULT_SETTINGS, yaml: { versePerPage: "3" } }).config.versePerPage === 3);
  for (const value of [0, -1, 1.5, 4]) {
    const result = resolveConfig({ settings: DEFAULT_SETTINGS, yaml: { versePerPage: 3 }, frontmatter: { versePerPage: value } });
    check(`invalid verse page count ${value} leaves previous layer intact`, result.config.versePerPage === 3 && result.issues.some(issue => issue.key === "versePerPage"));
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
