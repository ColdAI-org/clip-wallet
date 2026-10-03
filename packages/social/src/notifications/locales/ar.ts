/** Notification text (Arabic). */
import type { Translation } from "@clip-wallet/i18n";
import type en from "./en.js";

const messages: Translation<typeof en> = {
  "incoming.title": "تم استلام أموال",
  "incoming.body": "استلمت {amount} {symbol}.",
  "incoming.many": "استلمت {count, plural, zero {# أصل} one {أصلًا واحدًا} two {أصلين} few {# أصول} many {# أصلًا} other {# أصل}}. افتح المحفظة لرؤيتها.",
  "nft.title": "مقتنى جديد",
  "nft.body": "وصل {name} إلى محفظتك.",
  "nft.many": "{count, plural, zero {لم تصل مقتنيات جديدة} one {وصل مقتنى جديد واحد} two {وصل مقتنيان جديدان} few {وصلت # مقتنيات جديدة} many {وصل # مقتنى جديدًا} other {وصل # مقتنى جديد}} إلى محفظتك.",
  "confirmed.title": "تم",
  "failed.title": "لم تكتمل العملية",
  "failed.body": "لم تكتمل العملية: {what}. افتح «النشاط» للاطلاع على التفاصيل.",
  "approval.title": "{app} بانتظارك",
  "price.above": "{symbol} أعلى من {price}",
  "price.below": "{symbol} أدنى من {price}",
  "price.now": "سعر {symbol} الآن {price}.",
  "test.title": "الإشعارات مفعّلة",
  "test.body": "هكذا يبدو إشعار المحفظة.",
};
export default messages;
