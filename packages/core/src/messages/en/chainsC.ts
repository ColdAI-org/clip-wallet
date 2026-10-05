/** Ids added while converting chainsC (see ./index.ts for which packages). Family-prefixed: "bg.<family>.*". */
export default {
  // chains-stellar
  "bg.stellar.cancelOffer": "Cancel an offer",
  "bg.stellar.claimBalance": "Claim a balance sent to you",
  "bg.stellar.finishSponsorship": "Finish a reserve sponsorship",
  "bg.stellar.keepData": "Keep smart contract data from expiring",
  "bg.stellar.bumpSequence": "Move your account's transaction counter forward",
  "bg.stellar.restoreData": "Restore archived smart contract data",
  "bg.stellar.inflation": "Run inflation (no longer does anything)",
  "bg.stellar.clawbackBalance": "Take back a claimable balance (issuer)",
  "bg.stellar.unknownAction": "Unknown Stellar action",
  "bg.stellar.unknownContractAction": "Unknown smart contract action",
  "bg.stellar.addLiquidity": "Add funds to a liquidity pool",
  "bg.stellar.removeLiquidity": "Withdraw funds from a liquidity pool",
  "bg.stellar.rejected": "Stellar rejected this transaction. Nothing was sent.",
  // chains-substrate
  "bg.substrate.nestedActions": "{count} nested actions",
  "bg.substrate.emptiesBalance": "This empties your {symbol} balance.",
  "bg.substrate.buyGoesTo": "The tokens you buy go to {to}, not to you.",
  "bg.substrate.unknownAsset": "Clip Wallet doesn't know asset #{id}. Check it's the one you mean.",
  // chains-sui
  "bg.sui.unstake": "Unstake SUI",
  // chains-tezos
  "bg.tezos.approveOperation": "Approve a Tezos operation",
  "bg.tezos.shareAddress": "Share your Tezos address with {host}",
  "bg.tezos.delegateXtzTo": "Delegate your XTZ to {name}",
  "bg.tezos.stopDelegatingXtz": "Stop delegating your XTZ",
  "bg.tezos.withdrawUnstaked": "Withdraw your unstaked XTZ",
  "bg.tezos.canTakeAll": "{spender} can take all your {symbol}, now or later, without asking again.",
  "bg.tezos.canTakeUpTo": "{spender} can take up to {amount} without asking again.",
  "bg.tezos.highFee": "The network fee is {fee}, which is unusually high.",
  "bg.tezos.messageMentions": "This message mentions {other}, but the request comes from {host}. It may be a phishing site.",
  // chains-ton
  "bg.ton.sendToAppContract": "Send {amount} to an app contract",
  "bg.ton.sendTokensFrom": "Send tokens from {from}",
  "bg.ton.burn": "Burn {amount}",
  "bg.ton.testAddressOnMainnet": "{address} is marked as a test-network address, but this is real TON.",
  "bg.stellar.sendAndOpen": "Send {amount} to {to} and open their account",
  "bg.stellar.alsoOpens": "This also opens their Stellar account; it needs at least 1 XLM.",
  "bg.tezos.revealLine": "First transaction from this account: it also publishes your account's public key (a one-time step).",
  "bg.tezos.allUnstakedReady": "All unstaked XTZ that is ready",
} as const;
