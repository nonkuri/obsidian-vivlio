import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import { DEFAULT_SETTINGS } from "./defaults";
import { camelToKebab, configFromSettings } from "./resolve";
import {
  SECTION_SLOTS,
  type BookConfig,
  type SectionSlot,
  type VivlioSettings,
} from "./types";
import { detectLocale, t, type StringKey } from "../i18n";
import { defaultBookLabels, resolveBookLabels } from "./labels";

type Locale = "ja" | "en";

interface KeyDoc {
  ja: string;
  en: string;
  /** Keys that need nesting are only valid in vivlio.yaml (SPEC 5.4). */
  yamlOnly?: boolean;
  /**
   * Keys that say where a note sits in the book rather than how the book is
   * set: they belong in a note and nowhere else, so the vivlio.yaml reference
   * leaves them out. The mirror of `yamlOnly`.
   */
  noteOnly?: boolean;
  group: string;
}

/**
 * A key a note may carry: the book's own keys, plus the two that only ever
 * describe one note's place in the running order.
 */
export type NoteKey = keyof BookConfig | "order" | "toc";

/**
 * Documentation for every configuration key.
 *
 * `vivlio.yaml` can carry comments, which makes a generated file the reference
 * itself - nobody has to go looking for documentation (SPEC 5.4).
 */
