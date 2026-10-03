import type en from "../en/collectibles";
export default {
  "m.collectibles.title": "المقتنيات",
  "m.collectibles.itemName": "{collection} #{tokenId}",
  "m.collectibles.tokenNumber": "#{tokenId}",
  "m.collectibles.collection": "المجموعة",
  "m.collectibles.token": "الرمز",
  "m.collectibles.network": "الشبكة",
  "m.collectibles.filter.all": "الكل",
  "m.collectibles.filter.only": "{network} فقط",
  "m.collectibles.empty.title": "لا مقتنيات بعد",
  "m.collectibles.empty.body": "تظهر هنا المقتنيات التي تملكها على أي شبكة.",
  "m.collectibles.group": "{name} · {n, number}",
} satisfies Record<keyof typeof en, string>;
