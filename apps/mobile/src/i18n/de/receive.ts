import type en from "../en/receive";
export default {
  "m.receive.pick": "Was möchtest du empfangen?",
  "m.receive.titleAsset": "{symbol} empfangen",
  "m.receive.unsupported": "Dieses Wallet kann das noch nicht empfangen.",
  "m.receive.networksMore": "{network} +{n, number}",
  "m.receive.qr": "QR-Code für deine {symbol}-Adresse",
  "m.receive.copyAddress": "Adresse kopieren",
  "m.receive.manyNetworks": "Diese Adresse empfängt {symbol} auf {networks}. Bitte den Absender, eines davon zu nutzen.",
  "m.receive.oneNetwork": "Bitte den Absender, über {network} zu senden.",
} satisfies Record<keyof typeof en, string>;
