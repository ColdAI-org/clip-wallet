/**
 * Must-match glossary for de: every message whose English uses `en` must contain `tr` (a case-insensitive
 * regex, so inflected forms can match a stem). Mirrors the glossary comment in packages/ui/src/i18n/de/index.ts.
 * Note: `en` also matches inside a placeholder ("{account}", "{address}"), so those entries accept the
 * placeholder itself as an alternative.
 */
import type { GlossaryEntry } from "../lint.js";

const glossary: readonly GlossaryEntry[] = [
  { en: "wallet", tr: "Wallet" },
  { en: "hardware wallet", tr: "Hardware-Wallet" },
  { en: "hardware wallets", tr: "Hardware-Wallets" },
  { en: "recovery phrase", tr: "Wiederherstellungsphrase" },
  { en: "passkey", tr: "Passkey" },
  {
    en: "account",
    tr: "Kont(o|en)|\\{account\\}",
    // why: "your Apple Account" is Apple's product name, kept verbatim ("dein Apple Account").
    except: ["backup.social.appleAccount", "m.backup.social.appleAccount"],
  },
  { en: "accounts", tr: "Konten|Konto" },
  { en: "address", tr: "Adress|\\{address\\}" },
  { en: "addresses", tr: "Adressen" },
  { en: "network fee", tr: "Netzwerkgebühr" },
  { en: "fee", tr: "Gebühr" },
  { en: "collectible", tr: "Sammlerstück" },
  { en: "collectibles", tr: "Sammlerstücke" },
  {
    en: "stake",
    tr: "stak|Stake|Staking",
    // why: here "stake" is the money bet on a prediction market (Einsatz), not crypto staking.
    except: ["explore.trade.polymarket.note", "m.explore.trade.polymarket.note"],
  },
  { en: "unstake", tr: "Staking (für .+ )?beenden|aus dem Staking" },
  { en: "unreadable request", tr: "nicht lesbare.? Anfrage" },
  { en: "look-alike", tr: "verwechselbar|ähnlich aussehend" },
  { en: "scammers", tr: "Betrüger" },
  { en: "scam", tr: "Betrug" },
  { en: "approve", tr: "genehmig" },
  { en: "reject", tr: "ablehn" },
  { en: "connected apps", tr: "verbundene Apps" },
  { en: "notifications", tr: "Benachrichtigungen" },
  { en: "price alerts", tr: "Preisalarme" },
  { en: "Secure Trade", tr: "Secure Trade" },
];
export default glossary;
