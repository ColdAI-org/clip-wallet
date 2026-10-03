import type en from "../en/receive";
export default {
  "receive.title": "Recibir",
  "receive.titleAsset": "Recibir {symbol}",
  "receive.pick": "¿Qué quieres recibir?",
  "receive.assetsList": "Activos que puedes recibir",
  "receive.cantReceive": "Esta billetera aún no puede recibir eso.",
  "receive.senderNetwork": "Dónde está quien envía",
  "receive.networkMore": "{network} +{n, number}",
  "receive.qr": "Código QR de tu dirección de {symbol}",
  "receive.copyAddress": "Copiar dirección",
  "receive.manyNetworks": "Esta dirección recibe {symbol} en {networks}. Pide a quien envía que use una de estas redes.",
  "receive.oneNetwork": "Pide a quien envía que lo haga en {network}.",
} satisfies Record<keyof typeof en, string>;
