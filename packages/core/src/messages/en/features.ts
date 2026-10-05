/** Ids added while converting features (see ./index.ts for which packages). Family-prefixed: "bg.<family>.*". */
export default {
  "bg.swap.swapStep": "Swap",
  "bg.trade.accept": "Accept the trade",
  "bg.trade.offerTitle": "Secure Trade offer",
  // staking (step titles and options)
  "bg.staking.stakeHbar": "Stake your HBAR",
  "bg.staking.stopStakingHbar": "Stop staking HBAR",
  "bg.staking.abstain": "Abstain from votes",
  "bg.staking.noConfidence": "No confidence",
  "bg.staking.delegationOnly": "Delegation only (doesn't accept staking)",
  "bg.staking.moveStakeTo": "Move your stake to {name}",
  "bg.staking.stakeAdaWith": "Stake your ADA with {name}",
  "bg.staking.validator": "Validator {name}",
  "bg.staking.pool": "Pool {address}",
  "bg.staking.earnsAbout": "Earns about {percent} a year",
  "bg.staking.stakingEarnsAbout": "Staking earns about {percent} a year",
  "bg.staking.comingSoon": "Staking {symbol} is coming soon.",
  // swaps
  "bg.swap.priceImpact": "This swap moves the price by {percent}. You'd get noticeably less than the market price. Try a smaller amount.",
  "bg.swap.valueLoss": "You'd get about {percent} less value than you put in.",
  "bg.swap.highSlippage": "You allow the price to move up to {percent} before the swap stops. That's high.",
  // route
  "bg.route.payOnWith": "Pay {amount} on {network} with {symbol} from {source}",
  "bg.route.getFor": "Get {receive} for {deposit}",
  // security
  "bg.security.zeroValueTrick": "{address} only appears in your history from a zero-value transfer. That's a common trick to get you to copy a scammer's address.",
  "bg.security.couldntCheck": "Couldn't check {name} right now. Try again in a moment.",
  "bg.security.lookAlikeSite": "This site's name is almost the same as {site}, but it isn't {site}. Copies like this steal wallets.",
  "bg.security.blockaidMalicious": "Blockaid says this site is malicious. Don't connect or sign anything.",
  "bg.security.recentOnly": "On {network} only recent permissions could be checked. Older ones may still be there.",
  // trade
} as const;
