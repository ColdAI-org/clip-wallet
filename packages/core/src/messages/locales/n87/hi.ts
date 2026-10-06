import type N87 from "../../en/n87.js";

/** Hindi: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../hi.ts and its glossary. */
const messages: { readonly [K in keyof typeof N87]: string } = {
  // ---- chains-cosmos (cosmos, provenance, thorchain, initia)
  // ---- end chains-cosmos
  // ---- chains-tron (tron)
  // ---- end chains-tron
  // ---- chains-xrpl (xrpl)
  // ---- end chains-xrpl
  // ---- chains-antelope (antelope)
  // ---- end chains-antelope
  // ---- chains-multiversx (multiversx)
  // ---- end chains-multiversx
  // ---- chains-icp (icp)
  // ---- end chains-icp
  // ---- chains-stacks (stacks)
  // ---- end chains-stacks
  // ---- chains-fuel (fuel)
  "bg.fuel.changeToOther": "इसके बाद आपके {symbol} में जो भी बचेगा, वह आपको वापस नहीं, {to} को जाएगा।",
  "bg.fuel.leftoverLost": "{amount} यह ट्रांज़ैक्शन कहीं नहीं भेजता, इसलिए यह खो जाएगा।",
  "bg.fuel.coinsSpent": "इस ट्रांज़ैक्शन के कुछ कॉइन पहले ही खर्च हो चुके हैं। ऐप से फिर से कोशिश करने को कहें।",
  "bg.fuel.feeRose": "इसे तैयार करने के बाद नेटवर्क शुल्क बढ़ गया है। कुछ भी नहीं भेजा गया। फिर से कोशिश करें।",
  "bg.fuel.failedOnChain": "यह ट्रांज़ैक्शन Fuel नेटवर्क पर विफल हो गया। सिर्फ़ नेटवर्क शुल्क खर्च हुआ।",
  "bg.fuel.tooManyCoins": "इसके लिए एक साथ बहुत सारे छोटे कॉइन चाहिए। पहले कम राशि भेजें।",
  // ---- end chains-fuel
  // ---- chains-bitcoincash (bitcoincash)
  // ---- end chains-bitcoincash
  // ---- 1mask (networks87 providers) (1mask)
  // ---- end 1mask (networks87 providers)
  // ---- chains-evm
  "bg.label.networkCharge": "नेटवर्क का तय शुल्क",
  "bg.evm.flatFee": "हर लेन-देन पर {amount}, विफल होने पर भी",
  // ---- end chains-evm
};
export default messages;
