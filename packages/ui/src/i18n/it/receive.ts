import type en from "../en/receive";
export default {
  "receive.title": "Ricevi",
  "receive.titleAsset": "Ricevi {symbol}",
  "receive.pick": "Cosa vuoi ricevere?",
  "receive.assetsList": "Asset che puoi ricevere",
  "receive.cantReceive": "Questo wallet non può ancora ricevere questo asset.",
  "receive.senderNetwork": "Dove si trova il mittente",
  "receive.networkMore": "{network} +{n, number}",
  "receive.qr": "Codice QR del tuo indirizzo {symbol}",
  "receive.copyAddress": "Copia indirizzo",
  "receive.manyNetworks": "Questo indirizzo riceve {symbol} su {networks}. Chiedi al mittente di usare una di queste reti.",
  "receive.oneNetwork": "Chiedi al mittente di inviare su {network}.",
} satisfies Record<keyof typeof en, string>;
