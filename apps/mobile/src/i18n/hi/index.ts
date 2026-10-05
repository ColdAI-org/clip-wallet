/**
 * Hindi mobile catalog. Glossary (same as the Hindi UI catalog in packages/ui; keep consistent):
 *   wallet → वॉलेट, recovery phrase → रिकवरी फ़्रेज़, password → पासवर्ड, passkey → पासकी,
 *   account → अकाउंट, address → एड्रेस, network → नेटवर्क, network fee → नेटवर्क शुल्क, fee → शुल्क,
 *   asset → एसेट, token → टोकन, coin → कॉइन, collectible → कलेक्टिबल, collection → कलेक्शन,
 *   balance → बैलेंस, amount → राशि, price → कीमत, price alert → प्राइस अलर्ट,
 *   send → भेजें, receive → प्राप्त करें, buy → खरीदें, swap → स्वैप (करें), stake → स्टेक (करें),
 *   unstake → अनस्टेक करें, rewards → रिवॉर्ड, liquidity → लिक्विडिटी, trade → ट्रेड,
 *   approve → मंज़ूर करें, approval → मंज़ूरी, reject → अस्वीकार करें, accept → स्वीकार करें,
 *   sign → साइन करें, signature → सिग्नेचर, request → रिक्वेस्ट, transaction → ट्रांज़ैक्शन,
 *   backup → बैकअप, back up → बैकअप लें, restore → रिस्टोर करें, lock/unlock → लॉक/अनलॉक करें,
 *   hardware wallet → हार्डवेयर वॉलेट, keys → कीज़, device → डिवाइस, connect → कनेक्ट करें,
 *   connected apps → कनेक्टेड ऐप्स, contact → संपर्क, handle → हैंडल (Clip हैंडल),
 *   notification → नोटिफ़िकेशन, activity → गतिविधि, settings → सेटिंग्स, explore → एक्सप्लोर,
 *   discover → डिस्कवर, bridged → ब्रिज किया गया, look-alike address → मिलता-जुलता एड्रेस,
 *   scammer → धोखेबाज़, suspicious → संदिग्ध, publish → पब्लिश करें, Advanced mode → एडवांस्ड मोड,
 *   unreadable request → न पढ़ी जा सकने वाली रिक्वेस्ट, expire → समय-सीमा खत्म होना, verified → वेरिफ़ाइड.
 */
import type { Translation } from "@clip-wallet/i18n";
import type { MobileMessages } from "../en";
import common from "./common";
import onboarding from "./onboarding";
import home from "./home";
import collectibles from "./collectibles";
import activity from "./activity";
import receive from "./receive";
import scan from "./scan";
import browser from "./browser";
import kit from "./kit";
import app from "./app";
import send from "./send";
import approval from "./approval";
import settings from "./settings";
import explore from "./explore";
import social from "./social";
import accounts from "./accounts";
import backup from "./backup";
import buy from "./buy";
import hardware from "./hardware";
import stake from "./stake";
import swap from "./swap";
import trade from "./trade";
import security from "./security";
import link from "./link";
import plugins from "./plugins";
import settle from "./settle";

const messages: Translation<MobileMessages> = {
  ...common,
  ...onboarding,
  ...home,
  ...collectibles,
  ...activity,
  ...receive,
  ...scan,
  ...browser,
  ...kit,
  ...app,
  ...send,
  ...approval,
  ...settings,
  ...explore,
  ...social,
  ...accounts,
  ...backup,
  ...buy,
  ...hardware,
  ...stake,
  ...swap,
  ...trade,
  ...security,
  ...link,
  ...plugins,
  ...settle,
};
export default messages;
