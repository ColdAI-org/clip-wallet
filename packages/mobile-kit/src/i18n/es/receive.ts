import type en from "../en/receive";
export default {
  "m.receive.pick": "¿Qué quieres recibir?",
  "m.receive.titleAsset": "Recibir {symbol}",
  "m.receive.unsupported": "Esta billetera aún no puede recibir eso.",
  "m.receive.networksMore": "{network} +{n, number}",
  "m.receive.qr": "Código QR de tu dirección de {symbol}",
  "m.receive.copyAddress": "Copiar dirección",
  "m.receive.manyNetworks": "Esta dirección recibe {symbol} en {networks}. Pide a quien envía que use una de estas redes.",
  "m.receive.oneNetwork": "Pide a quien envía que lo haga en {network}.",
} satisfies Record<keyof typeof en, string>;
