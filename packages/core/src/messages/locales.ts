import type { BgTranslation } from "./en/index.js";

/**
 * Translations of BG_MESSAGES, loaded on demand (each is its own chunk; English needs none). Codes match
 * @clip-wallet/i18n's LOCALE_CODES. Consumers: the UI (approval screens, errors, activity) and the
 * notification watcher.
 */
export const BG_LOCALE_LOADERS = {
  "de": () => import("./locales/de.js"),
  "fr": () => import("./locales/fr.js"),
  "es": () => import("./locales/es.js"),
  "pt-BR": () => import("./locales/pt-BR.js"),
  "it": () => import("./locales/it.js"),
  "tr": () => import("./locales/tr.js"),
  "ja": () => import("./locales/ja.js"),
  "ko": () => import("./locales/ko.js"),
  "zh-Hans": () => import("./locales/zh-Hans.js"),
  "ar": () => import("./locales/ar.js"),
  "hi": () => import("./locales/hi.js"),
} as const satisfies Record<string, () => Promise<{ default: BgTranslation }>>;

export type BgLocale = keyof typeof BG_LOCALE_LOADERS;

/** A language's background messages, or undefined for English and languages without a translation. */
export async function loadBgMessages(locale: string): Promise<BgTranslation | undefined> {
  const load = (BG_LOCALE_LOADERS as Record<string, (() => Promise<{ default: BgTranslation }>) | undefined>)[locale];
  return load ? (await load()).default : undefined;
}
