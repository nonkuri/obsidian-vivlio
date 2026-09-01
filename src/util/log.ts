export type LogLevel = "silent" | "error" | "info" | "debug";

const ORDER: Record<LogLevel, number> = { silent: 0, error: 1, info: 2, debug: 3 };

let level: LogLevel = "error";

export function setLogLevel(next: LogLevel): void {
  level = next;
}

function enabled(required: LogLevel): boolean {
  return ORDER[level] >= ORDER[required];
}

/** The session token must never reach the log (SPEC 5.12, defence 7). */
export const log = {
  error(...args: unknown[]): void {
    if (enabled("error")) console.error("[vivlio]", ...args);
  },
  info(...args: unknown[]): void {
    if (enabled("info")) console.info("[vivlio]", ...args);
  },
  debug(...args: unknown[]): void {
    if (enabled("debug")) console.debug("[vivlio]", ...args);
  },
};
