import type en from "../en/receive";
export default {
  "m.receive.pick": "Cosa vuoi ricevere?",
  "m.receive.titleAsset": "Ricevi {symbol}",
  "m.receive.unsupported": "Questo wallet non può ancora ricevere questo asset.",
  "m.receive.networksMore": "{network} +{n, number}",
  "m.receive.qr": "Codice QR del tuo indirizzo {symbol}",
  "m.receive.copyAddress": "Copia indirizzo",
  "m.receive.manyNetworks": "Questo indirizzo riceve {symbol} su {networks}. Chiedi al mittente di usare una di queste reti.",
  "m.receive.oneNetwork": "Chiedi al mittente di inviare su {network}.",
} satisfies Record<keyof typeof en, string>;
