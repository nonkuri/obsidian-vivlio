/**
 * Minimal stand-in for the `obsidian` module, so the conversion pipeline can
 * be exercised outside the app. Only the surface the build path touches is
 * implemented.
 */

export class TAbstractFile {
  path = "";
  name = "";
  parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
  extension = "md";
  basename = "";
  stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}

export class Component {
  load(): void {}
  unload(): void {}
}

export class Notice {
  constructor(public message: string) {}
}

export const MarkdownRenderer = {
  async render(): Promise<void> {},
};

export async function requestUrl(): Promise<{ arrayBuffer: ArrayBuffer; headers: Record<string, string> }> {
  return { arrayBuffer: new ArrayBuffer(0), headers: {} };
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export function setIcon(): void {}

export class Modal {}
export class Setting {}
export class PluginSettingTab {}
export class ItemView {}
export class Plugin {}
