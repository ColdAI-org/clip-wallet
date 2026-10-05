/**
 * The data-use disclosure ("privacy" namespace) as its own eagerly loaded catalog, so the mobile app shows the
 * same, reviewed wording as the extension without bundling the whole UI catalog. The strings live in the
 * normal namespace files (src/i18n/<locale>/privacy.ts); this file only gathers them.
 */
import type { Catalogs } from "@clip-wallet/i18n";
import en from "./en/privacy";
import de from "./de/privacy";
import fr from "./fr/privacy";
import es from "./es/privacy";
import pt_BR from "./pt-BR/privacy";
import it from "./it/privacy";
import tr from "./tr/privacy";
import ja from "./ja/privacy";
import ko from "./ko/privacy";
import zh_Hans from "./zh-Hans/privacy";
import ar from "./ar/privacy";
import hi from "./hi/privacy";

export type PrivacyMessages = typeof en;

export const PRIVACY_CATALOGS: Catalogs<PrivacyMessages> = {
  en,
  de,
  fr,
  es,
  "pt-BR": pt_BR,
  it,
  tr,
  ja,
  ko,
  "zh-Hans": zh_Hans,
  ar,
  hi,
};

/** The disclosure's sections, in the order both apps show them. */
export const PRIVACY_SECTIONS = ["device", "network", "scam", "partners", "backup", "media", "never"] as const;
