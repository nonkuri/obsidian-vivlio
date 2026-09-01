export type LogLevel = "silent" | "error" | "info" | "debug";

const ORDER: Record<LogLevel, number> = { silent: 0, error: 1, info: 2, debug: 3 };

let level: LogLevel = "error";

export function setLogLevel(next: LogLevel): void {
  level = next;
}

function enabled(required: LogLevel): boolean {
  return ORDER[level] >= ORDER[required];
}

/**
 * The last lines the plugin logged, kept whatever the log level is.
 *
 * A failure during an export is announced by a notice that disappears after a
 * few seconds, and the console needs the developer tools to be open. The ring
 * buffer means the run leading up to a failure can still be written out
 * afterwards, without asking anyone to reproduce it with logging turned up.
 */
const HISTORY_LIMIT = 400;
const history: string[] = [];

function record(kind: string, args: unknown[]): void {
  const line = `${new Date().toISOString()} ${kind} ${args.map(format).join(" ")}`;
  history.push(line);
  if (history.length > HISTORY_LIMIT) history.shift();
}

function format(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ""}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** The recorded lines, oldest first. */
export function logHistory(): string[] {
  return [...history];
}

export function clearLogHistory(): void {
  history.length = 0;
}

/** The session token must never reach the log (SPEC 5.12, defence 7). */
export const log = {
  error(...args: unknown[]): void {
    record("ERROR", args);
    if (enabled("error")) console.error("[vivlio]", ...args);
  },
  info(...args: unknown[]): void {
    record("INFO ", args);
    if (enabled("info")) console.info("[vivlio]", ...args);
  },
  debug(...args: unknown[]): void {
    record("DEBUG", args);
    if (enabled("debug")) console.debug("[vivlio]", ...args);
  },
};
