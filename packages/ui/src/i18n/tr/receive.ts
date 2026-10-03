import type en from "../en/receive";
export default {
  "receive.title": "Al",
  "receive.titleAsset": "{symbol} al",
  "receive.pick": "Ne almak istiyorsunuz?",
  "receive.assetsList": "Alabileceğiniz varlıklar",
  "receive.cantReceive": "Bu cüzdan bunu henüz alamıyor.",
  "receive.senderNetwork": "Gönderenin bulunduğu ağ",
  "receive.networkMore": "{network} +{n, number}",
  "receive.qr": "{symbol} adresiniz için QR kodu",
  "receive.copyAddress": "Adresi kopyala",
  "receive.manyNetworks": "Bu adres {symbol} varlığını şu ağlarda alır: {networks}. Gönderenden bunlardan birini kullanmasını isteyin.",
  "receive.oneNetwork": "Gönderenden {network} ağında göndermesini isteyin.",
} satisfies Record<keyof typeof en, string>;
