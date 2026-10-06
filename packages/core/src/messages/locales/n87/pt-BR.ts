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
  "bg.stacks.postCondition": "Pós-condição",
  "bg.stacks.pcYouSendExactly": "Você envia exatamente {amount}",
  "bg.stacks.pcYouSendAtMost": "Você envia no máximo {amount}",
  "bg.stacks.pcYouSendAtLeast": "Você envia no mínimo {amount}",
  "bg.stacks.pcYouSendMoreThan": "Você envia mais de {amount}",
  "bg.stacks.pcYouSendLessThan": "Você envia menos de {amount}",
  "bg.stacks.pcSendsExactly": "{who} envia exatamente {amount}",
  "bg.stacks.pcSendsAtMost": "{who} envia no máximo {amount}",
  "bg.stacks.pcSendsAtLeast": "{who} envia no mínimo {amount}",
  "bg.stacks.pcSendsMoreThan": "{who} envia mais de {amount}",
  "bg.stacks.pcSendsLessThan": "{who} envia menos de {amount}",
  "bg.stacks.pcYouSendNft": "Você envia {item}",
  "bg.stacks.pcYouKeepNft": "Você mantém {item}",
  "bg.stacks.pcYouMaySendNft": "Você pode enviar {item}",
  "bg.stacks.pcSendsNft": "{who} envia {item}",
  "bg.stacks.pcKeepsNft": "{who} mantém {item}",
  "bg.stacks.pcMaySendNft": "{who} pode enviar {item}",
  "bg.stacks.pcStakingRule": "Uma regra de staking para {who}",
  "bg.stacks.allowMode": "Isto permite que o contrato mova qualquer um dos seus ativos, não só os listados. Só aprove se você confia totalmente em {host}.",
  "bg.stacks.originatorMode": "Só as transferências listadas podem sair da sua conta. O contrato ainda pode mover ativos de outras contas.",
  "bg.stacks.nothingLeaves": "Nenhum dos seus ativos pode sair da sua conta nesta transação, exceto a taxa de rede.",
  "bg.stacks.highFee": "A taxa de rede é de {fee}, o que é muito alto.",
  "bg.stacks.sponsorPays": "Um patrocinador escolhido por {host}",
  "bg.stacks.deployNamed": "Criar o contrato inteligente {name}",
  "bg.stacks.notYourTx": "Esta transação é assinada por outra conta Stacks, então a Clip Wallet não pode assiná-la.",
  "bg.stacks.multisig": "A Clip Wallet ainda não consegue assinar por contas Stacks compartilhadas (multiassinatura).",
  "bg.stacks.memoTooLong": "O memo é longo demais. Um memo Stacks comporta até 34 bytes.",
  "bg.stacks.feeTooLow": "A taxa de rede era baixa demais, então a rede não aceitou a transação. Nada foi enviado. Tente de novo.",
  "bg.stacks.nonceBusy": "Outra transação desta conta ainda está pendente. Espere ela terminar e tente de novo.",
  "bg.stacks.otherNetworkTx": "Esta transação é para outra rede Stacks, então não foi enviada.",
  "bg.stacks.badContractCall": "A chamada de contrato do app não corresponde ao contrato na rede. Nada foi enviado.",
  "bg.stacks.tooManyPending": "Esta conta tem transações pendentes demais. Espere algumas terminarem e tente de novo.",
  "bg.stacks.signatureRefused": "A rede não aceitou a assinatura. Nada foi enviado.",
  "bg.stacks.testAddressOnMainnet": "Esse é um endereço Stacks de rede de teste (ST…). Use um endereço da rede principal (SP…).",
  "bg.stacks.mainAddressOnTestnet": "Esse é um endereço Stacks da rede principal (SP…). Use um endereço de rede de teste (ST…).",
  "bg.stacks.notAnAddress": "Isso não parece um endereço Stacks.",
  "bg.stacks.needStxForFee": "Você precisa de um pouco de STX para pagar a taxa de rede.",
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
