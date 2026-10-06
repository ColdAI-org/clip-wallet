import type N87 from "../../en/n87.js";

/** German: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../de.ts and its glossary. */
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
  "bg.fuel.changeToOther": "Alles, was danach von deinem {symbol} übrig ist, geht an {to}, nicht zurück an dich.",
  "bg.fuel.leftoverLost": "{amount} wird von dieser Transaktion nirgendwohin gesendet und ginge verloren.",
  "bg.fuel.coinsSpent": "Einige der Coins, die diese Transaktion nutzt, wurden schon ausgegeben. Bitte die App, es noch einmal zu versuchen.",
  "bg.fuel.feeRose": "Die Netzwerkgebühr ist gestiegen, seit das vorbereitet wurde. Es wurde nichts gesendet. Versuch es noch einmal.",
  "bg.fuel.failedOnChain": "Diese Transaktion ist im Fuel-Netzwerk fehlgeschlagen. Nur die Netzwerkgebühr wurde bezahlt.",
  "bg.fuel.tooManyCoins": "Dafür werden zu viele kleine Coins auf einmal gebraucht. Sende zuerst einen kleineren Betrag.",
  // ---- end chains-fuel
  // ---- chains-bitcoincash (bitcoincash)
  // ---- end chains-bitcoincash
  // ---- 1mask (networks87 providers) (1mask)
  // ---- end 1mask (networks87 providers)
  // ---- chains-evm
  "bg.label.networkCharge": "Netzwerkabgabe",
  "bg.evm.flatFee": "{amount} pro Transaktion, auch wenn sie fehlschlägt",
  // ---- end chains-evm
};
export default messages;
