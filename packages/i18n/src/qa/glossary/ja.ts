/**
 * Must-match glossary for ja: every message whose English uses `en` must contain `tr` (a case-insensitive
 * regex, so inflected forms can match a stem). Mirrors the glossary comment in packages/ui/src/i18n/ja/index.ts.
 */
import type { GlossaryEntry } from "../lint.js";

const glossary: readonly GlossaryEntry[] = [
  // "Connect Software Wallet" is Keystone's own on-device menu label, kept verbatim in English.
  { en: "wallet", tr: "ウォレット", except: ["hardware.keystone.step1"] },
  { en: "recovery phrase", tr: "リカバリーフレーズ" },
  { en: "password", tr: "パスワード" },
  { en: "passkey", tr: "パスキー" },
  { en: "passkeys", tr: "パスキー" },
  // The English matches inside the {account}/{address}/{handle} placeholders too, which stay as variables.
  { en: "account", tr: "アカウント|\\{account\\}" },
  { en: "accounts", tr: "アカウント" },
  { en: "address", tr: "アドレス|\\{address\\}" },
  { en: "addresses", tr: "アドレス" },
  { en: "fee", tr: "手数料" },
  { en: "network fee", tr: "ネットワーク手数料" },
  { en: "hardware wallet", tr: "ハードウェアウォレット" },
  { en: "hardware wallets", tr: "ハードウェアウォレット" },
  { en: "collectible", tr: "コレクティブル" },
  { en: "collectibles", tr: "コレクティブル" },
  // Polymarket's "your whole stake" is the amount bet, not staking.
  { en: "stake", tr: "ステーキング", except: ["explore.trade.polymarket.note", "m.explore.trade.polymarket.note"] },
  { en: "unstake", tr: "ステーキング(を|の)?(すべて)?解除" },
  { en: "unreadable request", tr: "読み取れないリクエスト" },
  { en: "look-alike", tr: "よく似た" },
  { en: "scammers", tr: "詐欺師" },
  { en: "suspicious", tr: "不審な" },
  { en: "approve", tr: "承認" },
  { en: "reject", tr: "拒否" },
  { en: "connected apps", tr: "接続中のアプリ" },
  { en: "notifications", tr: "通知" },
  { en: "notification", tr: "通知" },
  { en: "price alerts", tr: "価格アラート" },
  { en: "Secure Trade", tr: "Secure Trade" },
  { en: "handle", tr: "ハンドル|\\{handle\\}" },
  { en: "contacts", tr: "連絡先" },
];
export default glossary;
