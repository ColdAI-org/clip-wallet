/** Notification text (Turkish). */
import type { Translation } from "@clip-wallet/i18n";
import type en from "./en.js";

const messages: Translation<typeof en> = {
  "incoming.title": "Para alındı",
  "incoming.body": "Gelen tutar: {amount} {symbol}.",
  "incoming.many": "{count, plural, one {# varlık aldınız} other {# varlık aldınız}}. Görmek için cüzdanı açın.",
  "nft.title": "Yeni koleksiyon öğesi",
  "nft.body": "{name} cüzdanınıza ulaştı.",
  "nft.many": "{count, plural, one {# yeni koleksiyon öğesi} other {# yeni koleksiyon öğesi}} cüzdanınıza ulaştı.",
  "confirmed.title": "Tamamlandı",
  "failed.title": "Gerçekleşmedi",
  "failed.body": "{what} gerçekleşmedi. Ayrıntılar için Etkinlik'i açın.",
  "approval.title": "{app} sizi bekliyor",
  "price.above": "{symbol} fiyatı {price} üzerinde",
  "price.below": "{symbol} fiyatı {price} altında",
  "price.now": "{symbol} fiyatı şu an {price}.",
  "test.title": "Bildirimler açık",
  "test.body": "Cüzdan bildirimi böyle görünür.",
};
export default messages;
