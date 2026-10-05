/**
 * Must-match glossary for fr: every message whose English uses `en` must contain `tr` (a case-insensitive
 * regex, so inflected forms can match a stem). Mirrors the glossary comment in packages/ui/src/i18n/fr/index.ts.
 */
import type { GlossaryEntry } from "../lint.js";

const glossary: readonly GlossaryEntry[] = [
  // Keystone's own menu label “Connect Software Wallet” must stay in English as shown on the device.
  { en: "wallet", tr: "portefeuille", except: ["hardware.keystone.step1"] },
  { en: "hardware wallet", tr: "portefeuille matériel" },
  { en: "recovery phrase", tr: "phrase de récupération" },
  { en: "passkey", tr: "clé d.accès" },
  // The {account} placeholder also matches "account" on word boundaries; it is passed through untranslated.
  { en: "account", tr: "compte|\\{account\\}" },
  { en: "accounts", tr: "comptes?" },
  // Same for the {address} placeholder.
  { en: "address", tr: "adresse|\\{address\\}" },
  { en: "network fee", tr: "frais de réseau" },
  { en: "fee", tr: "frais" },
  { en: "collectible", tr: "objets? de collection" },
  // Plural also covers the tab / screen title « Collection ».
  { en: "collectibles", tr: "collection" },
  // Polymarket's "your whole stake" is a bet (mise), not staking.
  { en: "stake", tr: "stak", except: ["explore.trade.polymarket.note", "m.explore.trade.polymarket.note"] },
  { en: "unstake", tr: "du staking" },
  { en: "unreadable request", tr: "demande illisible" },
  { en: "look-alike", tr: "sosie" },
  { en: "scammers", tr: "arnaqueurs" },
  { en: "approve", tr: "approuv|approbation" },
  { en: "reject", tr: "refuser" },
  { en: "connected apps", tr: "applications connectées" },
  { en: "notification", tr: "notification" },
  { en: "notifications", tr: "notifications" },
  { en: "price alert", tr: "alertes? de prix" },
  { en: "Secure Trade", tr: "Secure Trade" },
  // The @{handle} placeholder also matches "handle".
  { en: "handle", tr: "identifiant|@\\{handle\\}" },
];
export default glossary;
