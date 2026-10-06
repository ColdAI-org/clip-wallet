import type N87 from "../../en/n87.js";

/** Korean: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../ko.ts and its glossary. */
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
  "bg.fuel.changeToOther": "이후 남는 {symbol}은(는) 모두 나에게 돌아오지 않고 {to}(으)로 가요.",
  "bg.fuel.leftoverLost": "{amount}은(는) 이 트랜잭션에서 어디로도 보내지지 않아 사라져요.",
  "bg.fuel.coinsSpent": "이 트랜잭션이 사용하는 코인 일부가 이미 사용됐어요. 앱에 다시 시도해 달라고 요청하세요.",
  "bg.fuel.feeRose": "준비한 뒤 네트워크 수수료가 올랐어요. 아무것도 전송되지 않았어요. 다시 시도하세요.",
  "bg.fuel.failedOnChain": "이 트랜잭션은 Fuel 네트워크에서 실패했어요. 네트워크 수수료만 지불됐어요.",
  "bg.fuel.tooManyCoins": "한 번에 너무 많은 작은 코인이 필요해요. 먼저 더 적은 금액을 보내세요.",
  // ---- end chains-fuel
  // ---- chains-bitcoincash (bitcoincash)
  // ---- end chains-bitcoincash
  // ---- 1mask (networks87 providers) (1mask)
  // ---- end 1mask (networks87 providers)
  // ---- chains-evm
  "bg.label.networkCharge": "네트워크 정액 요금",
  "bg.evm.flatFee": "거래당 {amount}, 실패해도 부과됨",
  // ---- end chains-evm
};
export default messages;
