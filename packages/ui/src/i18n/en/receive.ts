/** Receive: asset picker and address. Namespace "receive". */
export default {
  "receive.title": "Receive",
  "receive.titleAsset": "Receive {symbol}",
  "receive.pick": "What would you like to receive?",
  "receive.assetsList": "Assets you can receive",
  "receive.cantReceive": "This wallet can't receive that yet.",
  "receive.senderNetwork": "Where the sender is",
  "receive.networkMore": "{network} +{n, number}",
  "receive.qr": "QR code for your {symbol} address",
  "receive.copyAddress": "Copy address",
  "receive.manyNetworks": "This address receives {symbol} on {networks}. Ask the sender to use one of these.",
  "receive.oneNetwork": "Ask the sender to send on {network}.",
} satisfies Record<`receive.${string}`, string>;
