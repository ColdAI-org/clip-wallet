import type en from "../en/collectibles";
export default {
  "m.collectibles.title": "수집품",
  "m.collectibles.itemName": "{collection} #{tokenId}",
  "m.collectibles.tokenNumber": "#{tokenId}",
  "m.collectibles.collection": "컬렉션",
  "m.collectibles.token": "토큰",
  "m.collectibles.network": "네트워크",
  "m.collectibles.filter.all": "전체",
  "m.collectibles.filter.only": "{network}만",
  "m.collectibles.empty.title": "아직 수집품이 없어요",
  "m.collectibles.empty.body": "어느 네트워크에서든 보유한 수집품이 여기에 표시돼요.",
  "m.collectibles.group": "{name} · {n, number}",
} satisfies Record<keyof typeof en, string>;
