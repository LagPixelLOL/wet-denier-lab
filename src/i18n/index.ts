/**
 * UI translations. The current locale lives in the UI store, so components re-render when it changes. Engine code
 * never translates: it keeps message keys in the store (hints, tips) and components translate them while rendering.
 */
import { ui } from "../state/ui";
import { useStore } from "../state/useStore";
import { enUS } from "./messages/en-US";
import { zhCN } from "./messages/zh-CN";
import type { Locale } from "./locales";

export * from "./locales";

export type MessageKey = keyof typeof zhCN;

/** A complete set of UI text for one locale. */
export type Messages = Record<MessageKey, string>;

export type MessageParams = Readonly<Record<string, string | number>>;

const MESSAGES: Record<Locale, Messages> = { "zh-CN": zhCN, "en-US": enUS };

/** Text for `key` in `locale`, with each "{name}" replaced by `params[name]`. */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const text = MESSAGES[locale][key];
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match)) : text;
}

/** A translator for the current locale; the component re-renders when the locale changes. */
export function useT() {
  const locale = useStore(ui, (s) => s.locale);
  return (key: MessageKey, params?: MessageParams) => translate(locale, key, params);
}
