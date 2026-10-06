import type N87 from "../../en/n87.js";

/** Japanese: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../ja.ts and its glossary. */
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
  "bg.fuel.changeToOther": "この後に残るあなたの{symbol}はすべて、あなたではなく{to}に送られます。",
  "bg.fuel.leftoverLost": "{amount}はこの取引でどこにも送られず、失われます。",
  "bg.fuel.coinsSpent": "この取引が使うコインの一部はすでに使われています。アプリにもう一度試すよう依頼してください。",
  "bg.fuel.feeRose": "準備した後にネットワーク手数料が上がりました。何も送信されていません。もう一度お試しください。",
  "bg.fuel.failedOnChain": "この取引は Fuel ネットワークで失敗しました。ネットワーク手数料のみが支払われました。",
  "bg.fuel.tooManyCoins": "一度に小さなコインが多すぎます。先に少ない金額を送ってください。",
  // ---- end chains-fuel
  // ---- chains-bitcoincash (bitcoincash)
  // ---- end chains-bitcoincash
  // ---- 1mask (networks87 providers) (1mask)
  // ---- end 1mask (networks87 providers)
  // ---- chains-evm
  "bg.label.networkCharge": "ネットワークの定額料金",
  "bg.evm.flatFee": "1件の取引ごとに{amount}（失敗しても請求）",
  // ---- end chains-evm
};
export default messages;
