import type en from "../en/collectibles";
export default {
  "m.collectibles.title": "收藏品",
  "m.collectibles.itemName": "{collection} #{tokenId}",
  "m.collectibles.tokenNumber": "#{tokenId}",
  "m.collectibles.collection": "系列",
  "m.collectibles.token": "代币",
  "m.collectibles.network": "网络",
  "m.collectibles.filter.all": "全部",
  "m.collectibles.filter.only": "仅 {network}",
  "m.collectibles.empty.title": "还没有收藏品",
  "m.collectibles.empty.body": "你在任何网络上拥有的收藏品都会显示在这里。",
  "m.collectibles.group": "{name} · {n, number}",
} satisfies Record<keyof typeof en, string>;
