/** Namespace "m.collectibles" (mobile). */
export default {
  "m.collectibles.title": "Collectibles",
  /** Fallback name of an NFT: collection name and token number. */
  "m.collectibles.itemName": "{collection} #{tokenId}",
  "m.collectibles.tokenNumber": "#{tokenId}",
  "m.collectibles.collection": "Collection",
  "m.collectibles.token": "Token",
  "m.collectibles.network": "Network",
  "m.collectibles.filter.all": "Everything",
  "m.collectibles.filter.only": "Only {network}",
  "m.collectibles.empty.title": "No collectibles yet",
  "m.collectibles.empty.body": "Collectibles you own on any network show up here.",
  /** Group header: collection name and how many items. */
  "m.collectibles.group": "{name} · {n, number}",
} satisfies Record<`m.collectibles.${string}`, string>;
