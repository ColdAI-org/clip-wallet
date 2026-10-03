import type en from "../en/collectibles";
export default {
  "m.collectibles.title": "コレクティブル",
  "m.collectibles.itemName": "{collection} #{tokenId}",
  "m.collectibles.tokenNumber": "#{tokenId}",
  "m.collectibles.collection": "コレクション",
  "m.collectibles.token": "トークン",
  "m.collectibles.network": "ネットワーク",
  "m.collectibles.filter.all": "すべて",
  "m.collectibles.filter.only": "{network}のみ",
  "m.collectibles.empty.title": "コレクティブルはまだありません",
  "m.collectibles.empty.body": "どのネットワークでも、保有しているコレクティブルがここに表示されます。",
  "m.collectibles.group": "{name} · {n, number}",
} satisfies Record<keyof typeof en, string>;
