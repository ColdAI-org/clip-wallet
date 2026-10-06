import type N87 from "../../en/n87.js";

/** Spanish: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../es.ts and its glossary. */
const messages: { readonly [K in keyof typeof N87]: string } = {
  // ---- chains-cosmos (cosmos, provenance, thorchain, initia)
  // ---- end chains-cosmos
  // ---- chains-tron (tron)
  "bg.tron.notControlled": "Otra clave controla esta cuenta de TRON, así que Clip Wallet no puede firmar por ella.",
  "bg.tron.notOpen": "Tu cuenta de TRON aún no está abierta. Primero recibe algo de TRX.",
  "bg.tron.contractRecipient": "No se puede enviar TRX directamente a un contrato inteligente.",
  "bg.tron.newAccountFee": "Esta dirección aún no está abierta en TRON. Enviarle fondos cuesta además {amount} para abrirla.",
  "bg.tron.getsSigned": "{host} (recibe la transacción firmada)",
  "bg.tron.energy": "energía",
  "bg.tron.bandwidth": "ancho de banda",
  "bg.tron.tronPower": "poder de voto",
  "bg.tron.stakeFor": "Hacer staking de {amount} para obtener {resource}",
  "bg.tron.days": "{count} días",
  "bg.tron.cancelUnstaking": "Cancelar tus retiros pendientes del staking y volver a hacer staking de esos TRX",
  "bg.tron.lend": "Prestar {resource} de los {amount} que tienes en staking a {to}",
  "bg.tron.stopLending": "Recuperar {resource} de los {amount} que prestaste a {to}",
  "bg.tron.lockedHours": "Unas {hours} horas. No puedes recuperarlo antes.",
  "bg.tron.vote": "Votar por {count} Super Representatives",
  "bg.tron.votesReplace": "Esto reemplaza todos tus votos anteriores.",
  "bg.tron.claimVoteRewards": "Reclamar tus recompensas por votar",
  "bg.tron.changePermissions": "Cambiar quién controla tu cuenta de TRON",
  "bg.tron.keysThreshold": "{keys} (necesita {threshold})",
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
  "bg.stacks.postCondition": "Poscondición",
  "bg.stacks.pcYouSendExactly": "Envías exactamente {amount}",
  "bg.stacks.pcYouSendAtMost": "Envías como máximo {amount}",
  "bg.stacks.pcYouSendAtLeast": "Envías como mínimo {amount}",
  "bg.stacks.pcYouSendMoreThan": "Envías más de {amount}",
  "bg.stacks.pcYouSendLessThan": "Envías menos de {amount}",
  "bg.stacks.pcSendsExactly": "{who} envía exactamente {amount}",
  "bg.stacks.pcSendsAtMost": "{who} envía como máximo {amount}",
  "bg.stacks.pcSendsAtLeast": "{who} envía como mínimo {amount}",
  "bg.stacks.pcSendsMoreThan": "{who} envía más de {amount}",
  "bg.stacks.pcSendsLessThan": "{who} envía menos de {amount}",
  "bg.stacks.pcYouSendNft": "Envías {item}",
  "bg.stacks.pcYouKeepNft": "Conservas {item}",
  "bg.stacks.pcYouMaySendNft": "Puede que envíes {item}",
  "bg.stacks.pcSendsNft": "{who} envía {item}",
  "bg.stacks.pcKeepsNft": "{who} conserva {item}",
  "bg.stacks.pcMaySendNft": "Puede que {who} envíe {item}",
  "bg.stacks.pcStakingRule": "Una regla de staking para {who}",
  "bg.stacks.allowMode": "Esto permite que el contrato mueva cualquiera de tus activos, no solo los indicados. Apruébalo solo si confías plenamente en {host}.",
  "bg.stacks.originatorMode": "Solo las transferencias indicadas pueden salir de tu cuenta. El contrato aún puede mover activos de otras cuentas.",
  "bg.stacks.nothingLeaves": "Ninguno de tus activos puede salir de tu cuenta en esta transacción, aparte de la comisión de red.",
  "bg.stacks.highFee": "La comisión de red es {fee}, un importe inusualmente alto.",
  "bg.stacks.sponsorPays": "Un patrocinador elegido por {host}",
  "bg.stacks.deployNamed": "Crear el contrato inteligente {name}",
  "bg.stacks.notYourTx": "Esta transacción la firma otra cuenta de Stacks, así que Clip Wallet no puede firmarla.",
  "bg.stacks.multisig": "Clip Wallet aún no puede firmar para cuentas compartidas (multifirma) de Stacks.",
  "bg.stacks.memoTooLong": "El memo es demasiado largo. Un memo de Stacks admite hasta 34 bytes.",
  "bg.stacks.feeTooLow": "La comisión de red era demasiado baja, así que la red no aceptó la transacción. No se envió nada. Inténtalo de nuevo.",
  "bg.stacks.nonceBusy": "Otra transacción de esta cuenta sigue pendiente. Espera a que termine e inténtalo de nuevo.",
  "bg.stacks.otherNetworkTx": "Esta transacción es para otra red de Stacks, así que no se envió.",
  "bg.stacks.badContractCall": "La llamada al contrato de la app no coincide con el contrato en la red. No se envió nada.",
  "bg.stacks.tooManyPending": "Esta cuenta tiene demasiadas transacciones pendientes. Espera a que terminen algunas e inténtalo de nuevo.",
  "bg.stacks.signatureRefused": "La red no aceptó la firma. No se envió nada.",
  "bg.stacks.testAddressOnMainnet": "Esa es una dirección de Stacks de una red de prueba (ST…). Usa una dirección de la red principal (SP…).",
  "bg.stacks.mainAddressOnTestnet": "Esa es una dirección de Stacks de la red principal (SP…). Usa una dirección de una red de prueba (ST…).",
  "bg.stacks.notAnAddress": "Eso no parece una dirección de Stacks.",
  "bg.stacks.needStxForFee": "Necesitas un poco de STX para pagar la comisión de red.",
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
