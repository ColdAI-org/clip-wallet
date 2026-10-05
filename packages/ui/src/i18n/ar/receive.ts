import type en from "../en/receive";
export default {
  "receive.title": "استلام",
  "receive.titleAsset": "استلام \u2068{symbol}\u2069",
  "receive.pick": "ما الذي تريد استلامه؟",
  "receive.assetsList": "الأصول التي يمكنك استلامها",
  "receive.cantReceive": "لا يمكن لهذه المحفظة استلام ذلك بعد.",
  "receive.senderNetwork": "أين يوجد المُرسِل",
  "receive.networkMore": "\u2068{network}\u2069 \u2068+{n, number}\u2069",
  "receive.qr": "رمز QR لعنوان \u2068{symbol}\u2069 الخاص بك",
  "receive.copyAddress": "نسخ العنوان",
  "receive.manyNetworks": "يستلم هذا العنوان \u2068{symbol}\u2069 على \u2068{networks}\u2069. اطلب من المُرسِل استخدام إحداها.",
  "receive.oneNetwork": "اطلب من المُرسِل الإرسال على \u2068{network}\u2069.",
} satisfies Record<keyof typeof en, string>;
