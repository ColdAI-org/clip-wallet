import type en from "../en/buy";
export default {
  "buy.title": "Compra",
  "buy.titleAsset": "Compra {symbol}",
  "buy.off.title": "L'acquisto non è attivo in questa build",
  "buy.off.body": "Puoi comunque ricevere cripto da qualcun altro.",
  "buy.what": "Cosa vuoi comprare?",
  "buy.whatLabel": "Cosa puoi comprare",
  "buy.howMuch": "Quanto ({currency})",
  "buy.amountBad": "Inserisci quanto vuoi spendere in {currency}.",
  "buy.seeWays": "Vedi i metodi di pagamento",
  "buy.continueWith": "Continua con {provider}",
  "buy.finishOnProvider": "Completi l'acquisto sul sito del fornitore, che potrebbe chiederti di verificare la tua identità.",
} satisfies Record<keyof typeof en, string>;
