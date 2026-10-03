/**
 * Notification text in every shipped language. Bundled (it is small) because the background shows notices
 * without a page open.
 */
import { createTranslator, type LocaleCode, type TFunction, type Translation } from "@clip-wallet/i18n";
import en from "./locales/en.js";
import de from "./locales/de.js";
import fr from "./locales/fr.js";
import es from "./locales/es.js";
import pt_BR from "./locales/pt-BR.js";
import it from "./locales/it.js";
import tr from "./locales/tr.js";
import ja from "./locales/ja.js";
import ko from "./locales/ko.js";
import zh_Hans from "./locales/zh-Hans.js";
import ar from "./locales/ar.js";
import hi from "./locales/hi.js";

export type NotificationMessages = typeof en;

export const NOTIFICATION_CATALOGS: Partial<Record<LocaleCode, Translation<NotificationMessages>>> = {
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

export function notificationText(locale: LocaleCode): TFunction<NotificationMessages> {
  return createTranslator(en, NOTIFICATION_CATALOGS[locale], locale);
}