const KEY_DOCS: Partial<Record<NoteKey, KeyDoc>> = {
  title: { group: "book", ja: "書名", en: "Book title" },
  subtitle: { group: "book", ja: "副題", en: "Subtitle" },
  series: { group: "book", ja: "シリーズ名（奥付・扉に出る）", en: "Series name" },
  author: { group: "book", ja: "著者", en: "Author" },
  translator: { group: "book", ja: "訳者", en: "Translator" },
  publisher: { group: "book", ja: "発行所", en: "Publisher" },
  printer: {
    group: "book",
    ja: "印刷所（日本の奥付は発行所と別に刷る）",
    en: "Printer, which a Japanese colophon names apart from the publisher",
  },
  contact: { group: "book", ja: "連絡先（住所・メール）", en: "Contact (address, email)" },
  website: { group: "book", ja: "WEB サイト", en: "Website" },
  date: {
    group: "book",
    ja: "発行日。2026-09-05 と書くと、縦組みの奥付では二〇二六年九月五日に組み替わる",
    en: "Publication date, e.g. 2026-09-05; a vertical colophon sets it in kanji",
  },
  lang: {
    group: "book",
    ja: "本の言語（ja / en）。組版の言語指定になり、奥付の日付の書き方も決まる",
    en: "Language of the book (ja / en). Sets the typesetting language, and how the colophon writes its date",
  },
  version: { group: "book", ja: "版（第二版・改訂版など）", en: "Edition (e.g. second edition)" },
  labels: {
    group: "book",
    yamlOnly: true,
    ja: "自動生成ページの文字。lang に応じて作られ、目次見出し・著作権表示・奥付ラベルなどを本ごとに変更できる",
    en: "Text on generated pages. Created from `lang`; customize contents headings, copyright-page text and colophon labels per book",
  },
  colophonExtra: {
    group: "book",
    yamlOnly: true,
    ja: "奥付に足す任意の項目: [{ label: 装丁, value: 山田花子 }] または { 装丁: 山田花子 }",
    en: "Extra colophon lines: [{ label: Design, value: … }] or { Design: … }",
  },

  theme: {
    group: "layout",
    ja: "テーマ: novel（縦組みの小説）| novel-2col（縦組み二段組）| english-novel（英語小説）| manual（横組みのマニュアル・技術書）| Vault 内の .css ファイルのパス",
    en: "Theme: novel (a vertical novel) | novel-2col (a vertical novel in two columns) | english-novel (an English trade paperback) | manual (a horizontal manual or tech book) | the path of a .css file in the vault",
  },
  writingMode: {
    group: "layout",
    ja: "vertical-rl（縦組み）| horizontal-tb（横組み）",
    en: "vertical-rl | horizontal-tb",
  },
  size: {
    group: "layout",
    ja: "判型: 文庫（A6・105x148mm）| 新書 | JIS-B6 | A5 | JIS-B5 | B5 | A4 | 6x9 | letter | \"128mm 188mm\"",
    en: "Page size: 文庫 (A6, 105x148mm) | 新書 | JIS-B6 | A5 | JIS-B5 | B5 | A4 | 6x9 | letter | \"128mm 188mm\"",
  },
  charsPerLine: {
    group: "layout",
    ja: "1行あたりの文字数（二段組なら1段の字詰め）。空ならテーマが判型と文字サイズから決める",
    en: "Characters per line - of one column, in a two-column book; empty lets the theme size the text block from the page",
  },
  linesPerPage: {
    group: "layout",
    ja: "1段あたりの行数。空ならテーマが判型と文字サイズから決める",
    en: "Lines per column; empty lets the theme size the text block from the page",
  },
  columns: {
    group: "layout",
    ja: "本文の段数（1以上の整数）。空はテーマ任せ。横組み・縦組みとも有効で、字詰めと行数は1段あたりの数になる",
    en: "Body columns (a positive integer); empty leaves them to the theme. Works in horizontal and vertical writing; the two figures above are per column",
  },
  startSide: {
    group: "layout",
    ja: "章・各部を始めるページ: any（なりゆき）| left（左ページ＝奇数）| right。必要なら空白ページが入る（ノンブルは刷らない。表紙裏以外はページ数に数える）",
    en: "Which side a chapter or a part opens on: any | left (the odd page, in a right-bound book) | right. A blank leaf goes in where needed without a printed folio; all but the inside cover are counted",
  },
  baseFontSize: {
    group: "layout",
    ja: "基準の文字サイズ（9pt など）。空ならテーマ任せ",
    en: "Base font size (e.g. 9pt); empty leaves it to the theme",
  },
  paragraphIndent: {
    group: "layout",
    ja: "段落の字下げ。原稿が全角スペースで字下げ済みなら 0（空ならテーマ任せ）",
    en: "Paragraph indent; use 0 when the manuscript already indents with an ideographic space (empty leaves it to the theme)",
  },
  paragraphIndentMode: {
    group: "layout",
    ja: "字下げする段落: auto（原稿に従う）| manuscript（全角スペースのある段落だけ）| brackets（始め括弧の段落以外）| all（すべて）",
    en: "Which paragraphs take the indent: auto | manuscript | brackets | all",
  },
  footnote: {
    group: "layout",
    ja: "gcpm（ページ下）| pandoc（章末）| dpub",
    en: "gcpm (bottom of page) | pandoc (end of chapter) | dpub",
  },
  highlight: {
    group: "layout",
    ja: "==ハイライト== の扱い: boten | strong | mark | off",
    en: "What ==highlight== becomes: boten | strong | mark | off",
  },
  botenMark: {
    group: "layout",
    ja: "傍点に使う記号。﹅（ゴマ点）・●・○・▲など任意の文字を指定できる",
    en: "Mark used for emphasis dots; accepts any character, such as ﹅, ●, ○ or ▲",
  },
  autoTcy: {
    group: "layout",
    ja: "2 桁の半角数字を自動で縦中横にする",
    en: "Turn 2-digit numbers upright in vertical writing",
  },
  imageWidthUnit: {
    group: "layout",
    ja: "単位のない ![[fig.png|300]] の 300 の解釈: px | percent | mm。いずれも紙面での画像の幅。画像ごとに ![[fig.png|60%]] ![[fig.png|80mm]] と書けばそちらが優先",
    en: "How a unitless ![[fig.png|300]] is read: px | percent | mm. All of them mean the printed width. Per image, write ![[fig.png|60%]] or ![[fig.png|80mm]] to override it",
  },

  cover: { group: "cover", ja: "表紙画像", en: "Cover image" },
  coverPage: {
    group: "cover",
    ja: "表紙として組むノート（cover より優先）",
    en: "Note used as the cover page (wins over `cover`)",
  },
  coverFit: {
    group: "cover",
    ja: "表紙画像の合わせ方: cover（判型いっぱいに広げ、はみ出しを裁ち落とす）| contain（画像全体を収め、余白を出す）",
    en: "How the cover image fills the page: cover (fill and crop the overflow) | contain (fit the whole image, leaving margins)",
  },
  coverInPdf: { group: "cover", ja: "PDF に表紙を含める", en: "Include the cover in the PDF" },

  fontFamily: { group: "fonts", ja: "本文フォント", en: "Body font" },
  headingFontFamily: { group: "fonts", ja: "見出しフォント", en: "Heading font" },
  monospaceFontFamily: { group: "fonts", ja: "等幅フォント", en: "Monospace font" },
  mboxFontFamily: { group: "fonts", ja: "ノンブル・柱のフォント", en: "Running head font" },
  tcyFontFamily: { group: "fonts", ja: "縦中横のフォント", en: "Font used for upright numbers" },
  fontFeatureSettings: {
    group: "fonts",
    ja: "OpenType 機能（縦組みで 'vert' 1 等）",
    en: "OpenType features (e.g. 'vert' 1 for vertical writing)",
  },
  rubyFontSize: { group: "fonts", ja: "ルビの文字サイズ", en: "Ruby font size" },
  embedFonts: {
    group: "fonts",
    yamlOnly: true,
    ja: "Vault 内のフォントファイルを埋め込む: [{ family, src, weight }]",
    en: "Embed font files from the vault: [{ family, src, weight }]",
  },

  sections: {
    group: "structure",
    yamlOnly: true,
    ja: "前付け・後付け。auto（プラグインが作る。半扉・扉・著作権表示・目次・奥付のみ）| 中身にするノートのパス | off",
    en: "Front and back matter. auto (generated; half title, title page, copyright page, contents and colophon only) | the path of a note to use | off",
  },
  pageNumbering: {
    group: "structure",
    ja: "continuous（既定）| roman-then-arabic | none",
    en: "continuous (default) | roman-then-arabic | none",
  },
  tocDepth: { group: "structure", ja: "目次に拾う見出しの深さ", en: "Table of contents depth" },
  startPage: {
    group: "structure",
    ja: "ノンブルの開始番号（0以下は数えるが表示しない。通し番号では表紙の次、別ノンブルでは本文）",
    en: "First folio (zero and negative values count but stay hidden; after the cover in continuous mode, at the body in split mode)",
  },
  includeToc: {
    group: "structure",
    ja: "目次ノート自身を本文に含める",
    en: "Include the table-of-contents note in the body",
  },

  order: {
    group: "structure",
    noteOnly: true,
    ja: "このノートの並び順を固定する（ファイル名順より優先）",
    en: "Pin this note's place in the running order (beats the file-name order)",
  },
  toc: {
    group: "structure",
    noteOnly: true,
    ja: "このノートを目次ノートとして扱う",
    en: "Treat this note as the table-of-contents note",
  },

  output: {
    group: "output",
    ja: "この本の書き出し先（Vault 相対 / 絶対パス）。空なら設定タブの出力フォルダ",
    en: "Where this book is written (vault-relative or absolute); empty uses the output folder in the settings tab",
  },
  cropMarks: {
    group: "output",
    ja: "トンボ（断裁位置の印）を付ける。入稿では塗り足しとセットで求められる",
    en: "Add crop marks; a print shop asks for these together with the bleed",
  },
  bleed: {
    group: "output",
    ja: "塗り足し。断裁位置より外へ絵柄をはみ出させる幅（3mm など）",
    en: "Bleed: how far artwork runs past the trim (e.g. 3mm)",
  },

  css: {
    group: "output",
    yamlOnly: true,
    ja: "追加 CSS（テーマの後に注入）",
    en: "Extra CSS, injected after the theme",
  },
  syntax: {
    group: "output",
    yamlOnly: true,
    ja: "この本だけの記法スイッチ。書いたものだけが設定タブより優先される",
    en: "Syntax switches for this book alone; only the ones written here override the settings tab",
  },
  vfm: {
    group: "output",
    yamlOnly: true,
    ja: "VFM にそのまま渡すオプション。mathRenderer だけは効かず、数式は常に MathML で組む",
    en: "Options handed straight to VFM, except mathRenderer: math is always set as MathML",
  },
};

