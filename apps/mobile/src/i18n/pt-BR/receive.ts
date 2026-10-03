import type en from "../en/receive";
export default {
  "m.receive.pick": "O que você quer receber?",
  "m.receive.titleAsset": "Receber {symbol}",
  "m.receive.unsupported": "Esta carteira ainda não pode receber isso.",
  "m.receive.networksMore": "{network} +{n, number}",
  "m.receive.qr": "Código QR do seu endereço {symbol}",
  "m.receive.copyAddress": "Copiar endereço",
  "m.receive.manyNetworks": "Este endereço recebe {symbol} em {networks}. Peça a quem envia para usar uma dessas redes.",
  "m.receive.oneNetwork": "Peça a quem envia para enviar pela {network}.",
} satisfies Record<keyof typeof en, string>;
