import type en from "../en/collectibles";
export default {
  "m.collectibles.title": "Collection",
  "m.collectibles.itemName": "{collection} #{tokenId}",
  "m.collectibles.tokenNumber": "#{tokenId}",
  "m.collectibles.collection": "Collection",
  "m.collectibles.token": "Jeton",
  "m.collectibles.network": "Réseau",
  "m.collectibles.filter.all": "Tout",
  "m.collectibles.filter.only": "Uniquement {network}",
  "m.collectibles.empty.title": "Aucun objet de collection pour l'instant",
  "m.collectibles.empty.body": "Les objets de collection que vous possédez sur n'importe quel réseau apparaissent ici.",
  "m.collectibles.group": "{name} · {n, number}",
} satisfies Record<keyof typeof en, string>;