/**
 * The name every key goes by in the interface.
 *
 * One map, because the wizard and the property picker are two ways of setting
 * the same key and a writer who met `判型` in one should not meet `size` in
 * the other. `Record` rather than `Partial<Record>`: a key documented above
 * without a name here does not compile, which is how the two stay level.
 */
const KEY_LABELS: Record<NoteKey, StringKey> = {
  title: "colophon.title",
  subtitle: "colophon.subtitle",
  series: "colophon.series",
  author: "colophon.author",
  translator: "colophon.translator",
  publisher: "colophon.publisher",
  printer: "colophon.printer",
  contact: "colophon.contact",
  website: "colophon.website",
  date: "colophon.date",
  lang: "settings.lang",
  version: "colophon.version",
  labels: "key.labels",
  colophonExtra: "key.colophonExtra",

  theme: "book.theme",
  writingMode: "book.writingMode",
  size: "book.size",
  charsPerLine: "settings.charsPerLine",
  linesPerPage: "settings.linesPerPage",
  columns: "settings.columns",
  startSide: "settings.startSide",
  baseFontSize: "settings.baseFontSize",
  paragraphIndent: "settings.paragraphIndent",
  paragraphIndentMode: "settings.paragraphIndentMode",
  footnote: "book.footnote",
  highlight: "settings.highlight",
  botenMark: "settings.botenMark",
  autoTcy: "settings.autoTcy",
  imageWidthUnit: "settings.imageWidthUnit",

  cover: "settings.cover",
  coverPage: "settings.coverPage",
  coverFit: "settings.coverFit",
  coverInPdf: "settings.coverInPdf",

  fontFamily: "settings.fontFamily",
  headingFontFamily: "settings.headingFontFamily",
  monospaceFontFamily: "settings.monospaceFontFamily",
  mboxFontFamily: "settings.mboxFontFamily",
  tcyFontFamily: "settings.tcyFontFamily",
  fontFeatureSettings: "settings.fontFeatureSettings",
  rubyFontSize: "settings.rubyFontSize",
  embedFonts: "key.embedFonts",

  sections: "key.sections",
  pageNumbering: "settings.pageNumbering",
  tocDepth: "settings.tocDepth",
  startPage: "settings.startPage",
  includeToc: "settings.includeToc",
  order: "key.order",
  toc: "key.toc",

  output: "settings.output",
  cropMarks: "settings.cropMarks",
  bleed: "settings.bleed",
  css: "settings.extraCss",
  syntax: "key.syntax",
  vfm: "key.vfm",
};

