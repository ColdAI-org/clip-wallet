import type en from "../en/collectibles";
export default {
  "m.collectibles.title": "Koleksiyon",
  "m.collectibles.itemName": "{collection} #{tokenId}",
  "m.collectibles.tokenNumber": "#{tokenId}",
  "m.collectibles.collection": "Koleksiyon",
  "m.collectibles.token": "Token",
  "m.collectibles.network": "Ağ",
  "m.collectibles.filter.all": "Tümü",
  "m.collectibles.filter.only": "Yalnızca {network}",
  "m.collectibles.empty.title": "Henüz koleksiyon öğesi yok",
  "m.collectibles.empty.body": "Herhangi bir ağda sahip olduğunuz koleksiyon öğeleri burada görünür.",
  "m.collectibles.group": "{name} · {n, number}",
} satisfies Record<keyof typeof en, string>;
