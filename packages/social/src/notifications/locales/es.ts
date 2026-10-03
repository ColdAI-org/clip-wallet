/** Notification text (Spanish). Ids are "<kind>.<part>". */
import type { Translation } from "@clip-wallet/i18n";
import type en from "./en.js";

const messages: Translation<typeof en> = {
  "incoming.title": "Dinero recibido",
  "incoming.body": "Recibiste {amount} {symbol}.",
  "incoming.many": "Recibiste {count, plural, one {# activo} other {# activos}}. Abre la billetera para verlos.",
  "nft.title": "Nuevo coleccionable",
  "nft.body": "{name} llegó a tu billetera.",
  "nft.many": "{count, plural, one {Llegó # coleccionable nuevo} other {Llegaron # coleccionables nuevos}} a tu billetera.",
  "confirmed.title": "Completado",
  "failed.title": "No se completó",
  "failed.body": "{what} no se completó. Abre Actividad para ver los detalles.",
  "approval.title": "{app} te está esperando",
  "price.above": "{symbol} está por encima de {price}",
  "price.below": "{symbol} está por debajo de {price}",
  "price.now": "{symbol} está ahora en {price}.",
  "test.title": "Las notificaciones están activadas",
  "test.body": "Así se ve una notificación de la billetera.",
};
export default messages;