const GROUP_TITLES: Record<string, { ja: string; en: string }> = {
  book: { ja: "本の情報", en: "Book information" },
  layout: { ja: "組版", en: "Typesetting" },
  cover: { ja: "表紙", en: "Cover" },
  fonts: { ja: "フォント", en: "Fonts" },
  structure: { ja: "前付け・後付け", en: "Front and back matter" },
  output: { ja: "出力", en: "Output" },
};

function locale(): Locale {
  return detectLocale();
}

/**
 * What a key means, in the interface language.
 *
 * The wizard and the generated YAML say the same thing about a key because
 * they read the same sentence: a description kept in only one of them would
 * drift out of step with the other the first time either was edited.
 */
export function keyDescription(key: NoteKey): string {
  return KEY_DOCS[key]?.[locale()] ?? "";
}

/**
 * What a key is called, in the interface language.
 *
 * The name of the key itself (`charsPerLine`, `vivlio-chars-per-line`) is
 * what the file says; it is not what a writer looking for "characters per
 * line" reads. A picker shows both, with the words first.
 */
export function keyLabel(key: NoteKey): string {
  return t(KEY_LABELS[key]);
}

/** A block of YAML turned into comments, so it documents without applying. */
function commented(block: string): string[] {
  return block.split("\n").map((line) => `# ${line}`);
}

