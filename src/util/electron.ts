/**
 * Access to the Electron APIs Obsidian exposes to the renderer.
 *
 * The plugin is desktop-only (`isDesktopOnly: true`), so `electron` resolves;
 * every entry point still degrades gracefully, because the shape of `remote`
 * is not part of Obsidian's public contract.
 */

interface RemoteDialog {
  showSaveDialog(options: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ canceled: boolean; filePath?: string }>;
}

interface RemoteWebContents {
  fromId(id: number): RemoteWebContentsInstance | null;
}

export interface RemoteWebContentsInstance {
  debugger: {
    attach(version?: string): void;
    detach(): void;
    isAttached(): boolean;
    sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
  };
  /** Chromium throttles timers in pages it considers hidden. */
  setBackgroundThrottling?(allowed: boolean): void;
}

interface RemoteShell {
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): void;
}

interface ElectronRemote {
  dialog: RemoteDialog;
  webContents: RemoteWebContents;
  shell: RemoteShell;
}

interface ElectronModule {
  remote?: ElectronRemote;
  shell?: RemoteShell;
}

export function electron(): ElectronModule | null {
  try {
    return (window.require?.("electron") as ElectronModule | undefined) ?? null;
  } catch {
    return null;
  }
}

export function remote(): ElectronRemote | null {
  return electron()?.remote ?? null;
}

export async function showSaveDialog(options: {
  title: string;
  defaultPath: string;
  extension: string;
}): Promise<string | null> {
  const dialog = remote()?.dialog;
  if (!dialog) return null;
  const result = await dialog.showSaveDialog({
    title: options.title,
    defaultPath: options.defaultPath,
    filters: [{ name: options.extension.toUpperCase(), extensions: [options.extension] }],
  });
  return result.canceled || !result.filePath ? null : result.filePath;
}

export async function openPath(path: string): Promise<void> {
  const shell = remote()?.shell ?? electron()?.shell;
  await shell?.openPath(path);
}

/** Reveal a file in Explorer / Finder, selected. */
export function showInFolder(path: string): void {
  const shell = remote()?.shell ?? electron()?.shell;
  shell?.showItemInFolder(path);
}

declare global {
  interface Window {
    require?: (module: string) => unknown;
  }
}
