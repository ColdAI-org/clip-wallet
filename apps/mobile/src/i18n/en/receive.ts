/** Namespace "m.receive" (mobile). */
export default {
  "m.receive.pick": "What would you like to receive?",
  "m.receive.titleAsset": "Receive {symbol}",
  "m.receive.unsupported": "This wallet can't receive that yet.",
  /** Tab label when one address covers several networks: first network name and how many more. */
  "m.receive.networksMore": "{network} +{n, number}",
  "m.receive.qr": "QR code for your {symbol} address",
  "m.receive.copyAddress": "Copy address",
  /** {networks} is a comma-separated list of network names. */
  "m.receive.manyNetworks": "This address receives {symbol} on {networks}. Ask the sender to use one of these.",
  "m.receive.oneNetwork": "Ask the sender to send on {network}.",
} satisfies Record<`m.receive.${string}`, string>;
