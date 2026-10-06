/** Namespace "m.home" (mobile): Home and asset detail. */
export default {
  "m.home.lock": "Lock wallet",
  "m.home.pending": "{n, plural, one {# request is waiting for you} other {# requests are waiting for you}}",
  "m.home.total": "Total balance",
  "m.home.bridged": "bridged",
  "m.home.empty.title": "Nothing here yet",
  "m.home.empty.body": "Tap Receive to add money from another wallet or exchange.",
  "m.home.hideSmall": "Hide small balances",
  "m.home.spam.hide": "Hide suspicious tokens",
  "m.home.spam.hidden": "{n, plural, one {# suspicious token hidden} other {# suspicious tokens hidden}}",
  "m.home.stale": "Some balances may be a few minutes old.",

  "m.home.asset.title": "Asset",
  "m.home.asset.gone": "You don't hold this anymore",
  "m.home.asset.pin": "Pin",
  "m.home.asset.unpin": "Unpin",
  "m.home.asset.bridgedCopy": "bridged copy — not the original {symbol}",
  "m.home.asset.where": "Where it is",
  "m.home.asset.whereHint": "You don't need to manage this — {symbol} is spent from wherever it is.",
  /** {network} is a network name, e.g. "Base". */
  "m.home.asset.contract": "Contract ({network})",
  "m.home.moreActions": "More actions",
  "m.home.swap": "Swap",
  "m.home.buy": "Buy",
  "m.home.stake": "Stake",
} satisfies Record<`m.home.${string}`, string>;
