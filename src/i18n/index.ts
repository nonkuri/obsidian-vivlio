import { getLanguage } from "obsidian";
import { en, type StringKey } from "./en";
import { ja } from "./ja";
import type { Language } from "../config/types";

let dictionary: Partial<Record<StringKey, string>> = en;

/**
 * The language Obsidian is set to, as `getLanguage()` reports it (SPEC 5.5).
 * Fallback is English.
 *
 * This used to read `localStorage.language` the way community plugins did
 * before there was an API for it. There is one now, and it answers the
 * question directly rather than through the app's own storage.
 *
 * The tests run this outside Obsidian, where the call does not exist, so a
 * missing one is English rather than a crash.
 */
export function detectLocale(): "ja" | "en" {
  let locale = "";
  try {
    locale = getLanguage();
  } catch {
    return "en";
  }
  return locale.startsWith("ja") ? "ja" : "en";
}

export function setLanguage(language: Language): void {
  const resolved = language === "auto" ? detectLocale() : language;
  dictionary = resolved === "ja" ? { ...en, ...ja } : en;
}

/** Look up a string, interpolating `{name}` placeholders. */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const template = dictionary[key] ?? en[key] ?? String(key);
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export type { StringKey };