function scalar(value: unknown): string {
  return dumpYaml(value, { lineWidth: -1, quotingType: '"' }).trimEnd();
}

function emit(key: string, value: unknown, indent = ""): string {
  if (value !== null && typeof value === "object") {
    const block = dumpYaml({ [key]: value }, { lineWidth: -1, quotingType: '"' }).trimEnd();
    return block
      .split("\n")
      .map((line) => `${indent}${line}`)
      .join("\n");
  }
  return `${indent}${key}: ${scalar(value)}`;
}

/**
 * `vivlio.yaml` with every key, its default and a comment.
 *
 * Written on request as a reference; the wizard writes the short version.
 */
export function referenceYaml(settings: VivlioSettings): string {
  const language = locale();
  const config = configFromSettings(settings);
  const lines: string[] = [
    language === "ja"
      ? "# Vivlio の本の設定。既定値と説明つきの全キー一覧です。"
      : "# Vivlio book configuration: every key, with its default and a note.",
    "",
  ];

  let currentGroup = "";
  for (const [key, doc] of Object.entries(KEY_DOCS) as [keyof BookConfig, KeyDoc][]) {
    // A note key describes one note's place in the book, not the book.
    if (doc.noteOnly) continue;
    if (doc.group !== currentGroup) {
      currentGroup = doc.group;
      lines.push("", `# --- ${GROUP_TITLES[currentGroup]?.[language] ?? currentGroup} ---`);
    }
    lines.push(`# ${doc[language]}${doc.yamlOnly ? (language === "ja" ? "（vivlio.yaml 専用）" : " (vivlio.yaml only)") : ""}`);

    if (key === "sections") {
      lines.push("sections:");
      for (const slot of SECTION_SLOTS) {
        lines.push(`  ${slot}: ${settings.sectionDefaults[slot] ?? "off"}`);
      }
      continue;
    }
    if (key === "labels") {
      lines.push(emit(key, defaultBookLabels(config.lang)));
      continue;
    }
    lines.push(emit(key, config[key]));
  }

  return `${lines.join("\n")}\n`;
}

export interface YamlOptions {
  /**
   * Write every key, not only the ones this book decides for itself.
   *
   * A key left at the default is written as a comment: the file then lists
   * everything the book could say, with today's answer beside it, while the
   * book still follows the vault default as that default changes. Taking one
   * over is a matter of deleting a `#`.
   */
  complete?: boolean;
}

/**
 * `vivlio.yaml` for one book.
 *
 * By default it holds only what differs from the defaults: writing every key
 * live would freeze today's defaults into the file and make the diff
 * unreadable (SPEC 5.4). `complete` keeps that property and lists the rest as
 * comments, so the file doubles as the reference for what else it could say.
 */
export function configToYaml(
  values: Partial<BookConfig>,
  defaults: BookConfig,
  options: YamlOptions = {},
): string {
  const language = locale();
  const complete = options.complete === true;
  const lines: string[] = [];

  if (complete) {
    lines.push(
      language === "ja"
        ? "# この本の設定。# で始まる行は Vault の既定値のままという意味で、"
        : "# This book's configuration. A line that starts with # is following",
      language === "ja"
        ? "# 行頭の # を外すと、この本だけの値になります。"
        : "# the vault default; drop the # to give this book a value of its own.",
    );
  }

  let currentGroup = "";
  for (const [key, doc] of Object.entries(KEY_DOCS) as [keyof BookConfig, KeyDoc][]) {
    if (doc.noteOnly) continue;

    const value = values[key];
    const chosen =
      value !== undefined &&
      value !== "" &&
      value !== null &&
      JSON.stringify(value) !== JSON.stringify(defaults[key]);
    if (!chosen && !complete) continue;

    if (doc.group !== currentGroup) {
      if (currentGroup || complete) lines.push("");
      currentGroup = doc.group;
      const title = GROUP_TITLES[currentGroup]?.[language] ?? currentGroup;
      lines.push(complete ? `# --- ${title} ---` : `# ${title}`);
    }
    if (complete) lines.push(`# ${doc[language]}`);

    if (complete && key === "sections") {
      const sections = { ...(values.sections ?? {}) };
      const lang = String(values.lang || defaults.lang || "ja");
      if (lang.trim().toLowerCase().startsWith("en")) {
        sections.copyrightPage ??= "auto";
        sections.colophon ??= "off";
      }
      lines.push(...sectionLines(sections, defaults.sections));
      continue;
    }
    if (complete && key === "labels") {
      const lang = String(values.lang || defaults.lang || "ja");
      lines.push(
        emit(
          key,
          resolveBookLabels({ lang, labels: values.labels ?? {} }),
        ),
      );
      continue;
    }
    if (chosen) lines.push(emit(key, value));
    else lines.push(...commented(emit(key, defaults[key])));
  }

  return `${lines.join("\n")}\n`;
}

