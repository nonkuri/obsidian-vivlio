/** Thrown when an `AbortSignal` fires during a build or export. */
export class AbortError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortError();
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface Debounced<T extends unknown[]> {
  (...args: T): void;
  cancel(): void;
}

export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  ms: number,
): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: T) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return debounced as Debounced<T>;
}

/** Poll `check` until it returns true, or reject after `timeoutMs`. */
export async function waitUntil(
  check: () => boolean | Promise<boolean>,
  options: { timeoutMs: number; intervalMs?: number; signal?: AbortSignal; label?: string },
): Promise<void> {
  const { timeoutMs, intervalMs = 100, signal, label = "condition" } = options;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    throwIfAborted(signal);
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await delay(intervalMs, signal);
  }
}

/**
 * Wait for a subtree to stop changing.
 *
 * Dataview and mermaid keep drawing after `MarkdownRenderer.render()` resolves
 * (SPEC 5.8(8)), so the caller has to watch for the DOM going quiet instead of
 * trusting the promise.
 */
export function waitForDomIdle(
  target: HTMLElement,
  options: { timeoutMs?: number; quietMs?: number } = {},
): Promise<void> {
  const { timeoutMs = 5000, quietMs = 200 } = options;
  return new Promise((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout>;
    const observer = new MutationObserver(() => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, quietMs);
    });
    const finish = () => {
      clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      observer.disconnect();
      resolve();
    };
    const hardTimer = setTimeout(finish, timeoutMs);
    quietTimer = setTimeout(finish, quietMs);
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  });
}
