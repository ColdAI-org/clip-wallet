/** Notification text (Japanese). Ids are "<kind>.<part>". */
import type { Translation } from "@clip-wallet/i18n";
import type en from "./en.js";

const messages: Translation<typeof en> = {
  "incoming.title": "入金がありました",
  "incoming.body": "{amount} {symbol}を受け取りました。",
  "incoming.many": "{count, plural, other {#件の資産}}を受け取りました。ウォレットを開いて確認してください。",
  "nft.title": "新しいコレクティブル",
  "nft.body": "{name}がウォレットに届きました。",
  "nft.many": "{count, plural, other {#件の新しいコレクティブル}}がウォレットに届きました。",
  "confirmed.title": "完了しました",
  "failed.title": "完了しませんでした",
  "failed.body": "{what}は完了しませんでした。詳しくはアクティビティを開いてください。",
  "approval.title": "{app}があなたの対応を待っています",
  "price.above": "{symbol}が{price}を上回りました",
  "price.below": "{symbol}が{price}を下回りました",
  "price.now": "{symbol}は現在{price}です。",
  "test.title": "通知がオンになりました",
  "test.body": "ウォレットの通知はこのように表示されます。",
};
export default messages;