/**
 * The `sections:` block with every slot listed, the chosen ones live.
 *
 * The mapping key stays live even when every slot under it is commented out,
 * so that uncommenting one slot is all it takes to add that part. An empty
 * `sections:` is a key nobody filled in, which the resolver skips.
 */
function sectionLines(
  values: Partial<Record<SectionSlot, string>>,
  defaults: Partial<Record<SectionSlot, string>>,
): string[] {
  const lines = ["sections:"];
  for (const slot of SECTION_SLOTS) {
    const own = values[slot];
    lines.push(
      own === undefined
        ? `#   ${slot}: ${defaults[slot] ?? "off"}`
        : `  ${slot}: ${scalar(own)}`,
    );
  }
  return lines;
}

/** Ticked when the picker opens on a note that has none of them yet (SPEC 5.4). */
export const STANDARD_KEYS: (keyof BookConfig)[] = [
  "theme",
  "size",
  "writingMode",
  "footnote",
  "highlight",
  "cover",
  "output",
];

/** One key the frontmatter picker can offer, with its group and its text. */
export interface FrontmatterKeyChoice {
  key: NoteKey;
  /** What the key is called in the interface, as the wizard calls it. */
  label: string;
  /** `vivlio-writing-mode` - what actually goes in the note. */
  property: string;
  group: string;
  groupLabel: string;
  description: string;
}

/**
 * Every key a note may carry, grouped as the reference file groups them.
 *
 * The keys that need nesting are left out: Obsidian's property editor cannot
 * edit nested YAML, so offering `sections` here would produce a note whose
 * own property panel breaks it. Those stay in the vivlio.yaml.
 */
export function frontmatterKeyChoices(): FrontmatterKeyChoice[] {
  const language = locale();
  const choices: FrontmatterKeyChoice[] = [];
  for (const [key, doc] of Object.entries(KEY_DOCS) as [NoteKey, KeyDoc][]) {
    if (doc.yamlOnly) continue;
    choices.push({
      key,
      label: keyLabel(key),
      property: `vivlio-${camelToKebab(key)}`,
      group: doc.group,
      groupLabel: GROUP_TITLES[doc.group]?.[language] ?? doc.group,
      description: doc[language],
    });
  }
  return choices;
}

/**
 * A flat `vivlio-*` frontmatter block.
 *
 * Obsidian's property editor cannot edit nested YAML, so a note only ever gets
 * flat keys - they show up in the property panel and stay editable there.
 *
 * A key chosen deliberately is written even when its value is empty
 * (`keepEmpty`): an empty property is a row in the property panel waiting to
 * be filled in, which is the whole reason for asking for it. A key that
 * arrives from a list nobody picked is not, since nobody asked for a blank.
 */
export function frontmatterSnippetFor(
  settings: VivlioSettings,
  keys: NoteKey[],
  keepEmpty = true,
): string {
  const config = configFromSettings(settings);
  const lines: string[] = [];
  for (const key of keys) {
    // A note key has no book-level default to offer, which is what an empty
    // value already means here: a row in the property panel to be filled in.
    const value = (config as Partial<Record<NoteKey, unknown>>)[key];
    const empty = value === "" || value === null || value === undefined;
    if (empty && !keepEmpty) continue;
    lines.push(`vivlio-${camelToKebab(key)}:${empty ? "" : ` ${scalar(value)}`}`);
  }
  return lines.join("\n");
}

