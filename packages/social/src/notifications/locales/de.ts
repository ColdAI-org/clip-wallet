/** Notification text (German). */
import type { Translation } from "@clip-wallet/i18n";
import type en from "./en.js";

const messages: Translation<typeof en> = {
  "incoming.title": "Geld erhalten",
  "incoming.body": "Du hast {amount} {symbol} erhalten.",
  "incoming.many": "Du hast {count, plural, one {# Asset} other {# Assets}} erhalten. Öffne das Wallet, um sie zu sehen.",
  "nft.title": "Neues Sammlerstück",
  "nft.body": "{name} ist in deinem Wallet angekommen.",
  "nft.many": "{count, plural, one {# neues Sammlerstück ist} other {# neue Sammlerstücke sind}} in deinem Wallet angekommen.",
  "confirmed.title": "Erledigt",
  "failed.title": "Nicht durchgegangen",
  "failed.body": "{what} ist nicht durchgegangen. Details findest du unter Aktivität.",
  "approval.title": "{app} wartet auf dich",
  "price.above": "{symbol} liegt über {price}",
  "price.below": "{symbol} liegt unter {price}",
  "price.now": "{symbol} steht jetzt bei {price}.",
  "test.title": "Benachrichtigungen sind an",
  "test.body": "So sieht eine Benachrichtigung vom Wallet aus.",
};
export default messages;
