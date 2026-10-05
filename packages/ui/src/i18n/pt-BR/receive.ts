import type en from "../en/receive";
export default {
  "receive.title": "Receber",
  "receive.titleAsset": "Receber {symbol}",
  "receive.pick": "O que você quer receber?",
  "receive.assetsList": "Ativos que você pode receber",
  "receive.cantReceive": "Esta carteira ainda não pode receber isso.",
  "receive.senderNetwork": "Onde está quem envia",
  "receive.networkMore": "{network} +{n, number}",
  "receive.qr": "Código QR do seu endereço {symbol}",
  "receive.copyAddress": "Copiar endereço",
  "receive.manyNetworks": "Este endereço recebe {symbol} em {networks}. Peça a quem envia para usar uma dessas redes.",
  "receive.oneNetwork": "Peça a quem envia para enviar pela rede {network}.",
} satisfies Record<keyof typeof en, string>;