/**
 * The value one key would arrive with, or "" when it arrives empty.
 *
 * The picker says it per row: a command that fills a property in has to show
 * what it is filling in, or the writer finds out by reading the note after.
 */
export function frontmatterValueFor(settings: VivlioSettings, key: NoteKey): string {
  const line = frontmatterSnippetFor(settings, [key]);
  return line.slice(line.indexOf(":") + 1).trim();
}

/** One property as the note carries it now. */
export interface NoteProperty {
  /** The value as a field can show it: `novel`, `39`, `true`, `` for empty. */
  value: string;
  /**
   * Whether the picker may rewrite it.
   *
   * A property written as a nested block or a list is not a value a one-line
   * field can hold, and replacing it with what such a field happens to
   * contain would throw the rest of it away.
   */
  editable: boolean;
}

/**
 * The properties already in a note's frontmatter, with their values.
 *
 * Read off the text rather than the metadata cache: the cache lags an edit by
 * a moment, and the picker may well be opened right after one.
 */
export function readFrontmatterProperties(content: string): Map<string, NoteProperty> {
  const properties = new Map<string, NoteProperty>();
  const block = frontmatterBlock(content);
  if (!block) return properties;

  for (let index = 0; index < block.body.length; index++) {
    // Only top-level keys: an indented line belongs to the value above it.
    const match = /^([A-Za-z0-9_-]+)\s*:(.*)$/.exec(block.body[index]);
    if (!match) continue;
    const [, property, rest] = match;
    const nested = index + 1 < block.body.length && isContinuation(block.body[index + 1]);
    properties.set(property, {
      value: nested ? rest.trim() : readScalar(rest.trim()),
      editable: !nested,
    });
  }
  return properties;
}

/** One property the picker wants written, or removed when the value is null. */
export interface FrontmatterEdit {
  property: string;
  value: string | null;
}

/** A replacement for the lines `[fromLine, toLine)` of the note. */
export interface FrontmatterPatch {
  text: string;
  fromLine: number;
  toLine: number;
}

/**
 * The note's frontmatter with the edits applied, as a patch (SPEC 5.4).
 *
 * A patch rather than a whole note, so that an edit to three properties is an
 * edit to the block they sit in: everything below the closing fence is left
 * untouched, cursor and undo history included.
 *
 * Properties the block does not have are appended in the order they were
 * asked for; properties nobody mentioned are left exactly as they are, in
 * their place. `null` removes one, with whatever indented lines belong to it.
 */
export function frontmatterPatch(
  content: string,
  edits: FrontmatterEdit[],
): FrontmatterPatch | null {
  const written = edits.filter((edit) => edit.value !== null);
  const block = frontmatterBlock(content);

  if (!block) {
    if (written.length === 0) return null;
    const body = written.map((edit) => propertyLine(edit.property, edit.value ?? ""));
    return { fromLine: 0, toLine: 0, text: `---\n${body.join("\n")}\n---\n\n` };
  }

  const pending = new Map(edits.map((edit) => [edit.property, edit.value]));
  const out: string[] = [];
  for (let index = 0; index < block.body.length; index++) {
    const line = block.body[index];
    const property = /^([A-Za-z0-9_-]+)\s*:/.exec(line)?.[1];
    if (!property || !pending.has(property)) {
      out.push(line);
      continue;
    }

    const value = pending.get(property) ?? null;
    pending.delete(property);
    // The new value stands for the old one entirely, nested lines and all.
    while (index + 1 < block.body.length && isContinuation(block.body[index + 1])) index++;
    if (value !== null) out.push(propertyLine(property, value));
  }
  for (const [property, value] of pending) {
    if (value !== null) out.push(propertyLine(property, value));
  }

  const text = out.length > 0 ? `---\n${out.join("\n")}\n---\n` : "";
  const before = content
    .split("\n")
    .slice(block.fromLine, block.toLine)
    .join("\n")
    .concat("\n");
  if (text === before) return null;
  return { text, fromLine: block.fromLine, toLine: block.toLine };
}

