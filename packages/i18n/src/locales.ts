/**
 * The languages Clip Wallet ships, and how a device's language list maps onto them.
 *
 * Codes are BCP 47 (https://www.rfc-editor.org/rfc/rfc5646): "pt-BR" is Brazilian Portuguese, "zh-Hans" is
 * Chinese in Simplified script. Text direction comes from the script: Arabic is right-to-left.
 */
export const LOCALE_CODES = ["en", "de", "fr", "es", "pt-BR", "it", "tr", "ja", "ko", "zh-Hans", "ar", "hi"] as const;
export type LocaleCode = (typeof LOCALE_CODES)[number];

/** A user's language choice: a shipped locale, or "system" (follow the device). */
export type LocalePref = "system" | LocaleCode;

export const DEFAULT_LOCALE: LocaleCode = "en";

export interface LocaleInfo {
  code: LocaleCode;
  /** The language's name in itself: what the picker shows ("Deutsch", "日本語"). */
  nativeName: string;
  /** The English name, for tests and docs. */
  englishName: string;
  dir: "ltr" | "rtl";
}

export const LOCALES: readonly LocaleInfo[] = [
  { code: "en", nativeName: "English", englishName: "English", dir: "ltr" },
  { code: "de", nativeName: "Deutsch", englishName: "German", dir: "ltr" },
  { code: "fr", nativeName: "Français", englishName: "French", dir: "ltr" },
  { code: "es", nativeName: "Español", englishName: "Spanish", dir: "ltr" },
  { code: "pt-BR", nativeName: "Português (Brasil)", englishName: "Portuguese (Brazil)", dir: "ltr" },
  { code: "it", nativeName: "Italiano", englishName: "Italian", dir: "ltr" },
  { code: "tr", nativeName: "Türkçe", englishName: "Turkish", dir: "ltr" },
  { code: "ja", nativeName: "日本語", englishName: "Japanese", dir: "ltr" },
  { code: "ko", nativeName: "한국어", englishName: "Korean", dir: "ltr" },
  { code: "zh-Hans", nativeName: "简体中文", englishName: "Chinese (Simplified)", dir: "ltr" },
  { code: "ar", nativeName: "العربية", englishName: "Arabic", dir: "rtl" },
  { code: "hi", nativeName: "हिन्दी", englishName: "Hindi", dir: "ltr" },
];

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "ps", "sd", "ug", "yi", "dv", "ckb"]);

export function isLocaleCode(x: unknown): x is LocaleCode {
  return typeof x === "string" && (LOCALE_CODES as readonly string[]).includes(x);
}

export function localeInfo(code: LocaleCode): LocaleInfo {
  return LOCALES.find((l) => l.code === code)!;
}

/** Writing direction of any BCP 47 tag (not only shipped ones). */
export function dirOf(tag: string): "ltr" | "rtl" {
  const [lang = "", ...rest] = tag.toLowerCase().split(/[-_]/);
  // A script subtag overrides the language default (e.g. "az-Arab", "pa-Arab").
  if (rest.includes("arab") || rest.includes("hebr")) return "rtl";
  if (rest.some((s) => s.length === 4)) return "ltr";
  return RTL_LANGUAGES.has(lang) ? "rtl" : "ltr";
}

/**
 * Picks the best shipped locale for a device's preferred languages (navigator.languages, expo-localization
 * getLocales()). The first language we ship wins; otherwise English.
 *   "pt", "pt-PT", "pt-BR"      → pt-BR (the only Portuguese we ship)
 *   "zh", "zh-CN", "zh-Hans-SG" → zh-Hans; "zh-TW", "zh-Hant-HK" also → zh-Hans (no Traditional yet; most
 *                                 Traditional readers read Simplified more easily than English)
 */
export function negotiateLocale(requested: readonly (string | undefined | null)[], offered?: readonly LocaleCode[]): LocaleCode {
  // A wallet may offer fewer languages (clip.config languages); the first one it offers is its fallback.
  const codes: readonly LocaleCode[] = offered?.length ? offered.filter(isLocaleCode) : LOCALE_CODES;
  const fallback = offered?.length ? (codes[0] ?? DEFAULT_LOCALE) : DEFAULT_LOCALE;
  for (const raw of requested) {
    if (!raw) continue;
    const tag = raw.replace(/_/g, "-");
    const exact = codes.find((c) => c.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const lang = tag.split("-")[0]!.toLowerCase();
    if (lang === "pt" && codes.includes("pt-BR")) return "pt-BR";
    if (lang === "zh" && codes.includes("zh-Hans")) return "zh-Hans";
    const byLang = codes.find((c) => c.split("-")[0]!.toLowerCase() === lang);
    if (byLang) return byLang;
  }
  return fallback;
}

/** The shipped locales a wallet offers (all of them when `offered` is empty or missing), in LOCALES order. */
export function offeredLocales(offered?: readonly string[]): readonly LocaleInfo[] {
  return offered?.length ? LOCALES.filter((l) => offered.includes(l.code)) : LOCALES;
}

/** The locale to use for a preference: the shipped one chosen, or the device's best match. */
export function resolveLocale(
  pref: string | undefined | null,
  deviceLanguages: readonly (string | undefined | null)[] = [],
  offered?: readonly LocaleCode[],
): LocaleCode {
  if (isLocaleCode(pref) && (!offered?.length || offered.includes(pref))) return pref;
  return negotiateLocale(deviceLanguages, offered);
}
