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
  "bg.multiversx.claimRewardsFrom": "{validator} से अपने स्टेकिंग रिवॉर्ड क्लेम करें",
  "bg.multiversx.withdrawFrom": "{validator} से अपने अनस्टेक किए गए EGLD निकालें",
  "bg.multiversx.restakeRewardsWith": "{validator} के साथ अपने रिवॉर्ड फिर से स्टेक करें",
  "bg.multiversx.labelGuardian": "गार्डियन",
  "bg.multiversx.setGuardianTitle": "{guardian} को अपने अकाउंट का गार्डियन बनाएं",
  "bg.multiversx.setGuardianWarn": "गार्डियन चालू होने के बाद इस अकाउंट के हर ट्रांज़ैक्शन पर उसका सह-हस्ताक्षर ज़रूरी होता है। अगर {guardian} को आपने नहीं चुना है, तो कोई आपको आपके ही अकाउंट से बाहर कर सकता है।",
  "bg.multiversx.guardAccountTitle": "अपने अकाउंट का गार्डियन चालू करें",
  "bg.multiversx.guardAccountWarn": "अब से इस अकाउंट के हर ट्रांज़ैक्शन पर गार्डियन का सह-हस्ताक्षर ज़रूरी होगा। Clip Wallet यह नहीं दे सकता, इसलिए आप Clip Wallet से और भेज नहीं पाएंगे।",
  "bg.multiversx.unguardAccountTitle": "अपने अकाउंट का गार्डियन बंद करें",
  "bg.multiversx.changeOwnerTitle": "कॉन्ट्रैक्ट {contract} को {owner} को सौंपें",
  "bg.multiversx.changeOwnerWarn": "इससे {owner} कॉन्ट्रैक्ट {contract} का मालिक बन जाता है। नया मालिक इसका कोड बदल सकता है और इसमें रखी चीज़ें ले सकता है। ऐसा तभी करें जब आप सच में इसे सौंपना चाहते हों।",
  "bg.multiversx.guardedAccount": "इस अकाउंट का एक गार्डियन है, और Clip Wallet गार्डियन का सह-हस्ताक्षर नहीं ले सकता। कुछ भी नहीं भेजा गया।",
  // ---- end chains-multiversx
  // ---- chains-icp (icp)
  "bg.icp.toAccountId": "यह एक अकाउंट ID पर भेजता है, यानी उस तरह का डिपॉज़िट एड्रेस जो एक्सचेंज देते हैं। जांच लें कि यह एक्सचेंज में दिखे एड्रेस से बिल्कुल मेल खाता है।",
  "bg.icp.expired": "आपके मंज़ूर करने से पहले ही इस ट्रांसफ़र की समय-सीमा खत्म हो गई। कुछ भी नहीं भेजा गया। फिर से कोशिश करें।",
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
  // ---- chains-substrate (Chainflip)
  "bg.chainflip.noTransfer": "{symbol} को एक Chainflip अकाउंट से दूसरे में नहीं भेजा जा सकता। इसे ले जाने के लिए, इसे किसी Ethereum एड्रेस पर रिडीम करें, या दूसरे अकाउंट को Ethereum से फ़ंड करें।",
  "bg.chainflip.redeem": "{amount} को Ethereum पर {to} में रिडीम करें",
  "bg.chainflip.redeemAll": "अपना सारा {symbol} Ethereum पर {to} में रिडीम करें",
  "bg.chainflip.allRedeemable": "आपका सारा {symbol} जो बॉन्ड नहीं है",
  "bg.chainflip.label.executor": "इसे कौन पूरा कर सकता है",
  "bg.chainflip.anyone": "कोई भी",
  "bg.chainflip.redeemSteps": "इंतज़ार की अवधि के बाद, रिडेम्प्शन Ethereum पर पूरा होता है (इसमें ETH गैस लगती है)। अगर समय सीमा से पहले कोई इसे पूरा न करे, तो इसे दोबारा करना होगा।",
  "bg.chainflip.redeemWarn": "आपका {symbol} Chainflip छोड़कर Ethereum पर {to} पर जा रहा है। जाँच लें कि यह Ethereum एड्रेस आपके नियंत्रण में है।",
  "bg.chainflip.bindRedeem": "रिडेम्प्शन हमेशा के लिए सिर्फ़ {to} पर होने दें",
  "bg.chainflip.bindRedeemWarn": "इसे कभी पलटा नहीं जा सकता। यह अकाउंट अब {symbol} सिर्फ़ {to} पर ही रिडीम करेगा। अगर वह Ethereum एड्रेस आपके नियंत्रण में नहीं है, तो आपका {symbol} हमेशा के लिए लॉक हो जाएगा।",
  "bg.chainflip.bindExecutor": "हमेशा के लिए सिर्फ़ {to} को आपके रिडेम्प्शन पूरे करने दें",
  "bg.chainflip.bindExecutorWarn": "इसे कभी पलटा नहीं जा सकता। इस अकाउंट के {symbol} रिडेम्प्शन Ethereum पर सिर्फ़ {to} पूरे कर पाएगा। अगर वह की खो गई, तो रिडीम किया गया {symbol} क्लेम नहीं किया जा सकेगा।",
  "bg.chainflip.moveTo": "{amount} को Chainflip अकाउंट {to} में ले जाएँ",
  "bg.chainflip.moveAllTo": "अपना सारा {symbol} Chainflip अकाउंट {to} में ले जाएँ",
  "bg.chainflip.otherAccount": "{to} आपके अकाउंट में से नहीं है। वहाँ कुछ भी भेजने से पहले जाँच लें।",
  "bg.chainflip.foreignRecipient": "यह {chain} पर {to} को जाएगा। एड्रेस जाँच लें: Clip Wallet इसे वापस नहीं कर सकता।",
  "bg.chainflip.registerLp": "Chainflip लिक्विडिटी प्रोवाइडर के रूप में रजिस्टर करें",
  "bg.chainflip.deregisterLp": "अपना Chainflip लिक्विडिटी प्रोवाइडर अकाउंट बंद करें",
  "bg.chainflip.refundAddress": "अपना {chain} रिफ़ंड एड्रेस {to} पर सेट करें",
  "bg.chainflip.depositAddress": "{asset} के लिए डिपॉज़िट एड्रेस पाएँ",
  "bg.chainflip.label.boostFee": "Boost शुल्क",
  "bg.chainflip.label.refundTo": "रिफ़ंड यहाँ जाएँगे",
  "bg.chainflip.withdraw": "{amount} को {chain} पर {to} में निकालें",
  "bg.chainflip.swap": "{amount} को {asset} से स्वैप करें",
  "bg.chainflip.swapChannel": "{from} को {to} से स्वैप करने के लिए चैनल खोलें",
  "bg.chainflip.addBoost": "Boost: {tier} bps पूल में {amount} जोड़ें",
  "bg.chainflip.stopBoost": "{tier} bps पूल में {asset} की Boosting बंद करें",
  "bg.chainflip.lend": "{amount} उधार दें",
  "bg.chainflip.unlend": "उधार दिए गए {amount} वापस लें",
  "bg.chainflip.unlendAll": "उधार दिया गया सारा {asset} वापस लें",
  "bg.chainflip.borrow": "{amount} उधार लें",
  "bg.chainflip.repay": "लोन #{id} का कुछ हिस्सा चुकाएँ",
  "bg.chainflip.repayAll": "लोन #{id} पूरा चुकाएँ",
  "bg.chainflip.onSubAccount": "सब-अकाउंट #{n} पर: {inner}",
  "bg.chainflip.orderFee": "ऑर्डर लगाने या बदलने के लिए इस अकाउंट में कम से कम 1 {symbol} होना ज़रूरी है। इसका ज़्यादातर हिस्सा वापस आ जाता है, लेकिन एक ही ब्लॉक में एक ही पूल के ऑर्डर कई बार बदलने पर हर बार शुल्क बढ़ता है।",
  // ---- end chains-substrate (Chainflip)
};
export default messages;
