import type en from "../en/buy";
export default {
  "m.buy.title": "Comprar",
  "m.buy.off": "La compra no está activada en esta versión",
  "m.buy.offHint": "Aún puedes recibir criptomonedas de otra persona.",
  "m.buy.what": "¿Qué quieres comprar?",
  "m.buy.amountMissing": "Escribe cuánto quieres gastar en {currency}.",
  "m.buy.buySymbol": "Comprar {symbol}",
  "m.buy.howMuch": "Cuánto ({currency})",
  "m.buy.seeWays": "Ver formas de pago",
  "m.buy.continueWith": "Continuar con {provider}",
  "m.buy.finish": "Terminas la compra en la página del proveedor. Puede que te pida verificar tu identidad.",
} satisfies Record<keyof typeof en, string>;
