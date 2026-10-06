/**
 * networks87 chain modules and their 1Mask providers ("bg.<family>.*", plain {arguments} only). One section per
 * package: keep each package's ids between its markers (translations: ../locales/n87/<code>.ts, same sections).
 */
export default {
  // ---- chains-cosmos (cosmos, provenance, thorchain, initia)
  // ---- end chains-cosmos
  // ---- chains-tron (tron)
  "bg.tron.notControlled": "This TRON account is controlled by another key, so Clip Wallet can't sign for it.",
  "bg.tron.notOpen": "Your TRON account isn't open yet. Receive some TRX first.",
  "bg.tron.contractRecipient": "TRX can't be sent straight to a smart contract.",
  "bg.tron.newAccountFee": "This address isn't open on TRON yet. Sending to it also costs {amount} to open it.",
  "bg.tron.getsSigned": "{host} (it gets the signed transaction)",
  "bg.tron.energy": "energy",
  "bg.tron.bandwidth": "bandwidth",
  "bg.tron.tronPower": "voting power",
  "bg.tron.stakeFor": "Stake {amount} for {resource}",
  "bg.tron.days": "{count} days",
  "bg.tron.cancelUnstaking": "Cancel your pending unstaking and stake that TRX again",
  "bg.tron.lend": "Lend the {resource} of {amount} you've staked to {to}",
  "bg.tron.stopLending": "Take back the {resource} of {amount} you lent to {to}",
  "bg.tron.lockedHours": "About {hours} hours. You can't take it back before then.",
  "bg.tron.vote": "Vote for {count} Super Representatives",
  "bg.tron.votesReplace": "This replaces all your earlier votes.",
  "bg.tron.claimVoteRewards": "Claim your voting rewards",
  "bg.tron.changePermissions": "Change who controls your TRON account",
  "bg.tron.keysThreshold": "{keys} (needs {threshold})",
  // ---- end chains-tron
  // ---- chains-xrpl (xrpl)
  // ---- end chains-xrpl
  // ---- chains-antelope (antelope)
  // ---- end chains-antelope
  // ---- chains-multiversx (multiversx)
  "bg.multiversx.claimRewardsFrom": "Claim your staking rewards from {validator}",
  "bg.multiversx.withdrawFrom": "Withdraw your unstaked EGLD from {validator}",
  "bg.multiversx.restakeRewardsWith": "Restake your rewards with {validator}",
  "bg.multiversx.labelGuardian": "Guardian",
  "bg.multiversx.setGuardianTitle": "Make {guardian} your account's guardian",
  "bg.multiversx.setGuardianWarn": "Once a guardian is active, every transaction from this account needs its co-signature. If you didn't choose {guardian}, someone could lock you out of your account.",
  "bg.multiversx.guardAccountTitle": "Turn on your account's guardian",
  "bg.multiversx.guardAccountWarn": "From now on every transaction from this account needs the guardian's co-signature. Clip Wallet can't provide it, so you won't be able to send from Clip Wallet any more.",
  "bg.multiversx.unguardAccountTitle": "Turn off your account's guardian",
  "bg.multiversx.changeOwnerTitle": "Give contract {contract} to {owner}",
  "bg.multiversx.changeOwnerWarn": "This makes {owner} the owner of contract {contract}. The new owner can change its code and take what it holds. Only do this if you mean to give it away.",
  "bg.multiversx.guardedAccount": "This account has a guardian, and Clip Wallet can't get the guardian's co-signature. Nothing was sent.",
  // ---- end chains-multiversx
  // ---- chains-icp (icp)
  "bg.icp.toAccountId": "This sends to an account ID, the kind of deposit address exchanges give. Check that it matches exactly what the exchange shows.",
  "bg.icp.expired": "This transfer expired before you approved it. Nothing was sent. Try again.",
  // ---- end chains-icp
  // ---- chains-stacks (stacks)
  "bg.stacks.postCondition": "Post-condition",
  "bg.stacks.pcYouSendExactly": "You send exactly {amount}",
  "bg.stacks.pcYouSendAtMost": "You send at most {amount}",
  "bg.stacks.pcYouSendAtLeast": "You send at least {amount}",
  "bg.stacks.pcYouSendMoreThan": "You send more than {amount}",
  "bg.stacks.pcYouSendLessThan": "You send less than {amount}",
  "bg.stacks.pcSendsExactly": "{who} sends exactly {amount}",
  "bg.stacks.pcSendsAtMost": "{who} sends at most {amount}",
  "bg.stacks.pcSendsAtLeast": "{who} sends at least {amount}",
  "bg.stacks.pcSendsMoreThan": "{who} sends more than {amount}",
  "bg.stacks.pcSendsLessThan": "{who} sends less than {amount}",
  "bg.stacks.pcYouSendNft": "You send {item}",
  "bg.stacks.pcYouKeepNft": "You keep {item}",
  "bg.stacks.pcYouMaySendNft": "You may send {item}",
  "bg.stacks.pcSendsNft": "{who} sends {item}",
  "bg.stacks.pcKeepsNft": "{who} keeps {item}",
  "bg.stacks.pcMaySendNft": "{who} may send {item}",
  "bg.stacks.pcStakingRule": "A staking rule for {who}",
  "bg.stacks.allowMode": "This lets the contract move any of your assets, not only the ones listed. Only approve it if you trust {host} completely.",
  "bg.stacks.originatorMode": "Only the transfers listed can leave your account. The contract may still move other accounts' assets.",
  "bg.stacks.nothingLeaves": "None of your assets can leave your account in this transaction, apart from the network fee.",
  "bg.stacks.highFee": "The network fee is {fee}, which is unusually high.",
  "bg.stacks.sponsorPays": "A sponsor chosen by {host}",
  "bg.stacks.deployNamed": "Create the smart contract {name}",
  "bg.stacks.notYourTx": "This transaction is signed by a different Stacks account, so Clip Wallet can't sign it.",
  "bg.stacks.multisig": "Clip Wallet can't sign for shared (multi-signature) Stacks accounts yet.",
  "bg.stacks.memoTooLong": "The memo is too long. A Stacks memo holds up to 34 bytes.",
  "bg.stacks.feeTooLow": "The network fee was too low, so the network didn't take it. Nothing was sent. Try again.",
  "bg.stacks.nonceBusy": "Another transaction from this account is still waiting. Wait for it to finish, then try again.",
  "bg.stacks.otherNetworkTx": "This transaction is for a different Stacks network, so it wasn't sent.",
  "bg.stacks.badContractCall": "The app's contract call doesn't match the contract on the network. Nothing was sent.",
  "bg.stacks.tooManyPending": "This account has too many transactions waiting. Wait for some to finish, then try again.",
  "bg.stacks.signatureRefused": "The network didn't accept the signature. Nothing was sent.",
  "bg.stacks.testAddressOnMainnet": "That's a Stacks test-network address (ST…). Use a mainnet address (SP…).",
  "bg.stacks.mainAddressOnTestnet": "That's a Stacks mainnet address (SP…). Use a test-network address (ST…).",
  "bg.stacks.notAnAddress": "That doesn't look like a Stacks address.",
  "bg.stacks.needStxForFee": "You need a little STX to pay the network fee.",
  // ---- end chains-stacks
  // ---- chains-fuel (fuel)
  "bg.fuel.changeToOther": "Everything left of your {symbol} after this goes to {to}, not back to you.",
  "bg.fuel.leftoverLost": "{amount} isn't sent anywhere by this transaction and would be lost.",
  "bg.fuel.coinsSpent": "Some of the coins this transaction uses were already spent. Ask the app to try again.",
  "bg.fuel.feeRose": "The network fee went up since this was prepared. Nothing was sent. Try again.",
  "bg.fuel.failedOnChain": "This transaction failed on the Fuel network. Only the network fee was spent.",
  "bg.fuel.tooManyCoins": "This needs too many small coins at once. Send a smaller amount first.",
  // ---- end chains-fuel
  // ---- chains-bitcoincash (bitcoincash)
  // ---- end chains-bitcoincash
  // ---- 1mask (networks87 providers) (1mask)
  // ---- end 1mask (networks87 providers)
  // ---- chains-evm (networks87: STRATO)
  "bg.label.networkCharge": "Network charge",
  "bg.evm.flatFee": "{amount} per transaction, even if it fails",
  // ---- end chains-evm
} as const;
