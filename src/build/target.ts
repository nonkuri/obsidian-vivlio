import { TFile, normalizePath, type TAbstractFile } from "obsidian";
import type { BuildTarget } from "./collect";
import { joinPosix } from "../util/paths";

/** The configuration file that identifies one folder as one book. */
export const CONFIG_FILE = "vivlio.yaml";

/** Turn an active editor file into the book the ordinary commands should use. */
export function targetForActiveFile(file: TFile | null): BuildTarget | null {
  if (!file) return null;
  if (file.extension === "md") return { kind: "note", file };
  if (file.extension.toLowerCase() === "yaml" && file.parent) {
    return { kind: "config", file, folder: file.parent };
  }
  return null;
}

/**
 * Configuration files named by a File Explorer multi-selection. Duplicate
 * paths are collapsed, but two YAML files beside the same manuscript remain
 * distinct because they may intentionally describe different editions.
 */
export function configTargetsInSelection(files: TAbstractFile[]): BuildTarget[] {
  const targets: BuildTarget[] = [];
  const paths = new Set<string>();
  for (const entry of files) {
    if (!(entry instanceof TFile) || entry.extension.toLowerCase() !== "yaml" || !entry.parent) continue;
    if (paths.has(entry.path)) continue;
    paths.add(entry.path);
    targets.push({ kind: "config", file: entry, folder: entry.parent });
  }
  return targets;
}

export interface WizardConfigTarget {
  bookRoot: string;
  configPath: string;
}

/** The file the setup wizard reads and writes for the current editor. */
export function wizardConfigTarget(file: TFile | null): WizardConfigTarget {
  const folder = file?.parent;
  const bookRoot = folder?.path === "/" ? "" : (folder?.path ?? "");
  const configPath =
    file?.extension.toLowerCase() === "yaml"
      ? file.path
      : normalizePath(joinPosix(bookRoot, CONFIG_FILE));
  return { bookRoot, configPath };
}
