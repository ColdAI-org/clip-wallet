import type N87 from "../../en/n87.js";

/** French: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../fr.ts and its glossary. */
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
  "bg.fuel.changeToOther": "Tout ce qui reste de votre {symbol} après ceci va à {to}, et ne vous revient pas.",
  "bg.fuel.leftoverLost": "{amount} n'est envoyé nulle part par cette transaction et serait perdu.",
  "bg.fuel.coinsSpent": "Certaines des pièces utilisées par cette transaction ont déjà été dépensées. Demandez à l'app de réessayer.",
  "bg.fuel.feeRose": "Les frais de réseau ont augmenté depuis la préparation. Rien n'a été envoyé. Réessayez.",
  "bg.fuel.failedOnChain": "Cette transaction a échoué sur le réseau Fuel. Seuls les frais de réseau ont été payés.",
  "bg.fuel.tooManyCoins": "Il faut trop de petites pièces à la fois. Envoyez d'abord un montant plus petit.",
  // ---- end chains-fuel
  // ---- chains-bitcoincash (bitcoincash)
  // ---- end chains-bitcoincash
  // ---- 1mask (networks87 providers) (1mask)
  // ---- end 1mask (networks87 providers)
  // ---- chains-evm
  "bg.label.networkCharge": "Prélèvement du réseau",
  "bg.evm.flatFee": "{amount} par transaction, même en cas d'échec",
  // ---- end chains-evm
};
export default messages;
