import type N87 from "../../en/n87.js";

/** Arabic: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../ar.ts and its glossary. */
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
