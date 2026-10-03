import type en from "../en/receive";
export default {
  "receive.title": "Empfangen",
  "receive.titleAsset": "{symbol} empfangen",
  "receive.pick": "Was möchtest du empfangen?",
  "receive.assetsList": "Assets, die du empfangen kannst",
  "receive.cantReceive": "Dieses Wallet kann das noch nicht empfangen.",
  "receive.senderNetwork": "Wo der Absender ist",
  "receive.networkMore": "{network} +{n, number}",
  "receive.qr": "QR-Code für deine {symbol}-Adresse",
  "receive.copyAddress": "Adresse kopieren",
  "receive.manyNetworks": "Diese Adresse empfängt {symbol} auf {networks}. Bitte den Absender, eines davon zu nutzen.",
  "receive.oneNetwork": "Bitte den Absender, über {network} zu senden.",
} satisfies Record<keyof typeof en, string>;
