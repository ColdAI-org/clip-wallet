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
  "bg.stacks.postCondition": "사후 조건",
  "bg.stacks.pcYouSendExactly": "내가 정확히 {amount}을(를) 보내요",
  "bg.stacks.pcYouSendAtMost": "내가 최대 {amount}을(를) 보내요",
  "bg.stacks.pcYouSendAtLeast": "내가 최소 {amount}을(를) 보내요",
  "bg.stacks.pcYouSendMoreThan": "내가 {amount}보다 많이 보내요",
  "bg.stacks.pcYouSendLessThan": "내가 {amount}보다 적게 보내요",
  "bg.stacks.pcSendsExactly": "{who}이(가) 정확히 {amount}을(를) 보내요",
  "bg.stacks.pcSendsAtMost": "{who}이(가) 최대 {amount}을(를) 보내요",
  "bg.stacks.pcSendsAtLeast": "{who}이(가) 최소 {amount}을(를) 보내요",
  "bg.stacks.pcSendsMoreThan": "{who}이(가) {amount}보다 많이 보내요",
  "bg.stacks.pcSendsLessThan": "{who}이(가) {amount}보다 적게 보내요",
  "bg.stacks.pcYouSendNft": "내가 {item}을(를) 보내요",
  "bg.stacks.pcYouKeepNft": "내가 {item}을(를) 계속 보유해요",
  "bg.stacks.pcYouMaySendNft": "내가 {item}을(를) 보낼 수도 있어요",
  "bg.stacks.pcSendsNft": "{who}이(가) {item}을(를) 보내요",
  "bg.stacks.pcKeepsNft": "{who}이(가) {item}을(를) 계속 보유해요",
  "bg.stacks.pcMaySendNft": "{who}이(가) {item}을(를) 보낼 수도 있어요",
  "bg.stacks.pcStakingRule": "{who}의 스테이킹 규칙",
  "bg.stacks.allowMode": "이렇게 하면 컨트랙트가 목록에 있는 자산뿐 아니라 내 자산을 무엇이든 옮길 수 있어요. {host}을(를) 완전히 신뢰할 때만 승인하세요.",
  "bg.stacks.originatorMode": "목록에 있는 전송만 내 계정에서 나갈 수 있어요. 하지만 컨트랙트가 다른 계정의 자산은 여전히 옮길 수 있어요.",
  "bg.stacks.nothingLeaves": "이 트랜잭션에서는 네트워크 수수료 외에 내 자산이 계정에서 나가지 않아요.",
  "bg.stacks.highFee": "네트워크 수수료가 {fee}(으)로 비정상적으로 높아요.",
  "bg.stacks.sponsorPays": "{host}이(가) 선택한 스폰서",
  "bg.stacks.deployNamed": "스마트 컨트랙트 {name} 만들기",
  "bg.stacks.notYourTx": "이 트랜잭션은 다른 Stacks 계정이 서명하는 것이라서 Clip Wallet이 서명할 수 없어요.",
  "bg.stacks.multisig": "Clip Wallet은 아직 공유(다중 서명) Stacks 계정으로 서명할 수 없어요.",
  "bg.stacks.memoTooLong": "메모가 너무 길어요. Stacks 메모에는 최대 34바이트까지 넣을 수 있어요.",
  "bg.stacks.feeTooLow": "네트워크 수수료가 너무 낮아서 네트워크가 트랜잭션을 받지 않았어요. 아무것도 전송되지 않았어요. 다시 시도하세요.",
  "bg.stacks.nonceBusy": "이 계정의 다른 트랜잭션이 아직 대기 중이에요. 완료될 때까지 기다린 뒤 다시 시도하세요.",
  "bg.stacks.otherNetworkTx": "이 트랜잭션은 다른 Stacks 네트워크용이라서 전송되지 않았어요.",
  "bg.stacks.badContractCall": "앱의 컨트랙트 호출이 네트워크에 있는 컨트랙트와 일치하지 않아요. 아무것도 전송되지 않았어요.",
  "bg.stacks.tooManyPending": "이 계정에 대기 중인 트랜잭션이 너무 많아요. 일부가 완료될 때까지 기다린 뒤 다시 시도하세요.",
  "bg.stacks.signatureRefused": "네트워크가 서명을 받아들이지 않았어요. 아무것도 전송되지 않았어요.",
  "bg.stacks.testAddressOnMainnet": "Stacks 테스트 네트워크 주소(ST…)예요. 메인넷 주소(SP…)를 사용하세요.",
  "bg.stacks.mainAddressOnTestnet": "Stacks 메인넷 주소(SP…)예요. 테스트 네트워크 주소(ST…)를 사용하세요.",
  "bg.stacks.notAnAddress": "Stacks 주소가 아닌 것 같아요.",
  "bg.stacks.needStxForFee": "네트워크 수수료를 내려면 STX가 조금 필요해요.",
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
