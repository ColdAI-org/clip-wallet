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
  "bg.stacks.postCondition": "ポストコンディション",
  "bg.stacks.pcYouSendExactly": "あなたはちょうど{amount}を送信します",
  "bg.stacks.pcYouSendAtMost": "あなたは最大{amount}を送信します",
  "bg.stacks.pcYouSendAtLeast": "あなたは最低{amount}を送信します",
  "bg.stacks.pcYouSendMoreThan": "あなたは{amount}を超える額を送信します",
  "bg.stacks.pcYouSendLessThan": "あなたは{amount}未満の額を送信します",
  "bg.stacks.pcSendsExactly": "{who}はちょうど{amount}を送信します",
  "bg.stacks.pcSendsAtMost": "{who}は最大{amount}を送信します",
  "bg.stacks.pcSendsAtLeast": "{who}は最低{amount}を送信します",
  "bg.stacks.pcSendsMoreThan": "{who}は{amount}を超える額を送信します",
  "bg.stacks.pcSendsLessThan": "{who}は{amount}未満の額を送信します",
  "bg.stacks.pcYouSendNft": "あなたは{item}を送信します",
  "bg.stacks.pcYouKeepNft": "あなたは{item}を保持します",
  "bg.stacks.pcYouMaySendNft": "あなたは{item}を送信する可能性があります",
  "bg.stacks.pcSendsNft": "{who}は{item}を送信します",
  "bg.stacks.pcKeepsNft": "{who}は{item}を保持します",
  "bg.stacks.pcMaySendNft": "{who}は{item}を送信する可能性があります",
  "bg.stacks.pcStakingRule": "{who}のステーキングルール",
  "bg.stacks.allowMode": "これにより、コントラクトはリストにあるものだけでなく、あなたのどの資産でも動かせるようになります。{host}を完全に信頼できる場合のみ承認してください。",
  "bg.stacks.originatorMode": "あなたのアカウントから出ていけるのは、リストにある送金だけです。ただし、コントラクトは他のアカウントの資産を動かす可能性があります。",
  "bg.stacks.nothingLeaves": "この取引では、ネットワーク手数料を除き、あなたの資産がアカウントから出ていくことはありません。",
  "bg.stacks.highFee": "ネットワーク手数料は{fee}で、異常に高額です。",
  "bg.stacks.sponsorPays": "{host}が選んだスポンサー",
  "bg.stacks.deployNamed": "スマートコントラクト{name}を作成",
  "bg.stacks.notYourTx": "この取引は別の Stacks アカウントが署名するものなので、Clip Wallet では署名できません。",
  "bg.stacks.multisig": "Clip Wallet は、共有（マルチシグ）Stacks アカウントでの署名にはまだ対応していません。",
  "bg.stacks.memoTooLong": "メモが長すぎます。Stacks のメモは最大34バイトです。",
  "bg.stacks.feeTooLow": "ネットワーク手数料が低すぎたため、ネットワークに受け付けられませんでした。何も送信されていません。もう一度お試しください。",
  "bg.stacks.nonceBusy": "このアカウントの別の取引がまだ処理待ちです。完了するまで待ってから、もう一度お試しください。",
  "bg.stacks.otherNetworkTx": "この取引は別の Stacks ネットワーク用のため、送信されませんでした。",
  "bg.stacks.badContractCall": "アプリのコントラクト呼び出しが、ネットワーク上のコントラクトと一致しません。何も送信されていません。",
  "bg.stacks.tooManyPending": "このアカウントには処理待ちの取引が多すぎます。いくつか完了するまで待ってから、もう一度お試しください。",
  "bg.stacks.signatureRefused": "ネットワークが署名を受け付けませんでした。何も送信されていません。",
  "bg.stacks.testAddressOnMainnet": "これは Stacks のテストネットワークのアドレス（ST…）です。メインネットのアドレス（SP…）を使用してください。",
  "bg.stacks.mainAddressOnTestnet": "これは Stacks のメインネットのアドレス（SP…）です。テストネットワークのアドレス（ST…）を使用してください。",
  "bg.stacks.notAnAddress": "Stacks のアドレスではないようです。",
  "bg.stacks.needStxForFee": "ネットワーク手数料を支払うには、少額の STX が必要です。",
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
