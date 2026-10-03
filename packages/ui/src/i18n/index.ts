/**
 * The UI's translations. `useUiT()` gives `t` for the current locale (set by ClipProvider from prefs.locale,
 * or the browser's languages when it is "system").
 *
 * Adding a string: put it in the namespace file under en/ (ids are "<namespace>.<name>"), use it via t(), and
 * add the translation to every locale folder (typecheck fails until each has it).
 * Never translate: the product name (config.name, passed as {name}), asset symbols, addresses, app names.
 */
import { useT } from "@clip-wallet/i18n/react";
import type { Catalogs } from "@clip-wallet/i18n";
import { en, type UiMessages } from "./en";

export type { UiMessages, UiMessageId } from "./en";

/** English is bundled; other languages load when chosen (each is its own chunk in the extension build). */
export const UI_CATALOGS: Catalogs<UiMessages> = {
  en,
  "de": () => import("./de"),
  "fr": () => import("./fr"),
  "es": () => import("./es"),
  "pt-BR": () => import("./pt-BR"),
  "it": () => import("./it"),
  "tr": () => import("./tr"),
  "ja": () => import("./ja"),
  "ko": () => import("./ko"),
  "zh-Hans": () => import("./zh-Hans"),
  "ar": () => import("./ar"),
  "hi": () => import("./hi"),
};

/** Terms that stay verbatim in every language when English uses them. */
export const PROTECTED_TERMS = ["Clip Wallet", "WalletConnect", "Ledger", "Keystone", "Face ID", "Touch ID", "USDC", "HBAR", "ETH", "SOL"] as const;

export function useUiT() {
  return useT(UI_CATALOGS);
}

export { useFormat, useLocale, rich } from "@clip-wallet/i18n/react";
