/**
 * Must-match glossary for it: every message whose English uses `en` must contain `tr` (a case-insensitive
 * regex, so inflected forms can match a stem). Mirrors the glossary comment in packages/ui/src/i18n/it/index.ts.
 */
import type { GlossaryEntry } from "../lint.js";

const glossary: readonly GlossaryEntry[] = [
  { en: "wallet", tr: "wallet" },
  { en: "recovery phrase", tr: "frase di recupero" },
  { en: "passkey", tr: "passkey" },
  { en: "passkeys", tr: "passkey" },
  { en: "account", tr: "account" },
  { en: "accounts", tr: "account" },
  {
    en: "address",
    tr: "indirizz",
    // "address" only inside the {address} placeholder, or "address book" (→ "rubrica").
    except: ["social.pick.saveRecipient", "social.recipient.saved", "social.recipient.this", "social.err.full", "m.social.recipient.saved", "m.social.recipient.this", "m.social.err.full"],
  },
  { en: "addresses", tr: "indirizz" },
  { en: "network fee", tr: "commissione di rete" },
  { en: "fee", tr: "commission" },
  { en: "hardware wallet", tr: "hardware wallet" },
  { en: "hardware wallets", tr: "hardware wallet" },
  { en: "collectible", tr: "collezionabil" },
  { en: "collectibles", tr: "collezionabil" },
  {
    en: "stake",
    tr: "staking",
    // "your whole stake" = the money bet on a prediction market (→ "puntata").
    except: ["explore.trade.polymarket.note", "m.explore.trade.polymarket.note"],
  },
  { en: "unstake", tr: "dallo staking" },
  { en: "unreadable request", tr: "richiest[ae] illeggibil" },
  { en: "look-alike", tr: "somiglian" },
  { en: "scammers", tr: "truffatori" },
  { en: "scam", tr: "truff" },
  { en: "suspicious", tr: "sospett" },
  { en: "approve", tr: "approv" },
  { en: "reject", tr: "rifiut" },
  { en: "connected apps", tr: "app collegate" },
  { en: "notifications", tr: "notific" },
  { en: "price alert", tr: "avvis[oi] di prezzo" },
  { en: "price alerts", tr: "avvis[oi] di prezzo" },
  { en: "Secure Trade", tr: "Secure Trade" },
];
export default glossary;
