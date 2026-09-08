/** A `url(...)` token outside CSS comments and strings. */
export interface CssUrlToken {
  /** The value inside the optional quotes, without surrounding whitespace. */
  value: string;
  /** Offset of the `u` in `url`. */
  start: number;
}

/**
 * Rewrite CSS `url(...)` values while preserving their original spelling.
 *
 * A regular expression is not enough here: examples in comments and text in
 * quoted declarations must not turn into asset references. This deliberately
 * scans only as much CSS grammar as a URL needs, leaving malformed functions
 * untouched for the browser to diagnose.
 */
export function mapCssUrls(
  source: string,
  rewrite: (token: CssUrlToken) => string,
): string {
  let output = "";
  let copiedThrough = 0;
  let index = 0;

  while (index < source.length) {
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }

    const char = source[index];
    if (char === '"' || char === "'") {
      index = quotedEnd(source, index, char);
      continue;
    }

    if (
      source.slice(index, index + 3).toLowerCase() === "url" &&
      !isIdentifierChar(source[index - 1] ?? "")
    ) {
      const token = urlAt(source, index);
      if (token) {
        const replacement = rewrite({ value: source.slice(token.valueStart, token.valueEnd), start: index });
        output += source.slice(copiedThrough, token.valueStart) + replacement;
        copiedThrough = token.valueEnd;
        index = token.end;
        continue;
      }
    }

    index += 1;
  }

  return output + source.slice(copiedThrough);
}

interface ParsedUrl {
  valueStart: number;
  valueEnd: number;
  end: number;
}

function urlAt(source: string, start: number): ParsedUrl | null {
  let index = start + 3;
  while (isWhitespace(source[index])) index += 1;
  if (source[index] !== "(") return null;
  index += 1;
  while (isWhitespace(source[index])) index += 1;

  const quote = source[index];
  if (quote === '"' || quote === "'") {
    const valueStart = index + 1;
    const afterQuote = quotedEnd(source, index, quote);
    if (afterQuote > source.length || source[afterQuote - 1] !== quote) return null;
    const valueEnd = afterQuote - 1;
    index = afterQuote;
    while (isWhitespace(source[index])) index += 1;
    if (source[index] !== ")") return null;
    return { valueStart, valueEnd, end: index + 1 };
  }

  const valueStart = index;
  while (index < source.length) {
    if (source[index] === "\\") {
      index = escapedEnd(source, index);
      continue;
    }
    if (source[index] === '"' || source[index] === "'" || source[index] === "(") return null;
    if (source[index] === ")") {
      let valueEnd = index;
      while (valueEnd > valueStart && isWhitespace(source[valueEnd - 1])) valueEnd -= 1;
      return { valueStart, valueEnd, end: index + 1 };
    }
    index += 1;
  }
  return null;
}

function quotedEnd(source: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index = escapedEnd(source, index);
      continue;
    }
    index += 1;
    if (source[index - 1] === quote) return index;
  }
  return source.length + 1;
}

function escapedEnd(source: string, slash: number): number {
  if (source[slash + 1] === "\r" && source[slash + 2] === "\n") return slash + 3;
  return Math.min(source.length, slash + 2);
}

function isWhitespace(char: string | undefined): boolean {
  return char !== undefined && /[\t\n\f\r ]/.test(char);
}

function isIdentifierChar(char: string): boolean {
  return /[A-Za-z0-9_-]/.test(char);
}
