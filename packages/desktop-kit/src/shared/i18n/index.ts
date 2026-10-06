/**
 * Desktop translations, shared by the main process (menus, native dialogs) and the browser toolbar renderer.
 * Bundled: the catalogs are small and the main process needs them synchronously.
 */
import { createTranslator, resolveLocale, type Catalogs, type LocaleCode, type LocalePref, type TFunction } from "@clip-wallet/i18n";
import { en, type DesktopMessages } from "./en";
import de from "./de";
import fr from "./fr";
import es from "./es";
import pt_BR from "./pt-BR";
import it from "./it";
import tr from "./tr";
import ja from "./ja";
import ko from "./ko";
import zh_Hans from "./zh-Hans";
import ar from "./ar";
import hi from "./hi";

export type { DesktopMessages, DesktopMessageId } from "./en";
export { en as DESKTOP_EN };

export const DESKTOP_CATALOGS: Catalogs<DesktopMessages> = {
  en,
  "de": de,
  "fr": fr,
  "es": es,
  "pt-BR": pt_BR,
  "it": it,
  "tr": tr,
  "ja": ja,
  "ko": ko,
  "zh-Hans": zh_Hans,
  "ar": ar,
  "hi": hi,
};

export function desktopT(locale: LocaleCode): TFunction<DesktopMessages> {
  const messages = locale === "en" ? en : (DESKTOP_CATALOGS[locale] as DesktopMessages | undefined);
  return createTranslator(en, messages, locale);
}

/** The locale for a Settings → Language preference and the OS's languages. */
export function desktopLocale(pref: LocalePref | undefined, systemLanguages: readonly string[], offered?: readonly LocaleCode[]): LocaleCode {
  return resolveLocale(pref, systemLanguages, offered);
}
