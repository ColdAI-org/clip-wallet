import type en from "../en/collectibles";
export default {
  "m.collectibles.title": "المقتنيات",
  "m.collectibles.itemName": "\u2068{collection}\u2069 #\u2068{tokenId}\u2069",
  "m.collectibles.tokenNumber": "#\u2068{tokenId}\u2069",
  "m.collectibles.collection": "المجموعة",
  "m.collectibles.token": "الرمز",
  "m.collectibles.network": "الشبكة",
  "m.collectibles.filter.all": "الكل",
  "m.collectibles.filter.only": "\u2068{network}\u2069 فقط",
  "m.collectibles.empty.title": "لا مقتنيات بعد",
  "m.collectibles.empty.body": "تظهر هنا المقتنيات التي تملكها على أي شبكة.",
  "m.collectibles.group": "\u2068{name}\u2069 · \u2068{n, number}\u2069",
} satisfies Record<keyof typeof en, string>;
