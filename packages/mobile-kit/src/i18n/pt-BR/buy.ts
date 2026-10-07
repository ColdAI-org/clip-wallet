import type en from "../en/buy";
export default {
  "m.buy.title": "Comprar",
  "m.buy.off": "A compra não está ativada nesta versão",
  "m.buy.offHint": "Você ainda pode receber cripto de outra pessoa.",
  "m.buy.what": "O que você quer comprar?",
  "m.buy.amountMissing": "Digite quanto quer gastar em {currency}.",
  "m.buy.buySymbol": "Comprar {symbol}",
  "m.buy.howMuch": "Quanto ({currency})",
  "m.buy.seeWays": "Ver formas de pagamento",
  "m.buy.continueWith": "Continuar com {provider}",
  "m.buy.finish": "Você conclui a compra na página do provedor. Ele pode pedir para verificar sua identidade.",
} satisfies Record<keyof typeof en, string>;
