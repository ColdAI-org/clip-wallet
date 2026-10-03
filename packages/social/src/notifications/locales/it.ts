/** Notification text (Italian). */
import type { Translation } from "@clip-wallet/i18n";
import type en from "./en.js";

const messages: Translation<typeof en> = {
  "incoming.title": "Denaro ricevuto",
  "incoming.body": "Hai ricevuto {amount} {symbol}.",
  "incoming.many": "Hai ricevuto {count, plural, one {# asset} other {# asset}}. Apri il wallet per vederli.",
  "nft.title": "Nuovo collezionabile",
  "nft.body": "{name} è arrivato nel tuo wallet.",
  "nft.many": "{count, plural, one {# nuovo collezionabile è arrivato} other {# nuovi collezionabili sono arrivati}} nel tuo wallet.",
  "confirmed.title": "Fatto",
  "failed.title": "Non è andata a buon fine",
  "failed.body": "{what}: non è andata a buon fine. Apri Attività per i dettagli.",
  "approval.title": "{app} ti sta aspettando",
  "price.above": "{symbol} è sopra {price}",
  "price.below": "{symbol} è sotto {price}",
  "price.now": "{symbol} ora è a {price}.",
  "test.title": "Le notifiche sono attive",
  "test.body": "Ecco come appare una notifica del wallet.",
};
export default messages;
