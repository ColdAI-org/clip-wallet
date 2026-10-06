import type en from "../en/collectibles";
export default {
  "m.collectibles.title": "Coleccionables",
  "m.collectibles.itemName": "{collection} #{tokenId}",
  "m.collectibles.tokenNumber": "#{tokenId}",
  "m.collectibles.collection": "Colección",
  "m.collectibles.token": "Token",
  "m.collectibles.network": "Red",
  "m.collectibles.filter.all": "Todo",
  "m.collectibles.filter.only": "Solo {network}",
  "m.collectibles.empty.title": "Aún no hay coleccionables",
  "m.collectibles.empty.body": "Los coleccionables que tengas en cualquier red aparecen aquí.",
  "m.collectibles.group": "{name} · {n, number}",
} satisfies Record<keyof typeof en, string>;
