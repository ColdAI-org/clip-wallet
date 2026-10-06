/** Namespace "m.send" (mobile): the Send screen. Same English as the extension's "send" namespace. */
export default {
  "m.send.title": "Send",
  "m.send.nothing": "There's nothing to send yet. Receive some test coins first.",
  "m.send.what": "What",
  "m.send.assetLabel": "Asset to send",
  "m.send.choose": "Choose",
  /** An asset that is a bridged copy, e.g. "USDC (bridged)". */
  "m.send.assetBridged": "{symbol} (bridged)",
  "m.send.to": "To",
  "m.send.toPlaceholder": "Name or address",
  "m.send.toContact": "{name} (from your contacts)",
  "m.send.amount": "Amount",
  "m.send.amountBad": "Enter an amount like 25 or 0.5.",
  "m.send.youHaveOnly": "You have {amount} {symbol}.",
  "m.send.youHave": "You have {amount} {symbol}",
  "m.send.approx": "≈ {value}",
  "m.send.review": "Review",
  "m.send.preparing": "Preparing…",
  "m.send.preparingRequest": "Preparing your request…",
  "m.send.ask.title": "Where should the {symbol} arrive?",
  /** {who} is a contact name, a resolved name, or a shortened address. */
  "m.send.ask.lede": "{who} can receive {symbol} in more than one place. If it's an exchange or someone else's wallet, ask them which network to use — sending to the wrong one can lose the money.",
  "m.send.ask.haveThere": "You have {amount} {symbol} there",
  "m.send.ask.moveThere": "We'll move your {symbol} there for you",
  "m.send.ask.rememberName": "We'll remember this for {name} so you won't be asked again.",
  "m.send.ask.rememberAddress": "We'll remember this for this address so you won't be asked again.",
} satisfies Record<`m.send.${string}`, string>;
