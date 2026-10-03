/** Notification text (French). Same terms as the UI glossary in packages/ui/src/i18n/fr/index.ts. */
import type { Translation } from "@clip-wallet/i18n";
import type en from "./en.js";

const messages: Translation<typeof en> = {
  "incoming.title": "Argent reçu",
  "incoming.body": "Vous avez reçu {amount} {symbol}.",
  "incoming.many": "Vous avez reçu {count, plural, one {# actif} other {# actifs}}. Ouvrez le portefeuille pour les voir.",
  "nft.title": "Nouvel objet de collection",
  "nft.body": "{name} est arrivé dans votre portefeuille.",
  "nft.many": "{count, plural, one {# nouvel objet de collection est arrivé} other {# nouveaux objets de collection sont arrivés}} dans votre portefeuille.",
  "confirmed.title": "Terminé",
  "failed.title": "Échec",
  "failed.body": "{what} n'a pas abouti. Ouvrez Activité pour voir les détails.",
  "approval.title": "{app} vous attend",
  "price.above": "{symbol} est au-dessus de {price}",
  "price.below": "{symbol} est en dessous de {price}",
  "price.now": "{symbol} est maintenant à {price}.",
  "test.title": "Les notifications sont activées",
  "test.body": "Voici à quoi ressemble une notification du portefeuille.",
};
export default messages;
