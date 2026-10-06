/**
 * Mobile translations. `useMobileT()` gives `t` for the current locale (WalletProvider sets it from
 * prefs.locale, or the phone's languages when it is "system").
 *
 * Adding a string: put it in the namespace file under en/ (ids are "m.<namespace>.<name>"), use it via t(),
 * and add the translation to every locale folder (typecheck fails until each has it).
 * Never translate: the product name (APP.config.name, passed as {name}), asset symbols, addresses, app names.
 */
import { useT } from "@clip-wallet/i18n/react";
import type { Catalogs } from "@clip-wallet/i18n";
import { en, type MobileMessages } from "./en";
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

export type { MobileMessages, MobileMessageId } from "./en";

/** Bundled: Metro inlines every language into the one JS bundle anyway (no async chunks in release builds). */
export const MOBILE_CATALOGS: Catalogs<MobileMessages> = {
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

export function useMobileT() {
  return useT(MOBILE_CATALOGS);
}

export { useFormat, useLocale, rich } from "@clip-wallet/i18n/react";
