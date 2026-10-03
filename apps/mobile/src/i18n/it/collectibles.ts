import type en from "../en/collectibles";
export default {
  "m.collectibles.title": "Collezionabili",
  "m.collectibles.itemName": "{collection} #{tokenId}",
  "m.collectibles.tokenNumber": "#{tokenId}",
  "m.collectibles.collection": "Collezione",
  "m.collectibles.token": "Token",
  "m.collectibles.network": "Rete",
  "m.collectibles.filter.all": "Tutto",
  "m.collectibles.filter.only": "Solo {network}",
  "m.collectibles.empty.title": "Ancora nessun collezionabile",
  "m.collectibles.empty.body": "I collezionabili che possiedi su qualsiasi rete compaiono qui.",
  "m.collectibles.group": "{name} · {n, number}",
} satisfies Record<keyof typeof en, string>;
