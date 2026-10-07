import type en from "../en/receive";
export default {
  "m.receive.pick": "ما الذي تريد استلامه؟",
  "m.receive.titleAsset": "استلام \u2068{symbol}\u2069",
  "m.receive.unsupported": "لا يمكن لهذه المحفظة استلام ذلك بعد.",
  "m.receive.networksMore": "\u2068{network}\u2069 \u2068+{n, number}\u2069",
  "m.receive.qr": "رمز QR لعنوان \u2068{symbol}\u2069 الخاص بك",
  "m.receive.copyAddress": "نسخ العنوان",
  "m.receive.manyNetworks": "يستلم هذا العنوان \u2068{symbol}\u2069 على \u2068{networks}\u2069. اطلب من المُرسِل استخدام إحداها.",
  "m.receive.oneNetwork": "اطلب من المُرسِل الإرسال على \u2068{network}\u2069.",
} satisfies Record<keyof typeof en, string>;
