import type en from "../en/buy";
export default {
  "buy.title": "Comprar",
  "buy.titleAsset": "Comprar {symbol}",
  "buy.off.title": "La compra no está activada en esta versión",
  "buy.off.body": "Aún puedes recibir criptomonedas de otra persona.",
  "buy.what": "¿Qué quieres comprar?",
  "buy.whatLabel": "Lo que puedes comprar",
  "buy.howMuch": "Cuánto ({currency})",
  "buy.amountBad": "Escribe cuánto quieres gastar en {currency}.",
  "buy.seeWays": "Ver formas de pago",
  "buy.continueWith": "Continuar con {provider}",
  "buy.finishOnProvider": "Terminas la compra en el sitio del proveedor. Puede que te pida verificar tu identidad.",
} satisfies Record<keyof typeof en, string>;
