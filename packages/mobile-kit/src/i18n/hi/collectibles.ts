import type en from "../en/collectibles";
export default {
  "m.collectibles.title": "कलेक्टिबल",
  "m.collectibles.itemName": "{collection} #{tokenId}",
  "m.collectibles.tokenNumber": "#{tokenId}",
  "m.collectibles.collection": "कलेक्शन",
  "m.collectibles.token": "टोकन",
  "m.collectibles.network": "नेटवर्क",
  "m.collectibles.filter.all": "सब कुछ",
  "m.collectibles.filter.only": "सिर्फ़ {network}",
  "m.collectibles.empty.title": "अभी कोई कलेक्टिबल नहीं",
  "m.collectibles.empty.body": "किसी भी नेटवर्क पर आपके कलेक्टिबल यहां दिखते हैं।",
  "m.collectibles.group": "{name} · {n, number}",
} satisfies Record<keyof typeof en, string>;
