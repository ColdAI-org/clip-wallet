/** Notification text, Simplified Chinese (same glossary as the UI catalog). */
import type { Translation } from "@clip-wallet/i18n";
import type en from "./en.js";

const messages: Translation<typeof en> = {
  "incoming.title": "收到资金",
  "incoming.body": "你收到了 {amount} {symbol}。",
  "incoming.many": "你收到了 {count, plural, other {# 项资产}}。打开钱包查看。",
  "nft.title": "新收藏品",
  "nft.body": "{name} 已到达你的钱包。",
  "nft.many": "{count, plural, other {# 个新收藏品}}已到达你的钱包。",
  "confirmed.title": "已完成",
  "failed.title": "未成功",
  "failed.body": "{what} 未成功。打开“活动”查看详情。",
  "approval.title": "{app} 正在等你处理",
  "price.above": "{symbol} 已高于 {price}",
  "price.below": "{symbol} 已低于 {price}",
  "price.now": "{symbol} 当前价格为 {price}。",
  "test.title": "通知已开启",
  "test.body": "这就是钱包通知的样子。",
};
export default messages;