interface FrontmatterBlock {
  body: string[];
  fromLine: number;
  /** One past the closing fence, so `[fromLine, toLine)` is the whole block. */
  toLine: number;
}

function frontmatterBlock(content: string): FrontmatterBlock | null {
  if (!content.startsWith("---")) return null;
  const lines = content.split("\n");
  for (let index = 1; index < lines.length; index++) {
    if (/^(---|\.\.\.)\s*$/.test(lines[index])) {
      return { body: lines.slice(1, index), fromLine: 0, toLine: index + 1 };
    }
  }
  // An opening fence that never closes is not a block anyone should edit.
  return null;
}

function isContinuation(line: string): boolean {
  return /^\s+\S/.test(line);
}

function propertyLine(property: string, value: string): string {
  return `${property}:${value ? ` ${value}` : ""}`;
}

/**
 * A written value as a field should show it.
 *
 * `"novel"` and `novel` are the same theme, and a dropdown that is handed the
 * first has no option matching it. Anything YAML does not read as a scalar -
 * a flow list, a mapping - is shown as written and left alone.
 */
function readScalar(raw: string): string {
  if (raw === "") return "";
  const parsed = readYaml(raw);
  switch (typeof parsed) {
    case "string":
      return parsed;
    case "number":
    case "boolean":
      return String(parsed);
    default:
      return raw;
  }
}

/**
 * A typed value as YAML has to carry it.
 *
 * What the writer types is YAML already when YAML can read it back as one
 * value; a colophon line like `装丁: 山田花子` cannot be, and is quoted so the
 * property keeps the text rather than becoming a mapping.
 */
export function writeScalar(raw: string): string {
  const value = raw.trim();
  if (value === "") return "";
  const parsed = readYaml(value);
  const scalarValue =
    typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean";
  return scalarValue ? value : scalar(value);
}

/** YAML as far as it parses; anything it refuses is not a value we can read. */
function readYaml(raw: string): unknown {
  try {
    return loadYaml(raw);
  } catch {
    return undefined;
  }
}

/** Take a book's `vivlio.yaml` back into the settings tab (SPEC 5.4). */
export function settingsFromYaml(
  yaml: Record<string, unknown>,
  settings: VivlioSettings,
): VivlioSettings {
  const next: VivlioSettings = { ...settings, syntax: { ...settings.syntax } };
  const assign = <K extends keyof VivlioSettings>(key: K, value: unknown): void => {
    if (value === undefined || value === null || value === "") return;
    next[key] = value as VivlioSettings[K];
  };

  assign("theme", yaml.theme);
  assign("size", yaml.size);
  assign("writingMode", yaml.writingMode);
  assign("footnote", yaml.footnote);
  assign("highlight", yaml.highlight);
  assign("botenMark", yaml.botenMark);
  assign("fontFamily", yaml.fontFamily);
  assign("headingFontFamily", yaml.headingFontFamily);
  assign("monospaceFontFamily", yaml.monospaceFontFamily);
  assign("pageNumbering", yaml.pageNumbering);
  assign("tocDepth", yaml.tocDepth);
  if (typeof yaml.autoTcy === "boolean") next.syntax.autoTcy = yaml.autoTcy;
  if (yaml.sections && typeof yaml.sections === "object") {
    next.sectionDefaults = {
      ...next.sectionDefaults,
      ...(yaml.sections as VivlioSettings["sectionDefaults"]),
    };
  }
  return next;
}

/**
 * The settings tab as a `vivlio.yaml`, to pin a book to today's defaults.
 *
 * Compared against the factory defaults rather than against the settings, so
 * everything the user changed in the tab is actually written out.
 */
export function settingsToYaml(settings: VivlioSettings): string {
  const config = configFromSettings(settings);
  const values: Partial<BookConfig> = {};
  for (const key of Object.keys(KEY_DOCS) as (keyof BookConfig)[]) {
    (values as Record<string, unknown>)[key] = config[key];
  }
  return configToYaml(values, configFromSettings(DEFAULT_SETTINGS));
}
