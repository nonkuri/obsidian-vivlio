import type { App, Component, TFile } from "obsidian";
import type { BookConfig, SectionSlot, VivlioSettings } from "../config/types";
import type { Workspace } from "./workspace";

export type BuildMode = "preview" | "pdf" | "epub";

export type WarningKind =
  | "broken-link"
  | "missing-asset"
  | "missing-font"
  | "low-dpi"
  | "cover-aspect"
  | "no-cover"
  | "config"
  | "unsupported"
  | "chapter-error";

export interface BuildWarning {
  kind: WarningKind;
  message: string;
  /** Vault path of the note the warning came from, when known. */
  source?: string;
}

/** One document in the spine. */
export interface Chapter {
  /** Workspace-relative document name, e.g. `ch01.html`. */
  docName: string;
  /** Source note; absent for generated documents (cover, TOC, colophon). */
  file: TFile | null;
  title: string;
  /** DPUB role applied to the section wrapper, e.g. `doc-preface`. */
  role: string | null;
  /** Front/back matter slot this document fills, if any. */
  slot: SectionSlot | null;
  /** Cover and front matter are not body chapters (SPEC 5.9, 5.11). */
  isBody: boolean;
  /** Front matter gets roman numerals under `roman-then-arabic`. */
  isFrontMatter: boolean;
  /** Pre-generated HTML for documents with no source note. */
  html?: string;
  /** `counter-reset: page` value, used to restart numbering at the body. */
  startPage?: number;
}

export interface HeadingEntry {
  level: number;
  text: string;
  slug: string;
}

export interface BuildContext {
  app: App;
  settings: VivlioSettings;
  config: BookConfig;
  workspace: Workspace;
  mode: BuildMode;
  /** Vault-relative folder that owns `vivlio.yaml`; "" for the vault root. */
  bookRoot: string;
  chapters: Chapter[];
  /** Vault path -> chapter, for resolving `[[links]]` between chapters. */
  chapterByPath: Map<string, Chapter>;
  /** Vault path -> heading slugs, mirroring VFM's slugger. */
  headings: Map<string, HeadingEntry[]>;
  warnings: BuildWarning[];
  /** Owner for `MarkdownRenderer.render()` children (SPEC 5.8(8)). */
  component: Component;
  /** Base URL of the workspace on the local server, with a trailing slash. */
  workspaceBase: string;
  /** Base URL for `/vault/...`. */
  vaultBase: string;
  /** Base URL for bundled themes. */
  themeBase: string;
  signal?: AbortSignal;
}

export function warn(context: BuildContext, warning: BuildWarning): void {
  const duplicate = context.warnings.some(
    (existing) => existing.kind === warning.kind && existing.message === warning.message,
  );
  if (!duplicate) context.warnings.push(warning);
}
