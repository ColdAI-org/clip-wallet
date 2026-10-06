import type N87 from "../../en/n87.js";

/** Italian: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../it.ts and its glossary. */
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
  "bg.fuel.changeToOther": "Tutto ciò che resta dei tuoi {symbol} dopo questa operazione va a {to}, non torna a te.",
  "bg.fuel.leftoverLost": "{amount} non viene inviato da nessuna parte da questa transazione e andrebbe perso.",
  "bg.fuel.coinsSpent": "Alcune delle monete usate da questa transazione sono già state spese. Chiedi all'app di riprovare.",
  "bg.fuel.feeRose": "La commissione di rete è aumentata da quando è stata preparata. Non è stato inviato nulla. Riprova.",
  "bg.fuel.failedOnChain": "Questa transazione non è andata a buon fine sulla rete Fuel. È stata pagata solo la commissione di rete.",
  "bg.fuel.tooManyCoins": "Servono troppe monete piccole tutte insieme. Invia prima un importo più piccolo.",
  // ---- end chains-fuel
  // ---- chains-bitcoincash (bitcoincash)
  // ---- end chains-bitcoincash
  // ---- 1mask (networks87 providers) (1mask)
  // ---- end 1mask (networks87 providers)
  // ---- chains-evm
  "bg.label.networkCharge": "Addebito della rete",
  "bg.evm.flatFee": "{amount} per transazione, anche se non va a buon fine",
  // ---- end chains-evm
};
export default messages;
