/**
 * Must-match glossary for ko: every message whose English uses `en` must contain `tr` (a case-insensitive
 * regex, so inflected forms can match a stem). Mirrors the glossary comment in packages/ui/src/i18n/ko/index.ts.
 */
import type { GlossaryEntry } from "../lint.js";

const glossary: readonly GlossaryEntry[] = [
  // “Connect Software Wallet” is the Keystone's own menu label, kept verbatim in English.
  { en: "wallet", tr: "지갑", except: ["hardware.keystone.step1"] },
  { en: "recovery phrase", tr: "복구 문구" },
  { en: "passkey", tr: "패스키" },
  // These only contain the {account} placeholder (an account label, or the word 계정 itself), not the word.
  {
    en: "account",
    tr: "계정",
    except: [
      "accounts.nameFor",
      "accounts.renameAccount",
      "accounts.useAccount",
      "approval.connect.lede",
      "m.accounts.nameFor",
      "m.accounts.renameAccount",
      "m.accounts.useAccount",
      "m.approval.connect.lede",
    ],
  },
  { en: "accounts", tr: "계정" },
  // Only the {address} placeholder, not the word.
  { en: "address", tr: "주소", except: ["social.pick.saveRecipient"] },
  { en: "addresses", tr: "주소" },
  { en: "network fee", tr: "네트워크 수수료" },
  { en: "fee", tr: "수수료" },
  { en: "hardware wallet", tr: "하드웨어 지갑" },
  { en: "collectibles", tr: "수집품" },
  // Polymarket: "your whole stake" is the money you bet (건 금액), not staking.
  { en: "stake", tr: "스테이킹", except: ["explore.trade.polymarket.note", "m.explore.trade.polymarket.note"] },
  { en: "unstake", tr: "스테이킹 해제" },
  { en: "unreadable request", tr: "읽을 수 없는 요청" },
  { en: "look-alike", tr: "비슷하게 생긴" },
  { en: "scammers", tr: "사기범" },
  { en: "approve", tr: "승인" },
  { en: "reject", tr: "거절" },
  { en: "connected apps", tr: "연결된 앱" },
  { en: "notifications", tr: "알림" },
  { en: "price alerts", tr: "가격 알림" },
  { en: "Secure Trade", tr: "Secure Trade" },
  { en: "suspicious tokens", tr: "의심스러운 토큰" },
  // Secure Trade's hint: "swap" here means trading with a person (교환), not the Swap feature.
  { en: "swap", tr: "스왑", except: ["m.explore.menu.tradeHint"] },
];
export default glossary;
