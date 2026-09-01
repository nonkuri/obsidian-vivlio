import { en, type StringKey } from "./en";
import { ja } from "./ja";
import type { Language } from "../config/types";

let dictionary: Partial<Record<StringKey, string>> = en;

/**
 * Obsidian exposes no i18n API, so the locale is read the way other community
 * plugins read it (SPEC 5.5). Fallback is English.
 */
export function detectLocale(): "ja" | "en" {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem("language");
    if (stored) return stored.startsWith("ja") ? "ja" : "en";
  } catch {
    // localStorage can be unavailable; fall through to moment / navigator.
  }
  const moment = (window as unknown as { moment?: { locale(): string } }).moment;
  const locale = moment?.locale?.() ?? navigator?.language ?? "en";
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
