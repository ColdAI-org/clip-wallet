/**
 * Paying with money from another network through a bonded Connector ("settle on Hedera"). Namespace "settle" (mobile; same wording as packages/ui/src/i18n/en/settle.ts).
 * {provider} is the Connector's name, {app} the app's name (never translated); {amount} is "13.05 USDC".
 */
export default {
  "m.settle.from": "Your other balance, through {provider}",
  "m.settle.step.allow": "Allow exactly {amount} for this payment",
  "m.settle.step.pay": "Pay {amount} to {provider}",
  "m.settle.step.deliver": "{provider} sends you {amount}",
  "m.settle.step.cover": "If it hasn't arrived by {time}, you're paid back {amount} on Hedera",
  "m.settle.settlement": "If the money doesn't arrive in time, {provider} pays you back on Hedera.",
  "m.settle.progress.paid": "Paid",
  "m.settle.progress.opened": "Order confirmed",
  "m.settle.progress.arrived": "Money arrived",
  "m.settle.progress.closed": "Settled",
  "m.settle.paying": "Sending your payment…",
  "m.settle.waiting": "Paid. Waiting for {provider} to confirm the order.",
  "m.settle.opened": "Order confirmed. {provider} is sending {amount}.",
  "m.settle.arrived": "{amount} arrived. Approve to finish.",
  "m.settle.appGone": "{amount} arrived, but {app} stopped waiting. Go back to {app} and try again.",
  "m.settle.keepOpen": "You can close this window. Your payment keeps going.",
  "m.settle.waitingButton": "Waiting for your money",
  "m.settle.late.title": "Your payment didn't arrive in time — you've been paid back {amount} on Hedera",
  "m.settle.late.hint": "Claim it with one tap. It goes to your account on Hedera.",
  "m.settle.late.claim": "Claim {amount}",
  "m.settle.claiming": "Claiming…",
  "m.settle.rejected": "Hedera didn't accept this order, so nothing stands behind it. Contact {provider}.",
  "m.settle.close": "Close",
} satisfies Record<`m.settle.${string}`, string>;
