import type N87 from "../../en/n87.js";

/** Korean: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../ko.ts and its glossary. */
const messages: { readonly [K in keyof typeof N87]: string } = {
  // ---- chains-cosmos (cosmos, provenance, thorchain, initia)
  // ---- end chains-cosmos
  // ---- chains-tron (tron)
  "bg.tron.notControlled": "이 TRON 계정은 다른 키가 관리하고 있어서 Clip Wallet이 서명할 수 없어요.",
  "bg.tron.notOpen": "TRON 계정이 아직 열리지 않았어요. 먼저 TRX를 받아 주세요.",
  "bg.tron.contractRecipient": "TRX는 스마트 컨트랙트로 바로 보낼 수 없어요.",
  "bg.tron.newAccountFee": "이 주소는 아직 TRON에서 열리지 않았어요. 여기로 보내면 여는 데 {amount}이(가) 추가로 들어요.",
  "bg.tron.getsSigned": "{host} (서명된 트랜잭션을 받아요)",
  "bg.tron.energy": "에너지",
  "bg.tron.bandwidth": "대역폭",
  "bg.tron.tronPower": "투표권",
  "bg.tron.stakeFor": "{resource}을(를) 위해 {amount} 스테이킹",
  "bg.tron.days": "{count}일",
  "bg.tron.cancelUnstaking": "대기 중인 스테이킹 해제를 취소하고 그 TRX를 다시 스테이킹",
  "bg.tron.lend": "스테이킹한 {amount}의 {resource}을(를) {to}에게 빌려주기",
  "bg.tron.stopLending": "{to}에게 빌려준 {amount}의 {resource} 회수",
  "bg.tron.lockedHours": "약 {hours}시간이에요. 그 전에는 되돌릴 수 없어요.",
  "bg.tron.vote": "Super Representative {count}명에게 투표",
  "bg.tron.votesReplace": "이전 투표가 모두 대체돼요.",
  "bg.tron.claimVoteRewards": "투표 보상 받기",
  "bg.tron.changePermissions": "TRON 계정을 관리하는 사람 변경",
  "bg.tron.keysThreshold": "{keys} ({threshold} 필요)",
  // ---- end chains-tron
  // ---- chains-xrpl (xrpl)
  // ---- end chains-xrpl
  // ---- chains-antelope (antelope)
  // ---- end chains-antelope
  // ---- chains-multiversx (multiversx)
  "bg.multiversx.claimRewardsFrom": "{validator}에서 스테이킹 보상 받기",
  "bg.multiversx.withdrawFrom": "{validator}에서 스테이킹 해제된 EGLD 인출",
  "bg.multiversx.restakeRewardsWith": "{validator}에 보상 다시 스테이킹",
  "bg.multiversx.labelGuardian": "가디언",
  "bg.multiversx.setGuardianTitle": "{guardian}을(를) 내 계정의 가디언으로 지정",
  "bg.multiversx.setGuardianWarn": "가디언이 활성화되면 이 계정의 모든 거래에 가디언의 공동 서명이 필요해요. {guardian}을(를) 직접 고르지 않았다면 누군가 내 계정을 잠가 버릴 수 있어요.",
  "bg.multiversx.guardAccountTitle": "내 계정의 가디언 켜기",
  "bg.multiversx.guardAccountWarn": "이제부터 이 계정의 모든 거래에 가디언의 공동 서명이 필요해요. Clip Wallet은 이 서명을 제공할 수 없어서 Clip Wallet에서는 더 이상 보낼 수 없어요.",
  "bg.multiversx.unguardAccountTitle": "내 계정의 가디언 끄기",
  "bg.multiversx.changeOwnerTitle": "{contract} 컨트랙트를 {owner}에게 넘기기",
  "bg.multiversx.changeOwnerWarn": "{owner}이(가) {contract} 컨트랙트의 소유자가 돼요. 새 소유자는 코드를 바꾸고 안에 있는 자산을 가져갈 수 있어요. 정말 넘길 생각일 때만 진행하세요.",
  "bg.multiversx.guardedAccount": "이 계정에는 가디언이 있고 Clip Wallet은 가디언의 공동 서명을 받을 수 없어요. 아무것도 전송되지 않았어요.",
  // ---- end chains-multiversx
  // ---- chains-icp (icp)
  "bg.icp.toAccountId": "거래소가 입금 주소로 주는 형태인 계정 ID로 보내요. 거래소에 표시된 것과 정확히 같은지 확인하세요.",
  "bg.icp.expired": "승인하기 전에 이 송금의 유효 시간이 지났어요. 아무것도 전송되지 않았어요. 다시 시도해 주세요.",
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
