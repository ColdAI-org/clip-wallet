import type en from "../en/receive";
export default {
  "receive.title": "प्राप्त करें",
  "receive.titleAsset": "{symbol} प्राप्त करें",
  "receive.pick": "आप क्या प्राप्त करना चाहेंगे?",
  "receive.assetsList": "एसेट जो आप प्राप्त कर सकते हैं",
  "receive.cantReceive": "यह वॉलेट अभी इसे प्राप्त नहीं कर सकता।",
  "receive.senderNetwork": "भेजने वाला कहां है",
  "receive.networkMore": "{network} +{n, number}",
  "receive.qr": "आपके {symbol} एड्रेस का QR कोड",
  "receive.copyAddress": "एड्रेस कॉपी करें",
  "receive.manyNetworks": "यह एड्रेस {networks} पर {symbol} प्राप्त करता है। भेजने वाले से इनमें से कोई एक इस्तेमाल करने को कहें।",
  "receive.oneNetwork": "भेजने वाले से {network} पर भेजने को कहें।",
} satisfies Record<keyof typeof en, string>;
