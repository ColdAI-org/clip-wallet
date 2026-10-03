import type en from "../en/receive";
export default {
  "m.receive.pick": "ما الذي تريد استلامه؟",
  "m.receive.titleAsset": "استلام {symbol}",
  "m.receive.unsupported": "لا يمكن لهذه المحفظة استلام ذلك بعد.",
  "m.receive.networksMore": "{network} +{n, number}",
  "m.receive.qr": "رمز QR لعنوان {symbol} الخاص بك",
  "m.receive.copyAddress": "نسخ العنوان",
  "m.receive.manyNetworks": "يستلم هذا العنوان {symbol} على {networks}. اطلب من المُرسِل استخدام إحداها.",
  "m.receive.oneNetwork": "اطلب من المُرسِل الإرسال على {network}.",
} satisfies Record<keyof typeof en, string>;
