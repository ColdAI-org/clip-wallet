/**
 * Must-match glossary for zh-Hans: every message whose English uses `en` must contain `tr` (a case-insensitive
 * regex, so inflected forms can match a stem). Mirrors the glossary comment in packages/ui/src/i18n/zh-Hans/index.ts.
 */
import type { GlossaryEntry } from "../lint.js";

const glossary: readonly GlossaryEntry[] = [
  { en: "wallet", tr: "钱包" },
  { en: "recovery phrase", tr: "助记词" },
  { en: "passkey", tr: "通行密钥" },
  { en: "accounts", tr: "账户" },
  { en: "addresses", tr: "地址" },
  { en: "network fee", tr: "网络手续费" },
  { en: "fee", tr: "手续费" },
  { en: "hardware wallet", tr: "硬件钱包" },
  { en: "collectible", tr: "收藏品" },
  { en: "collectibles", tr: "收藏品" },
  { en: "unstake", tr: "解除质押" },
  // why: Polymarket "your whole stake" is the money you bet (下注金额), not staking.
  { en: "stake", tr: "质押", except: ["explore.trade.polymarket.note", "m.explore.trade.polymarket.note"] },
  { en: "publish", tr: "公开" },
  { en: "unreadable request", tr: "无法读取的请求" },
  { en: "look-alike address", tr: "相似地址" },
  { en: "scammers", tr: "诈骗者" },
  { en: "suspicious tokens", tr: "可疑代币" },
  { en: "approve", tr: "批准" },
  { en: "reject", tr: "拒绝" },
  { en: "connected apps", tr: "已连接的应用" },
  { en: "notifications", tr: "通知" },
  { en: "price alerts", tr: "价格提醒" },
  { en: "Secure Trade", tr: "Secure Trade" },
  { en: "Ethereum", tr: "Ethereum" },
];
export default glossary;
