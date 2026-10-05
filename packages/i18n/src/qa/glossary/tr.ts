/**
 * Must-match glossary for tr: every message whose English uses `en` must contain `tr` (a case-insensitive
 * regex, so inflected forms can match a stem). Mirrors the glossary comment in packages/ui/src/i18n/tr/index.ts.
 * Note: JS case-insensitive matching does not fold "İ"↔"i", so stems below avoid a leading i/İ.
 */
import type { GlossaryEntry } from "../lint.js";

const glossary: readonly GlossaryEntry[] = [
  // Keystone's own menu label "Connect Software Wallet" stays verbatim in English.
  { en: "wallet", tr: "[cç]üzdan", except: ["hardware.keystone.step1"] },
  { en: "recovery phrase", tr: "kurtarma ifade" },
  { en: "passkey", tr: "geçiş anahtar" },
  { en: "passkeys", tr: "geçiş anahtar" },
  // {account} is the interpolated account label/word, so it counts.
  { en: "account", tr: "hesa[pb]|\\{account\\}" },
  { en: "accounts", tr: "hesa[pb]" },
  { en: "address", tr: "adres|\\{address\\}" },
  { en: "addresses", tr: "adres" },
  { en: "network fee", tr: "ağ ücret" },
  { en: "fee", tr: "ücret" },
  { en: "hardware wallet", tr: "donanım cüzdan" },
  { en: "hardware wallets", tr: "donanım cüzdan" },
  { en: "collectible", tr: "koleksiyon" },
  { en: "collectibles", tr: "koleksiyon" },
  // "your whole stake" in the Polymarket note is a betting stake, not staking.
  { en: "stake", tr: "stake", except: ["explore.trade.polymarket.note", "m.explore.trade.polymarket.note"] },
  { en: "unstake", tr: "stake'ten çıkar" },
  { en: "unreadable request", tr: "okunamayan iste[kğ]" },
  { en: "look-alike", tr: "benzer görünen" },
  { en: "scammers", tr: "dolandırıcı" },
  { en: "approve", tr: "onay" },
  { en: "reject", tr: "reddet" },
  { en: "connected apps", tr: "bağlı uygulama" },
  { en: "notification", tr: "bildirim" },
  { en: "notifications", tr: "bildirim" },
  { en: "price alerts", tr: "fiyat uyarı" },
  { en: "Secure Trade", tr: "Secure Trade" },
  { en: "handle", tr: "kullanıcı ?ad|@\\{handle\\}" },
];
export default glossary;
