import type N87 from "../../en/n87.js";

/** Spanish: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../es.ts and its glossary. */
const messages: { readonly [K in keyof typeof N87]: string } = {
  // ---- chains-cosmos (cosmos, provenance, thorchain, initia)
  // ---- end chains-cosmos
  // ---- chains-tron (tron)
  // ---- end chains-tron
  // ---- chains-xrpl (xrpl)
  // ---- end chains-xrpl
  // ---- chains-antelope (antelope)
  // ---- end chains-antelope
  // ---- chains-multiversx (multiversx)
  // ---- end chains-multiversx
  // ---- chains-icp (icp)
  // ---- end chains-icp
  // ---- chains-stacks (stacks)
  // ---- end chains-stacks
  // ---- chains-fuel (fuel)
  "bg.fuel.changeToOther": "Todo lo que quede de tu {symbol} después de esto va a {to}, no vuelve a ti.",
  "bg.fuel.leftoverLost": "{amount} no se envía a ningún sitio en esta transacción y se perdería.",
  "bg.fuel.coinsSpent": "Algunas de las monedas que usa esta transacción ya se gastaron. Pide a la app que lo intente de nuevo.",
  "bg.fuel.feeRose": "La comisión de red subió desde que se preparó esto. No se envió nada. Inténtalo de nuevo.",
  "bg.fuel.failedOnChain": "Esta transacción falló en la red Fuel. Solo se gastó la comisión de red.",
  "bg.fuel.tooManyCoins": "Esto necesita demasiadas monedas pequeñas a la vez. Envía primero una cantidad menor.",
  // ---- end chains-fuel
  // ---- chains-bitcoincash (bitcoincash)
  // ---- end chains-bitcoincash
  // ---- 1mask (networks87 providers) (1mask)
  // ---- end 1mask (networks87 providers)
  // ---- chains-evm
  "bg.label.networkCharge": "Cargo de la red",
  "bg.evm.flatFee": "{amount} por transacción, aunque falle",
  // ---- end chains-evm
};
export default messages;
