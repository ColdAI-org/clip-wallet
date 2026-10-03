import type en from "../en/buy";
export default {
  "m.buy.title": "Acheter",
  "m.buy.off": "L'achat n'est pas activé dans cette version",
  "m.buy.offHint": "Vous pouvez toujours recevoir des cryptos de quelqu'un d'autre.",
  "m.buy.what": "Que voulez-vous acheter ?",
  "m.buy.amountMissing": "Indiquez combien vous voulez dépenser en {currency}.",
  "m.buy.buySymbol": "Acheter {symbol}",
  "m.buy.howMuch": "Montant ({currency})",
  "m.buy.seeWays": "Voir les moyens de paiement",
  "m.buy.continueWith": "Continuer avec {provider}",
  "m.buy.finish": "Vous finalisez l'achat sur la page du fournisseur. Il peut vous demander de vérifier votre identité.",
} satisfies Record<keyof typeof en, string>;
