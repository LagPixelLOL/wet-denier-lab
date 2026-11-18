/**
 * Supported locales and how the browser's preferred one is picked. Kept free of imports so the UI store can use it.
 */

/** Supported locales in menu order, each with its name in its own language. */
export const LOCALES = [
  { id: "zh-CN", name: "简体中文" },
  { id: "en-US", name: "English" },
] as const;

export type Locale = (typeof LOCALES)[number]["id"];

/** The locale the app was written in, used until startup detects the browser's. */
export const DEFAULT_LOCALE: Locale = "zh-CN";

/** Used when none of the browser's languages is supported. */
export const FALLBACK_LOCALE: Locale = "en-US";

/** The first supported locale among the browser's preferred languages, matched by language (zh-TW also gets zh-CN). */
export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const language = tag.toLowerCase().split(/[-_]/)[0];
    const match = LOCALES.find(({ id }) => id.toLowerCase().split("-")[0] === language);
    if (match) {
      return match.id;
    }
  }
  return FALLBACK_LOCALE;
}

/** The browser's preferred languages, most preferred first. */
export const browserLanguages = (): readonly string[] =>
  navigator.languages?.length ? navigator.languages : [navigator.language].filter(Boolean);
