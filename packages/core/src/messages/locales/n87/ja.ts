import type N87 from "../../en/n87.js";

/** Japanese: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../ja.ts and its glossary. */
const messages: { readonly [K in keyof typeof N87]: string } = {
  // ---- chains-cosmos (cosmos, provenance, thorchain, initia)
  // ---- end chains-cosmos
  // ---- chains-tron (tron)
  "bg.tron.notControlled": "この TRON アカウントは別の鍵で管理されているため、Clip Wallet は署名できません。",
  "bg.tron.notOpen": "TRON アカウントはまだ開設されていません。まず TRX を受け取ってください。",
  "bg.tron.contractRecipient": "TRX をスマートコントラクトに直接送ることはできません。",
  "bg.tron.newAccountFee": "このアドレスは TRON でまだ開設されていません。送金すると、開設のために {amount} が追加でかかります。",
  "bg.tron.getsSigned": "{host}（署名済みの取引を受け取ります）",
  "bg.tron.energy": "エネルギー",
  "bg.tron.bandwidth": "帯域幅",
  "bg.tron.tronPower": "投票権",
  "bg.tron.stakeFor": "{amount}をステーキングして{resource}を得る",
  "bg.tron.days": "{count}日",
  "bg.tron.cancelUnstaking": "保留中のステーキング解除をキャンセルして、その TRX を再びステーキング",
  "bg.tron.lend": "ステーキングした{amount}の{resource}を{to}に貸し出す",
  "bg.tron.stopLending": "{to}に貸した{amount}の{resource}を取り戻す",
  "bg.tron.lockedHours": "約{hours}時間。それまでは取り戻せません。",
  "bg.tron.vote": "{count}名の Super Representative に投票",
  "bg.tron.votesReplace": "これまでの投票はすべて置き換えられます。",
  "bg.tron.claimVoteRewards": "投票報酬を受け取る",
  "bg.tron.changePermissions": "TRON アカウントを管理できる人を変更",
  "bg.tron.keysThreshold": "{keys}（必要: {threshold}）",
  // ---- end chains-tron
  // ---- chains-xrpl (xrpl)
  // ---- end chains-xrpl
  // ---- chains-antelope (antelope)
  // ---- end chains-antelope
  // ---- chains-multiversx (multiversx)
  "bg.multiversx.claimRewardsFrom": "{validator}からステーキング報酬を受け取る",
  "bg.multiversx.withdrawFrom": "{validator}からステーキング解除済みのEGLDを引き出す",
  "bg.multiversx.restakeRewardsWith": "{validator}で報酬を再ステーキング",
  "bg.multiversx.labelGuardian": "ガーディアン",
  "bg.multiversx.setGuardianTitle": "{guardian}をアカウントのガーディアンにする",
  "bg.multiversx.setGuardianWarn": "ガーディアンが有効になると、このアカウントからのすべての取引にその共同署名が必要になります。{guardian}を自分で選んでいない場合、誰かにアカウントから締め出されるおそれがあります。",
  "bg.multiversx.guardAccountTitle": "アカウントのガーディアンをオンにする",
  "bg.multiversx.guardAccountWarn": "今後、このアカウントからのすべての取引にガーディアンの共同署名が必要になります。Clip Walletはそれを用意できないため、Clip Walletからは送信できなくなります。",
  "bg.multiversx.unguardAccountTitle": "アカウントのガーディアンをオフにする",
  "bg.multiversx.changeOwnerTitle": "コントラクト{contract}を{owner}に譲渡",
  "bg.multiversx.changeOwnerWarn": "これにより{owner}がコントラクト{contract}の所有者になります。新しい所有者はコードを変更でき、中の資産を持ち出せます。本当に譲渡するつもりのときだけ実行してください。",
  "bg.multiversx.guardedAccount": "このアカウントにはガーディアンが設定されていて、Clip Walletはガーディアンの共同署名を取得できません。何も送信されていません。",
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
