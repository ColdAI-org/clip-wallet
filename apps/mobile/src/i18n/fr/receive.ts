import type en from "../en/receive";
export default {
  "m.receive.pick": "Que voulez-vous recevoir ?",
  "m.receive.titleAsset": "Recevoir {symbol}",
  "m.receive.unsupported": "Ce portefeuille ne peut pas encore recevoir cet actif.",
  "m.receive.networksMore": "{network} +{n, number}",
  "m.receive.qr": "Code QR de votre adresse {symbol}",
  "m.receive.copyAddress": "Copier l'adresse",
  "m.receive.manyNetworks": "Cette adresse peut recevoir des {symbol} sur {networks}. Demandez à l'expéditeur d'utiliser l'un de ces réseaux.",
  "m.receive.oneNetwork": "Demandez à l'expéditeur d'envoyer sur {network}.",
} satisfies Record<keyof typeof en, string>;
