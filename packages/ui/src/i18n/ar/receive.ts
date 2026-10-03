import type en from "../en/receive";
export default {
  "receive.title": "استلام",
  "receive.titleAsset": "استلام {symbol}",
  "receive.pick": "ما الذي تريد استلامه؟",
  "receive.assetsList": "الأصول التي يمكنك استلامها",
  "receive.cantReceive": "لا يمكن لهذه المحفظة استلام ذلك بعد.",
  "receive.senderNetwork": "أين يوجد المُرسِل",
  "receive.networkMore": "{network} +{n, number}",
  "receive.qr": "رمز QR لعنوان {symbol} الخاص بك",
  "receive.copyAddress": "نسخ العنوان",
  "receive.manyNetworks": "يستلم هذا العنوان {symbol} على {networks}. اطلب من المُرسِل استخدام إحداها.",
  "receive.oneNetwork": "اطلب من المُرسِل الإرسال على {network}.",
} satisfies Record<keyof typeof en, string>;
