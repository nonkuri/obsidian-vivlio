import type { App } from "obsidian";
import { logHistory } from "./log";

/** Where the diagnostic log is written, relative to the vault. */
export function logPath(app: App): string {
  return `${app.vault.configDir}/plugins/vivlio/vivlio.log`;
}

/**
 * Write what led up to a failure to a file.
 *
 * A notice is gone in seconds and the console needs the developer tools to be
 * open, so a failure that only appears while exporting would otherwise leave
 * nothing to look at afterwards.
 */
export async function writeDiagnostics(
  app: App,
  context: string,
  error: unknown,
): Promise<string | null> {
  const path = logPath(app);
  const report = [
    `# Vivlio diagnostic log`,
    `written: ${new Date().toISOString()}`,
    `context: ${context}`,
    `obsidian: ${(app as unknown as { appId?: string }).appId ? "desktop" : "unknown"}`,
    "",
    `## error`,
    describe(error),
    "",
    `## log`,
    ...logHistory(),
    "",
  ].join("\n");

  try {
    await app.vault.adapter.write(path, report);
    return path;
  } catch {
    // Writing the log must never be the reason an export reports a failure.
    return null;
  }
}

export function describe(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? "(no stack)"}`;
  }
  return String(error);
}
