import type en from "../en/collectibles";
export default {
  "m.collectibles.title": "Colecionáveis",
  "m.collectibles.itemName": "{collection} #{tokenId}",
  "m.collectibles.tokenNumber": "#{tokenId}",
  "m.collectibles.collection": "Coleção",
  "m.collectibles.token": "Token",
  "m.collectibles.network": "Rede",
  "m.collectibles.filter.all": "Tudo",
  "m.collectibles.filter.only": "Só {network}",
  "m.collectibles.empty.title": "Nenhum colecionável ainda",
  "m.collectibles.empty.body": "Os colecionáveis que você tem em qualquer rede aparecem aqui.",
  "m.collectibles.group": "{name} · {n, number}",
} satisfies Record<keyof typeof en, string>;
