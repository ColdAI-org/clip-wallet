import type N87 from "../../en/n87.js";

/** French: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../fr.ts and its glossary. */
const messages: { readonly [K in keyof typeof N87]: string } = {
  // ---- chains-cosmos (cosmos, provenance, thorchain, initia)
  // ---- end chains-cosmos
  // ---- chains-tron (tron)
  "bg.tron.notControlled": "Ce compte TRON est contrôlé par une autre clé, donc Clip Wallet ne peut pas signer pour lui.",
  "bg.tron.notOpen": "Votre compte TRON n'est pas encore ouvert. Recevez d'abord un peu de TRX.",
  "bg.tron.contractRecipient": "Impossible d'envoyer des TRX directement à un smart contract.",
  "bg.tron.newAccountFee": "Cette adresse n'est pas encore ouverte sur TRON. Y envoyer des fonds coûte aussi {amount} pour l'ouvrir.",
  "bg.tron.getsSigned": "{host} (reçoit la transaction signée)",
  "bg.tron.energy": "énergie",
  "bg.tron.bandwidth": "bande passante",
  "bg.tron.tronPower": "droit de vote",
  "bg.tron.stakeFor": "Staker {amount} (ressource : {resource})",
  "bg.tron.days": "{count} jours",
  "bg.tron.cancelUnstaking": "Annuler vos retraits du staking en attente et staker à nouveau ces TRX",
  "bg.tron.lend": "Prêter la ressource {resource} de vos {amount} stakés à {to}",
  "bg.tron.stopLending": "Reprendre la ressource {resource} des {amount} prêtés à {to}",
  "bg.tron.lockedHours": "Environ {hours} heures. Vous ne pouvez pas le reprendre avant.",
  "bg.tron.vote": "Voter pour {count} Super Representatives",
  "bg.tron.votesReplace": "Cela remplace tous vos votes précédents.",
  "bg.tron.claimVoteRewards": "Réclamer vos récompenses de vote",
  "bg.tron.changePermissions": "Changer qui contrôle votre compte TRON",
  "bg.tron.keysThreshold": "{keys} (requiert {threshold})",
  // ---- end chains-tron
  // ---- chains-xrpl (xrpl)
  // ---- end chains-xrpl
  // ---- chains-antelope (antelope)
  // ---- end chains-antelope
  // ---- chains-multiversx (multiversx)
  "bg.multiversx.claimRewardsFrom": "Récupérer vos récompenses de staking auprès de {validator}",
  "bg.multiversx.withdrawFrom": "Retirer auprès de {validator} vos EGLD sortis du staking",
  "bg.multiversx.restakeRewardsWith": "Remettre vos récompenses en staking auprès de {validator}",
  "bg.multiversx.labelGuardian": "Gardien",
  "bg.multiversx.setGuardianTitle": "Faire de {guardian} le gardien de votre compte",
  "bg.multiversx.setGuardianWarn": "Une fois un gardien actif, chaque transaction de ce compte nécessite sa cosignature. Si vous n'avez pas choisi {guardian}, quelqu'un pourrait vous bloquer l'accès à votre compte.",
  "bg.multiversx.guardAccountTitle": "Activer le gardien de votre compte",
  "bg.multiversx.guardAccountWarn": "Désormais, chaque transaction de ce compte nécessite la cosignature du gardien. Clip Wallet ne peut pas la fournir : vous ne pourrez plus envoyer depuis Clip Wallet.",
  "bg.multiversx.unguardAccountTitle": "Désactiver le gardien de votre compte",
  "bg.multiversx.changeOwnerTitle": "Céder le contrat {contract} à {owner}",
  "bg.multiversx.changeOwnerWarn": "{owner} devient propriétaire du contrat {contract}. Le nouveau propriétaire peut modifier son code et prendre ce qu'il contient. Ne le faites que si vous voulez vraiment le céder.",
  "bg.multiversx.guardedAccount": "Ce compte a un gardien, et Clip Wallet ne peut pas obtenir sa cosignature. Rien n'a été envoyé.",
  // ---- end chains-multiversx
  // ---- chains-icp (icp)
  "bg.icp.toAccountId": "Ceci est envoyé à un identifiant de compte, le type d'adresse de dépôt que donnent les plateformes d'échange. Vérifiez qu'il correspond exactement à celui affiché par la plateforme.",
  "bg.icp.expired": "Ce transfert a expiré avant que vous ne l'approuviez. Rien n'a été envoyé. Réessayez.",
  // ---- end chains-icp
  // ---- chains-stacks (stacks)
  "bg.stacks.postCondition": "Postcondition",
  "bg.stacks.pcYouSendExactly": "Vous envoyez exactement {amount}",
  "bg.stacks.pcYouSendAtMost": "Vous envoyez au plus {amount}",
  "bg.stacks.pcYouSendAtLeast": "Vous envoyez au moins {amount}",
  "bg.stacks.pcYouSendMoreThan": "Vous envoyez plus de {amount}",
  "bg.stacks.pcYouSendLessThan": "Vous envoyez moins de {amount}",
  "bg.stacks.pcSendsExactly": "{who} envoie exactement {amount}",
  "bg.stacks.pcSendsAtMost": "{who} envoie au plus {amount}",
  "bg.stacks.pcSendsAtLeast": "{who} envoie au moins {amount}",
  "bg.stacks.pcSendsMoreThan": "{who} envoie plus de {amount}",
  "bg.stacks.pcSendsLessThan": "{who} envoie moins de {amount}",
  "bg.stacks.pcYouSendNft": "Vous envoyez {item}",
  "bg.stacks.pcYouKeepNft": "Vous conservez {item}",
  "bg.stacks.pcYouMaySendNft": "Vous enverrez peut-être {item}",
  "bg.stacks.pcSendsNft": "{who} envoie {item}",
  "bg.stacks.pcKeepsNft": "{who} conserve {item}",
  "bg.stacks.pcMaySendNft": "{who} enverra peut-être {item}",
  "bg.stacks.pcStakingRule": "Une règle de staking pour {who}",
  "bg.stacks.allowMode": "Cela permet au contrat de déplacer n'importe lequel de vos actifs, pas seulement ceux listés. Ne l'approuvez que si vous faites entièrement confiance à {host}.",
  "bg.stacks.originatorMode": "Seuls les transferts listés peuvent quitter votre compte. Le contrat peut tout de même déplacer les actifs d'autres comptes.",
  "bg.stacks.nothingLeaves": "Aucun de vos actifs ne peut quitter votre compte dans cette transaction, à part les frais de réseau.",
  "bg.stacks.highFee": "Les frais de réseau s'élèvent à {fee}, ce qui est anormalement élevé.",
  "bg.stacks.sponsorPays": "Un sponsor choisi par {host}",
  "bg.stacks.deployNamed": "Créer le smart contract {name}",
  "bg.stacks.notYourTx": "Cette transaction est signée par un autre compte Stacks, Clip Wallet ne peut donc pas la signer.",
  "bg.stacks.multisig": "Clip Wallet ne peut pas encore signer pour les comptes Stacks partagés (multisignature).",
  "bg.stacks.memoTooLong": "Le mémo est trop long. Un mémo Stacks contient au maximum 34 octets.",
  "bg.stacks.feeTooLow": "Les frais de réseau étaient trop bas, le réseau n'a donc pas accepté la transaction. Rien n'a été envoyé. Réessayez.",
  "bg.stacks.nonceBusy": "Une autre transaction de ce compte est toujours en attente. Attendez qu'elle se termine, puis réessayez.",
  "bg.stacks.otherNetworkTx": "Cette transaction est destinée à un autre réseau Stacks, elle n'a donc pas été envoyée.",
  "bg.stacks.badContractCall": "L'appel de contrat de l'application ne correspond pas au contrat sur le réseau. Rien n'a été envoyé.",
  "bg.stacks.tooManyPending": "Ce compte a trop de transactions en attente. Attendez que certaines se terminent, puis réessayez.",
  "bg.stacks.signatureRefused": "Le réseau n'a pas accepté la signature. Rien n'a été envoyé.",
  "bg.stacks.testAddressOnMainnet": "C'est une adresse Stacks de réseau de test (ST…). Utilisez une adresse du réseau principal (SP…).",
  "bg.stacks.mainAddressOnTestnet": "C'est une adresse Stacks du réseau principal (SP…). Utilisez une adresse de réseau de test (ST…).",
  "bg.stacks.notAnAddress": "Cela ne ressemble pas à une adresse Stacks.",
  "bg.stacks.needStxForFee": "Il vous faut un peu de STX pour payer les frais de réseau.",
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
