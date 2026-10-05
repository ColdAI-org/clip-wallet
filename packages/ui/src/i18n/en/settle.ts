/**
 * Paying with money from another network through a bonded Connector ("settle on Hedera"). Namespace "settle".
 * {provider} is the Connector's name, {app} the app's name (never translated); {amount} is "13.05 USDC".
 */
export default {
  "settle.from": "Your other balance, through {provider}",
  "settle.step.allow": "Allow exactly {amount} for this payment",
  "settle.step.pay": "Pay {amount} to {provider}",
  "settle.step.deliver": "{provider} sends you {amount}",
  "settle.step.cover": "If it hasn't arrived by {time}, you're paid back {amount} on Hedera",
  "settle.settlement": "If the money doesn't arrive in time, {provider} pays you back on Hedera.",
  "settle.progress.paid": "Paid",
  "settle.progress.opened": "Order confirmed",
  "settle.progress.arrived": "Money arrived",
  "settle.progress.closed": "Settled",
  "settle.paying": "Sending your payment…",
  "settle.waiting": "Paid. Waiting for {provider} to confirm the order.",
  "settle.opened": "Order confirmed. {provider} is sending {amount}.",
  "settle.arrived": "{amount} arrived. Approve to finish.",
  "settle.appGone": "{amount} arrived, but {app} stopped waiting. Go back to {app} and try again.",
  "settle.keepOpen": "You can close this window. Your payment keeps going.",
  "settle.waitingButton": "Waiting for your money",
  "settle.late.title": "Your payment didn't arrive in time — you've been paid back {amount} on Hedera",
  "settle.late.hint": "Claim it with one tap. It goes to your account on Hedera.",
  "settle.late.claim": "Claim {amount}",
  "settle.claiming": "Claiming…",
  "settle.rejected": "Hedera didn't accept this order, so nothing stands behind it. Contact {provider}.",
  "settle.close": "Close",
} satisfies Record<`settle.${string}`, string>;
