import type en from "../en/receive";
export default {
  "m.receive.pick": "Ne almak istiyorsunuz?",
  "m.receive.titleAsset": "{symbol} al",
  "m.receive.unsupported": "Bu cüzdan bunu henüz alamıyor.",
  "m.receive.networksMore": "{network} +{n, number}",
  "m.receive.qr": "{symbol} adresiniz için QR kodu",
  "m.receive.copyAddress": "Adresi kopyala",
  "m.receive.manyNetworks": "Bu adres {symbol} varlığını şu ağlarda alır: {networks}. Gönderenden bunlardan birini kullanmasını isteyin.",
  "m.receive.oneNetwork": "Gönderenden {network} ağında göndermesini isteyin.",
} satisfies Record<keyof typeof en, string>;
