/**
 * Japanese numerals, for the places a vertical page cannot use digits.
 *
 * A vertically set book writes its dates in kanji: Western digits in a
 * vertical line are either laid on their side or set as tate-chu-yoko, and a
 * colophon does neither - it says 二〇二六年九月二日.
 */

const DIGITS = "〇一二三四五六七八九";

/** A number written digit by digit: 2026 -> 二〇二六. How a year is written. */
export function kanjiDigits(value: number): string {
  return String(Math.trunc(Math.abs(value)))
    .split("")
    .map((digit) => DIGITS[Number(digit)] ?? digit)
    .join("");
}

/**
 * A number as it is counted, up to 99: 9 -> 九, 10 -> 十, 21 -> 二十一.
 *
 * Enough for a month and a day, which is all a date needs. Above 99 the
 * digit-by-digit form is returned instead of a wrong one.
 */
export function kanjiNumber(value: number): string {
  const n = Math.trunc(Math.abs(value));
  if (n >= 100) return kanjiDigits(n);
  if (n < 10) return DIGITS[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens > 1 ? DIGITS[tens] : ""}十${ones > 0 ? DIGITS[ones] : ""}`;
}

/** `2026-09-02`, `2026/9/2`, `2026年9月2日` - and a year or a month alone. */
const DATE = /^\s*(\d{1,4})\s*[-/年.]\s*(?:(\d{1,2})\s*(?:[-/月.]\s*(?:(\d{1,2})\s*日?)?)?)?\s*$/;
const YEAR_ONLY = /^\s*(\d{3,4})\s*年?\s*$/;

/**
 * A date rewritten in kanji, or the string untouched when it is not one.
 *
 * Leaving anything unrecognised alone matters: `date` is a free-text field, and
 * a book that writes "第三刷" or "令和八年" there means it.
 */
export function kanjiDate(value: string): string {
  const text = String(value ?? "").trim();
  if (!text) return text;

  const yearOnly = YEAR_ONLY.exec(text);
  if (yearOnly) return `${kanjiDigits(Number(yearOnly[1]))}年`;

  const parts = DATE.exec(text);
  if (!parts) return text;

  let out = `${kanjiDigits(Number(parts[1]))}年`;
  if (parts[2]) out += `${kanjiNumber(Number(parts[2]))}月`;
  if (parts[3]) out += `${kanjiNumber(Number(parts[3]))}日`;
  return out;
}
