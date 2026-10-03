import type en from "../en/receive";
export default {
  "m.receive.pick": "आप क्या प्राप्त करना चाहेंगे?",
  "m.receive.titleAsset": "{symbol} प्राप्त करें",
  "m.receive.unsupported": "यह वॉलेट अभी इसे प्राप्त नहीं कर सकता।",
  "m.receive.networksMore": "{network} +{n, number}",
  "m.receive.qr": "आपके {symbol} एड्रेस का QR कोड",
  "m.receive.copyAddress": "एड्रेस कॉपी करें",
  "m.receive.manyNetworks": "यह एड्रेस {networks} पर {symbol} प्राप्त करता है। भेजने वाले से इनमें से कोई एक इस्तेमाल करने को कहें।",
  "m.receive.oneNetwork": "भेजने वाले से {network} पर भेजने को कहें।",
} satisfies Record<keyof typeof en, string>;
