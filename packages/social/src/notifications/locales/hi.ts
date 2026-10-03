/** Notification text, Hindi. Same glossary as the Hindi UI catalog. */
import type { Translation } from "@clip-wallet/i18n";
import type en from "./en.js";

const messages: Translation<typeof en> = {
  "incoming.title": "पैसे प्राप्त हुए",
  "incoming.body": "आपको {amount} {symbol} प्राप्त हुए।",
  "incoming.many": "आपको {count, plural, one {# एसेट} other {# एसेट}} प्राप्त हुए। उन्हें देखने के लिए वॉलेट खोलें।",
  "nft.title": "नया कलेक्टिबल",
  "nft.body": "{name} आपके वॉलेट में आ गया।",
  "nft.many": "{count, plural, one {# नया कलेक्टिबल आपके वॉलेट में आया} other {# नए कलेक्टिबल आपके वॉलेट में आए}}।",
  "confirmed.title": "हो गया",
  "failed.title": "पूरा नहीं हुआ",
  "failed.body": "{what} पूरा नहीं हुआ। जानकारी के लिए गतिविधि खोलें।",
  "approval.title": "{app} आपका इंतज़ार कर रहा है",
  "price.above": "{symbol} {price} से ऊपर है",
  "price.below": "{symbol} {price} से नीचे है",
  "price.now": "{symbol} अभी {price} है।",
  "test.title": "नोटिफ़िकेशन चालू हैं",
  "test.body": "वॉलेट का नोटिफ़िकेशन ऐसा दिखता है।",
};
export default messages;
