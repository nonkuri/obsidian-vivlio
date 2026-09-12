import type { App, TFile } from "obsidian";
import { BOTEN_MARK_CHOICES, PAPER_SIZE_CHOICES } from "../config/defaults";
import { INDENT_MODES, PAGE_SIDES } from "../config/types";
import type { NoteKey } from "../config/yaml";
import { themeChoices } from "../build/theme";
import { isImagePath } from "../util/paths";
import { t, type StringKey } from "../i18n";

export interface Choice {
  value: string;
  label: string;
}

/**
 * How a key is answered: by picking, by switching, or by typing.
 *
 * `custom` marks a list that does not exhaust the answers - a book may use a
 * mark for its emphasis dots that no list was ever going to name - so the
 * picker offers a field beside the list.
 */
export type KeyControl =
  | { kind: "text" }
  | { kind: "bool" }
  | { kind: "select"; choices: Choice[]; custom?: boolean };

/** Keys whose answer is a switch, written `true` / `false`. */
const BOOLEAN_KEYS: NoteKey[] = ["autoTcy", "coverInPdf", "includeToc", "cropMarks", "toc"];

/** Keys the emphasis-mark list cannot exhaust. */
const CUSTOM_KEYS: NoteKey[] = ["botenMark"];

/**
 * The answers a key takes, for every interface that asks for one.
 *
 * The wizard and the property picker set the same keys, so the list of themes
 * or of paper sizes is written once: a list that lived in one of them would
 * be the list the other was missing an entry from.
 *
 * `current` is kept in the list when it is not one of the answers offered -
 * a book set up before a theme was renamed still says what it says, and a
 * dropdown that silently reads as its first entry would change the book the
 * moment it was opened.
 */
export function keyChoices(app: App, key: NoteKey, current = ""): Choice[] {
  switch (key) {
    case "theme":
      return themeChoices(app, current).map((choice) => ({
        value: choice.value,
        label: choice.label,
      }));
    case "size":
      return PAPER_SIZE_CHOICES.map((size) => ({
        value: size.value,
        label: t(size.labelKey as StringKey),
      }));
    case "writingMode":
      return labelled(["vertical-rl", "horizontal-tb"], "settings.writingMode");
    case "lang":
      return [
        { value: "ja", label: "ja — 日本語" },
        { value: "en", label: "en — English" },
      ];
    case "startSide":
      return labelled([...PAGE_SIDES], "settings.startSide");
    case "paragraphIndentMode":
      return labelled([...INDENT_MODES], "settings.paragraphIndentMode");
    case "footnote":
      return labelled(["gcpm", "pandoc", "dpub"], "settings.footnote");
    case "highlight":
      return labelled(["boten", "strong", "mark", "off"], "settings.highlight");
    case "imageWidthUnit":
      return labelled(["px", "percent", "mm"], "settings.imageWidthUnit");
    case "coverFit":
      return labelled(["cover", "contain"], "settings.coverFit");
    case "pageNumbering":
      return labelled(["continuous", "roman-then-arabic", "none"], "settings.pageNumbering");
    case "botenMark":
      return BOTEN_MARK_CHOICES.map((choice) => ({
        value: choice.value,
        label: `${choice.value} — ${t(choice.labelKey as StringKey)}`,
      }));
    case "cover":
      return paths(app.vault.getFiles().filter((file: TFile) => isImagePath(file.path)));
    case "coverPage":
      return paths(app.vault.getMarkdownFiles());
    default:
      return [];
  }
}

/** What kind of control answers this key. */
export function keyControl(app: App, key: NoteKey, current = ""): KeyControl {
  if (BOOLEAN_KEYS.includes(key)) return { kind: "bool" };
  const choices = keyChoices(app, key, current);
  if (choices.length === 0) return { kind: "text" };
  return { kind: "select", choices, custom: CUSTOM_KEYS.includes(key) };
}

function labelled(values: string[], prefix: string): Choice[] {
  return values.map((value) => ({ value, label: t(`${prefix}.${value}` as StringKey) }));
}

/** Vault files as paths, in an order that does not move between renders. */
function paths(files: TFile[]): Choice[] {
  return files
    .map((file) => file.path)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 500)
    .map((path) => ({ value: path, label: path }));
}
