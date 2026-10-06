import type N87 from "../../en/n87.js";

/** Arabic: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../ar.ts and its glossary. */
const messages: { readonly [K in keyof typeof N87]: string } = {
  // ---- chains-cosmos (cosmos, provenance, thorchain, initia)
  // ---- end chains-cosmos
  // ---- chains-tron (tron)
  "bg.tron.notControlled": "يتحكم مفتاح آخر في حساب TRON هذا، لذا لا تستطيع Clip Wallet التوقيع عنه.",
  "bg.tron.notOpen": "حسابك على TRON غير مفتوح بعد. استلم بعض TRX أولًا.",
  "bg.tron.contractRecipient": "لا يمكن إرسال TRX مباشرةً إلى عقد ذكي.",
  "bg.tron.newAccountFee": "هذا العنوان غير مفتوح على TRON بعد. الإرسال إليه يكلّف أيضًا \u2068{amount}\u2069 لفتحه.",
  "bg.tron.getsSigned": "\u2068{host}\u2069 (يتلقى المعاملة الموقّعة)",
  "bg.tron.energy": "الطاقة",
  "bg.tron.bandwidth": "عرض النطاق",
  "bg.tron.tronPower": "قوة التصويت",
  "bg.tron.stakeFor": "تخزين \u2068{amount}\u2069 مقابل \u2068{resource}\u2069",
  "bg.tron.days": "\u2068{count}\u2069 يومًا",
  "bg.tron.cancelUnstaking": "إلغاء عمليات إلغاء التخزين المعلّقة وتخزين تلك TRX مجددًا",
  "bg.tron.lend": "إقراض \u2068{resource}\u2069 من \u2068{amount}\u2069 التي خزّنتها إلى \u2068{to}\u2069",
  "bg.tron.stopLending": "استرداد \u2068{resource}\u2069 من \u2068{amount}\u2069 التي أقرضتها إلى \u2068{to}\u2069",
  "bg.tron.lockedHours": "حوالي \u2068{hours}\u2069 ساعة. لا يمكنك استرداده قبل ذلك.",
  "bg.tron.vote": "التصويت لـ \u2068{count}\u2069 من Super Representatives",
  "bg.tron.votesReplace": "يحل هذا محل جميع أصواتك السابقة.",
  "bg.tron.claimVoteRewards": "المطالبة بمكافآت التصويت",
  "bg.tron.changePermissions": "تغيير من يتحكم في حسابك على TRON",
  "bg.tron.keysThreshold": "\u2068{keys}\u2069 (يتطلب \u2068{threshold}\u2069)",
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
  "bg.stacks.postCondition": "شرط لاحق",
  "bg.stacks.pcYouSendExactly": "ترسل \u2068{amount}\u2069 بالضبط",
  "bg.stacks.pcYouSendAtMost": "ترسل \u2068{amount}\u2069 على الأكثر",
  "bg.stacks.pcYouSendAtLeast": "ترسل \u2068{amount}\u2069 على الأقل",
  "bg.stacks.pcYouSendMoreThan": "ترسل أكثر من \u2068{amount}\u2069",
  "bg.stacks.pcYouSendLessThan": "ترسل أقل من \u2068{amount}\u2069",
  "bg.stacks.pcSendsExactly": "يرسل \u2068{who}\u2069 \u2068{amount}\u2069 بالضبط",
  "bg.stacks.pcSendsAtMost": "يرسل \u2068{who}\u2069 \u2068{amount}\u2069 على الأكثر",
  "bg.stacks.pcSendsAtLeast": "يرسل \u2068{who}\u2069 \u2068{amount}\u2069 على الأقل",
  "bg.stacks.pcSendsMoreThan": "يرسل \u2068{who}\u2069 أكثر من \u2068{amount}\u2069",
  "bg.stacks.pcSendsLessThan": "يرسل \u2068{who}\u2069 أقل من \u2068{amount}\u2069",
  "bg.stacks.pcYouSendNft": "ترسل \u2068{item}\u2069",
  "bg.stacks.pcYouKeepNft": "تحتفظ بـ \u2068{item}\u2069",
  "bg.stacks.pcYouMaySendNft": "قد ترسل \u2068{item}\u2069",
  "bg.stacks.pcSendsNft": "يرسل \u2068{who}\u2069 \u2068{item}\u2069",
  "bg.stacks.pcKeepsNft": "يحتفظ \u2068{who}\u2069 بـ \u2068{item}\u2069",
  "bg.stacks.pcMaySendNft": "قد يرسل \u2068{who}\u2069 \u2068{item}\u2069",
  "bg.stacks.pcStakingRule": "قاعدة تخزين لـ \u2068{who}\u2069",
  "bg.stacks.allowMode": "يتيح هذا للعقد نقل أي من أصولك، لا الأصول المدرجة فقط. لا توافق عليه إلا إذا كنت تثق بـ \u2068{host}\u2069 ثقة تامة.",
  "bg.stacks.originatorMode": "لا يمكن أن تغادر حسابك إلا التحويلات المدرجة. لكن قد يظل العقد قادرًا على نقل أصول حسابات أخرى.",
  "bg.stacks.nothingLeaves": "لا يمكن لأي من أصولك أن يغادر حسابك في هذه المعاملة، باستثناء رسوم الشبكة.",
  "bg.stacks.highFee": "رسوم الشبكة \u2068{fee}\u2069، وهي مرتفعة على نحو غير معتاد.",
  "bg.stacks.sponsorPays": "راعٍ اختاره \u2068{host}\u2069",
  "bg.stacks.deployNamed": "إنشاء العقد الذكي \u2068{name}\u2069",
  "bg.stacks.notYourTx": "هذه المعاملة موقّعة من حساب Stacks مختلف، لذا لا تستطيع Clip Wallet توقيعها.",
  "bg.stacks.multisig": "لا تستطيع Clip Wallet بعدُ التوقيع لحسابات Stacks المشتركة (متعددة التوقيعات).",
  "bg.stacks.memoTooLong": "المذكرة (Memo) طويلة جدًا. تتسع مذكرة Stacks لـ 34 بايت كحد أقصى.",
  "bg.stacks.feeTooLow": "كانت رسوم الشبكة منخفضة جدًا، لذا لم تقبل الشبكة المعاملة. لم يُرسَل أي شيء. حاول مرة أخرى.",
  "bg.stacks.nonceBusy": "لا تزال معاملة أخرى من هذا الحساب قيد الانتظار. انتظر حتى تكتمل، ثم حاول مرة أخرى.",
  "bg.stacks.otherNetworkTx": "هذه المعاملة لشبكة Stacks مختلفة، لذا لم تُرسَل.",
  "bg.stacks.badContractCall": "استدعاء العقد من التطبيق لا يطابق العقد على الشبكة. لم يُرسَل أي شيء.",
  "bg.stacks.tooManyPending": "لدى هذا الحساب معاملات كثيرة جدًا قيد الانتظار. انتظر حتى يكتمل بعضها، ثم حاول مرة أخرى.",
  "bg.stacks.signatureRefused": "لم تقبل الشبكة التوقيع. لم يُرسَل أي شيء.",
  "bg.stacks.testAddressOnMainnet": "هذا عنوان Stacks على شبكة تجريبية (ST…). استخدم عنوانًا على الشبكة الرئيسية (SP…).",
  "bg.stacks.mainAddressOnTestnet": "هذا عنوان Stacks على الشبكة الرئيسية (SP…). استخدم عنوانًا على شبكة تجريبية (ST…).",
  "bg.stacks.notAnAddress": "لا يبدو هذا عنوان Stacks.",
  "bg.stacks.needStxForFee": "تحتاج إلى قليل من STX لدفع رسوم الشبكة.",
  // ---- end chains-stacks
  // ---- chains-fuel (fuel)
  "bg.fuel.changeToOther": "كل ما يتبقى من \u2068{symbol}\u2069 بعد هذا يذهب إلى \u2068{to}\u2069، ولا يعود إليك.",
  "bg.fuel.leftoverLost": "لا تُرسل هذه المعاملة \u2068{amount}\u2069 إلى أي مكان، وسيضيع.",
  "bg.fuel.coinsSpent": "بعض العملات التي تستخدمها هذه المعاملة أُنفقت بالفعل. اطلب من التطبيق المحاولة مرة أخرى.",
  "bg.fuel.feeRose": "ارتفعت رسوم الشبكة منذ تجهيز هذا. لم يُرسَل أي شيء. حاول مرة أخرى.",
  "bg.fuel.failedOnChain": "فشلت هذه المعاملة على شبكة Fuel. لم يُدفع إلا رسوم الشبكة.",
  "bg.fuel.tooManyCoins": "يحتاج هذا إلى عدد كبير جدًا من العملات الصغيرة في وقت واحد. أرسل مبلغًا أصغر أولًا.",
  // ---- end chains-fuel
  // ---- chains-bitcoincash (bitcoincash)
  // ---- end chains-bitcoincash
  // ---- 1mask (networks87 providers) (1mask)
  // ---- end 1mask (networks87 providers)
  // ---- chains-evm
  "bg.label.networkCharge": "رسم ثابت للشبكة",
  "bg.evm.flatFee": "⁨{amount}⁩ لكل معاملة، حتى إن فشلت",
  // ---- end chains-evm
};
export default messages;
