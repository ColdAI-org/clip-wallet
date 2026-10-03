import type en from "../en/buy";
export default {
  "buy.title": "Acheter",
  "buy.titleAsset": "Acheter {symbol}",
  "buy.off.title": "L'achat n'est pas activé dans cette version",
  "buy.off.body": "Vous pouvez toujours recevoir des cryptos de quelqu'un d'autre.",
  "buy.what": "Que voulez-vous acheter ?",
  "buy.whatLabel": "Ce que vous pouvez acheter",
  "buy.howMuch": "Montant ({currency})",
  "buy.amountBad": "Indiquez combien vous voulez dépenser en {currency}.",
  "buy.seeWays": "Voir les moyens de paiement",
  "buy.continueWith": "Continuer avec {provider}",
  "buy.finishOnProvider": "Vous finalisez l'achat sur le site du prestataire. Il peut vous demander de vérifier votre identité.",
} satisfies Record<keyof typeof en, string>;
