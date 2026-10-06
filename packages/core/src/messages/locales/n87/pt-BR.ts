import type N87 from "../../en/n87.js";

/** Brazilian Portuguese: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../pt-BR.ts and its glossary. */
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
  "bg.fuel.changeToOther": "Tudo o que sobrar do seu {symbol} depois disto vai para {to}, e não volta para você.",
  "bg.fuel.leftoverLost": "{amount} não é enviado para lugar nenhum por esta transação e seria perdido.",
  "bg.fuel.coinsSpent": "Algumas das moedas que esta transação usa já foram gastas. Peça ao app para tentar de novo.",
  "bg.fuel.feeRose": "A taxa de rede subiu desde que isto foi preparado. Nada foi enviado. Tente de novo.",
  "bg.fuel.failedOnChain": "Esta transação falhou na rede Fuel. Só a taxa de rede foi gasta.",
  "bg.fuel.tooManyCoins": "Isto precisa de moedas pequenas demais de uma vez. Envie um valor menor primeiro.",
  // ---- end chains-fuel
  // ---- chains-bitcoincash (bitcoincash)
  // ---- end chains-bitcoincash
  // ---- 1mask (networks87 providers) (1mask)
  // ---- end 1mask (networks87 providers)
  // ---- chains-evm
  "bg.label.networkCharge": "Cobrança da rede",
  "bg.evm.flatFee": "{amount} por transação, mesmo se ela falhar",
  // ---- end chains-evm
};
export default messages;
