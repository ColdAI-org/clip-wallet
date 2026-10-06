import type N87 from "../../en/n87.js";

/** Hindi: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../hi.ts and its glossary. */
const messages: { readonly [K in keyof typeof N87]: string } = {
  // ---- chains-cosmos (cosmos, provenance, thorchain, initia)
  // ---- end chains-cosmos
  // ---- chains-tron (tron)
  "bg.tron.notControlled": "यह TRON अकाउंट किसी दूसरी कुंजी से नियंत्रित है, इसलिए Clip Wallet इसके लिए साइन नहीं कर सकता।",
  "bg.tron.notOpen": "आपका TRON अकाउंट अभी खुला नहीं है। पहले कुछ TRX प्राप्त करें।",
  "bg.tron.contractRecipient": "TRX को सीधे किसी स्मार्ट कॉन्ट्रैक्ट पर नहीं भेजा जा सकता।",
  "bg.tron.newAccountFee": "यह एड्रेस अभी TRON पर खुला नहीं है। इस पर भेजने में इसे खोलने के लिए {amount} अलग से लगेंगे।",
  "bg.tron.getsSigned": "{host} (इसे साइन किया गया ट्रांज़ैक्शन मिलता है)",
  "bg.tron.energy": "एनर्जी",
  "bg.tron.bandwidth": "बैंडविड्थ",
  "bg.tron.tronPower": "वोटिंग पावर",
  "bg.tron.stakeFor": "{resource} के लिए {amount} स्टेक करें",
  "bg.tron.days": "{count} दिन",
  "bg.tron.cancelUnstaking": "अपनी लंबित अनस्टेकिंग रद्द करें और उस TRX को फिर से स्टेक करें",
  "bg.tron.lend": "आपके स्टेक किए गए {amount} की {resource} {to} को उधार दें",
  "bg.tron.stopLending": "{to} को उधार दिए गए {amount} की {resource} वापस लें",
  "bg.tron.lockedHours": "लगभग {hours} घंटे। उससे पहले आप इसे वापस नहीं ले सकते।",
  "bg.tron.vote": "{count} Super Representatives को वोट दें",
  "bg.tron.votesReplace": "यह आपके पहले के सभी वोट बदल देता है।",
  "bg.tron.claimVoteRewards": "अपने वोटिंग रिवॉर्ड क्लेम करें",
  "bg.tron.changePermissions": "बदलें कि आपका TRON अकाउंट कौन नियंत्रित करता है",
  "bg.tron.keysThreshold": "{keys} ({threshold} ज़रूरी)",
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
  "bg.stacks.postCondition": "पोस्ट-कंडीशन",
  "bg.stacks.pcYouSendExactly": "आप ठीक {amount} भेजते हैं",
  "bg.stacks.pcYouSendAtMost": "आप ज़्यादा से ज़्यादा {amount} भेजते हैं",
  "bg.stacks.pcYouSendAtLeast": "आप कम से कम {amount} भेजते हैं",
  "bg.stacks.pcYouSendMoreThan": "आप {amount} से ज़्यादा भेजते हैं",
  "bg.stacks.pcYouSendLessThan": "आप {amount} से कम भेजते हैं",
  "bg.stacks.pcSendsExactly": "{who} ठीक {amount} भेजता है",
  "bg.stacks.pcSendsAtMost": "{who} ज़्यादा से ज़्यादा {amount} भेजता है",
  "bg.stacks.pcSendsAtLeast": "{who} कम से कम {amount} भेजता है",
  "bg.stacks.pcSendsMoreThan": "{who} {amount} से ज़्यादा भेजता है",
  "bg.stacks.pcSendsLessThan": "{who} {amount} से कम भेजता है",
  "bg.stacks.pcYouSendNft": "आप {item} भेजते हैं",
  "bg.stacks.pcYouKeepNft": "{item} आपके पास रहता है",
  "bg.stacks.pcYouMaySendNft": "आप {item} भेज सकते हैं",
  "bg.stacks.pcSendsNft": "{who} {item} भेजता है",
  "bg.stacks.pcKeepsNft": "{item} {who} के पास रहता है",
  "bg.stacks.pcMaySendNft": "{who} {item} भेज सकता है",
  "bg.stacks.pcStakingRule": "{who} के लिए एक स्टेकिंग नियम",
  "bg.stacks.allowMode": "इससे कॉन्ट्रैक्ट आपका कोई भी एसेट ट्रांसफ़र कर सकता है, सिर्फ़ लिस्ट किए गए एसेट नहीं। इसे सिर्फ़ तभी मंज़ूर करें, जब आपको {host} पर पूरा भरोसा हो।",
  "bg.stacks.originatorMode": "सिर्फ़ लिस्ट किए गए ट्रांसफ़र ही आपके अकाउंट से बाहर जा सकते हैं। कॉन्ट्रैक्ट फिर भी दूसरे अकाउंट के एसेट ट्रांसफ़र कर सकता है।",
  "bg.stacks.nothingLeaves": "इस ट्रांज़ैक्शन में नेटवर्क शुल्क के अलावा आपका कोई भी एसेट आपके अकाउंट से बाहर नहीं जा सकता।",
  "bg.stacks.highFee": "नेटवर्क शुल्क {fee} है, जो असामान्य रूप से ज़्यादा है।",
  "bg.stacks.sponsorPays": "{host} का चुना हुआ स्पॉन्सर",
  "bg.stacks.deployNamed": "स्मार्ट कॉन्ट्रैक्ट {name} बनाएं",
  "bg.stacks.notYourTx": "यह ट्रांज़ैक्शन किसी दूसरे Stacks अकाउंट से साइन होता है, इसलिए Clip Wallet इसे साइन नहीं कर सकता।",
  "bg.stacks.multisig": "Clip Wallet अभी शेयर्ड (मल्टी-सिग्नेचर) Stacks अकाउंट के लिए साइन नहीं कर सकता।",
  "bg.stacks.memoTooLong": "मेमो बहुत लंबा है। Stacks मेमो में ज़्यादा से ज़्यादा 34 बाइट आ सकते हैं।",
  "bg.stacks.feeTooLow": "नेटवर्क शुल्क बहुत कम था, इसलिए नेटवर्क ने इसे स्वीकार नहीं किया। कुछ भी नहीं भेजा गया। दोबारा कोशिश करें।",
  "bg.stacks.nonceBusy": "इस अकाउंट का एक और ट्रांज़ैक्शन अभी इंतज़ार में है। उसके पूरा होने तक रुकें, फिर दोबारा कोशिश करें।",
  "bg.stacks.otherNetworkTx": "यह ट्रांज़ैक्शन किसी दूसरे Stacks नेटवर्क के लिए है, इसलिए इसे नहीं भेजा गया।",
  "bg.stacks.badContractCall": "ऐप का कॉन्ट्रैक्ट कॉल नेटवर्क पर मौजूद कॉन्ट्रैक्ट से मेल नहीं खाता। कुछ भी नहीं भेजा गया।",
  "bg.stacks.tooManyPending": "इस अकाउंट के बहुत ज़्यादा ट्रांज़ैक्शन इंतज़ार में हैं। कुछ के पूरा होने तक रुकें, फिर दोबारा कोशिश करें।",
  "bg.stacks.signatureRefused": "नेटवर्क ने सिग्नेचर स्वीकार नहीं किया। कुछ भी नहीं भेजा गया।",
  "bg.stacks.testAddressOnMainnet": "यह Stacks टेस्ट-नेटवर्क एड्रेस (ST…) है। मेननेट एड्रेस (SP…) इस्तेमाल करें।",
  "bg.stacks.mainAddressOnTestnet": "यह Stacks मेननेट एड्रेस (SP…) है। टेस्ट-नेटवर्क एड्रेस (ST…) इस्तेमाल करें।",
  "bg.stacks.notAnAddress": "यह Stacks एड्रेस जैसा नहीं लगता।",
  "bg.stacks.needStxForFee": "नेटवर्क शुल्क चुकाने के लिए आपको थोड़े STX चाहिए।",
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
