import type N87 from "../../en/n87.js";

/** Simplified Chinese: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../zh-Hans.ts and its glossary. */
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
  "bg.fuel.changeToOther": "此后你剩余的所有 {symbol} 都会转给 {to}，而不会退回给你。",
  "bg.fuel.leftoverLost": "{amount} 在此交易中没有发送到任何地方，将会丢失。",
  "bg.fuel.coinsSpent": "此交易使用的部分币已经被花掉。请让应用重试。",
  "bg.fuel.feeRose": "准备之后网络手续费上涨了。没有发送任何内容。请重试。",
  "bg.fuel.failedOnChain": "此交易在 Fuel 网络上失败。只花费了网络手续费。",
  "bg.fuel.tooManyCoins": "这需要一次使用太多小额币。请先发送较小的金额。",
  // ---- end chains-fuel
  // ---- chains-bitcoincash (bitcoincash)
  // ---- end chains-bitcoincash
  // ---- 1mask (networks87 providers) (1mask)
  // ---- end 1mask (networks87 providers)
  // ---- chains-evm
  "bg.label.networkCharge": "网络定额收费",
  "bg.evm.flatFee": "每笔交易 {amount}，失败也收取",
  // ---- end chains-evm
};
export default messages;
