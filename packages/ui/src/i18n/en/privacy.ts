/**
 * Settings → Your data: the in-app data-use disclosure (docs/legal/privacy-policy.md is the long version).
 * Namespace "privacy". Shared with the mobile app through PRIVACY_CATALOGS (src/i18n/privacy.ts).
 * Keep it true: update this and the policy together whenever the wallet starts contacting something new.
 */
export default {
  "privacy.menu": "Your data",
  "privacy.title": "Your data",
  "privacy.lede": "{name} has no account for you. Your recovery phrase and keys stay on this device, locked with your password. We never see them.",
  "privacy.device.title": "Stays on this device",
  "privacy.device.body": "Your recovery phrase, private keys, password, contacts, settings and activity. None of it is sent to us.",
  "privacy.network.title": "What the wallet looks up",
  "privacy.network.body": "To show balances and send payments, the wallet asks public network services (nodes and indexers) about your public addresses. Prices come from CoinGecko and DEX Screener.",
  "privacy.scam.title": "Scam checks",
  "privacy.scam.body": "Open scam lists are downloaded to this device and checked here, so they never learn which sites you visit. If this version has Blockaid switched on, Blockaid sees the site, the request and your address.",
  "privacy.partners.title": "Only when you use them",
  "privacy.partners.body": "Swap, buy and stake send your address and the amount to the provider you choose, and their own privacy policy applies.",
  "privacy.backup.title": "Passkey backup, if you turn it on",
  "privacy.backup.body": "Our backup service stores a locked copy that only your passkey can open, and a keyed hash of your email or your Google or Apple account so you can find it again. Delete it at any time.",
  "privacy.media.title": "Collectible pictures",
  "privacy.media.body": "Pictures load through our media proxy, so the sites that host them never see your device. We don't keep a record of who asked.",
  "privacy.never.title": "Never",
  "privacy.never.body": "No analytics, no ads, no tracking, and we never sell data.",
};
