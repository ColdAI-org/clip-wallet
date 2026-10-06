import type en from "../en/collectibles";
export default {
  "m.collectibles.title": "Sammlerstücke",
  "m.collectibles.itemName": "{collection} #{tokenId}",
  "m.collectibles.tokenNumber": "#{tokenId}",
  "m.collectibles.collection": "Sammlung",
  "m.collectibles.token": "Token",
  "m.collectibles.network": "Netzwerk",
  "m.collectibles.filter.all": "Alles",
  "m.collectibles.filter.only": "Nur {network}",
  "m.collectibles.empty.title": "Noch keine Sammlerstücke",
  "m.collectibles.empty.body": "Sammlerstücke, die du in einem beliebigen Netzwerk besitzt, erscheinen hier.",
  "m.collectibles.group": "{name} · {n, number}",
} satisfies Record<keyof typeof en, string>;
