import type en from "../en/receive";
export default {
  "receive.title": "Recevoir",
  "receive.titleAsset": "Recevoir {symbol}",
  "receive.pick": "Que voulez-vous recevoir ?",
  "receive.assetsList": "Actifs que vous pouvez recevoir",
  "receive.cantReceive": "Ce portefeuille ne peut pas encore recevoir cet actif.",
  "receive.senderNetwork": "Où se trouve l'expéditeur",
  "receive.networkMore": "{network} +{n, number}",
  "receive.qr": "Code QR de votre adresse {symbol}",
  "receive.copyAddress": "Copier l'adresse",
  "receive.manyNetworks": "Cette adresse peut recevoir des {symbol} sur {networks}. Demandez à l'expéditeur d'utiliser l'un de ces réseaux.",
  "receive.oneNetwork": "Demandez à l'expéditeur d'envoyer sur {network}.",
} satisfies Record<keyof typeof en, string>;
