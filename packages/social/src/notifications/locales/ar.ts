/** Notification text (Arabic). */
import type { Translation } from "@clip-wallet/i18n";
import type en from "./en.js";

const messages: Translation<typeof en> = {
  "incoming.title": "تم استلام أموال",
  "incoming.body": "استلمت \u2068{amount}\u2069 \u2068{symbol}\u2069.",
  "incoming.many": "استلمت {count, plural, zero {# أصل} one {أصلًا واحدًا} two {أصلين} few {# أصول} many {# أصلًا} other {# أصل}}. افتح المحفظة لرؤيتها.",
  "nft.title": "مقتنى جديد",
  "nft.body": "وصل \u2068{name}\u2069 إلى محفظتك.",
  "nft.many": "{count, plural, zero {لم تصل مقتنيات جديدة} one {وصل مقتنى جديد واحد} two {وصل مقتنيان جديدان} few {وصلت # مقتنيات جديدة} many {وصل # مقتنى جديدًا} other {وصل # مقتنى جديد}} إلى محفظتك.",
  "confirmed.title": "تم",
  "failed.title": "لم تكتمل العملية",
  "failed.body": "لم تكتمل العملية: \u2068{what}\u2069. افتح «النشاط» للاطلاع على التفاصيل.",
  "approval.title": "\u2068{app}\u2069 بانتظارك",
  "price.above": "\u2068{symbol}\u2069 أعلى من \u2068{price}\u2069",
  "price.below": "\u2068{symbol}\u2069 أدنى من \u2068{price}\u2069",
  "price.now": "سعر \u2068{symbol}\u2069 الآن \u2068{price}\u2069.",
  "test.title": "الإشعارات مفعّلة",
  "test.body": "هكذا يبدو إشعار المحفظة.",
};
export default messages;
