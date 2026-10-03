import type en from "../en/buy";
export default {
  "buy.title": "Comprar",
  "buy.titleAsset": "Comprar {symbol}",
  "buy.off.title": "A compra não está ativada nesta versão",
  "buy.off.body": "Você ainda pode receber cripto de outra pessoa.",
  "buy.what": "O que você quer comprar?",
  "buy.whatLabel": "O que você pode comprar",
  "buy.howMuch": "Quanto ({currency})",
  "buy.amountBad": "Digite quanto quer gastar em {currency}.",
  "buy.seeWays": "Ver formas de pagamento",
  "buy.continueWith": "Continuar com {provider}",
  "buy.finishOnProvider": "Você conclui a compra no site do provedor. Ele pode pedir para verificar sua identidade.",
} satisfies Record<keyof typeof en, string>;
