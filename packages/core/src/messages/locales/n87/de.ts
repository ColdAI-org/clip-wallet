import type N87 from "../../en/n87.js";

/** German: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../de.ts and its glossary. */
const messages: { readonly [K in keyof typeof N87]: string } = {
  // ---- chains-cosmos (cosmos, provenance, thorchain, initia)
  // ---- end chains-cosmos
  // ---- chains-tron (tron)
  "bg.tron.notControlled": "Dieses TRON-Konto wird von einem anderen Schlüssel kontrolliert, deshalb kann Clip Wallet dafür nicht signieren.",
  "bg.tron.notOpen": "Dein TRON-Konto ist noch nicht eröffnet. Empfange zuerst etwas TRX.",
  "bg.tron.contractRecipient": "TRX kann nicht direkt an einen Smart Contract gesendet werden.",
  "bg.tron.newAccountFee": "Diese Adresse ist auf TRON noch nicht eröffnet. Eine Sendung dorthin kostet zusätzlich {amount}, um sie zu eröffnen.",
  "bg.tron.getsSigned": "{host} (erhält die signierte Transaktion)",
  "bg.tron.energy": "Energie",
  "bg.tron.bandwidth": "Bandbreite",
  "bg.tron.tronPower": "Stimmrecht",
  "bg.tron.stakeFor": "{amount} für {resource} staken",
  "bg.tron.days": "{count} Tage",
  "bg.tron.cancelUnstaking": "Ausstehende Auszahlungen aus dem Staking abbrechen und diese TRX wieder staken",
  "bg.tron.lend": "{resource} aus deinen gestakten {amount} an {to} verleihen",
  "bg.tron.stopLending": "{resource} aus {amount}, verliehen an {to}, zurücknehmen",
  "bg.tron.lockedHours": "Etwa {hours} Stunden. Vorher kannst du es nicht zurücknehmen.",
  "bg.tron.vote": "Für {count} Super Representatives stimmen",
  "bg.tron.votesReplace": "Das ersetzt alle deine bisherigen Stimmen.",
  "bg.tron.claimVoteRewards": "Deine Belohnungen fürs Abstimmen abholen",
  "bg.tron.changePermissions": "Ändern, wer dein TRON-Konto kontrolliert",
  "bg.tron.keysThreshold": "{keys} (benötigt {threshold})",
  // ---- end chains-tron
  // ---- chains-xrpl (xrpl)
  // ---- end chains-xrpl
  // ---- chains-antelope (antelope)
  // ---- end chains-antelope
  // ---- chains-multiversx (multiversx)
  "bg.multiversx.claimRewardsFrom": "Deine Staking-Belohnungen von {validator} abholen",
  "bg.multiversx.withdrawFrom": "Deine aus dem Staking genommenen EGLD von {validator} abheben",
  "bg.multiversx.restakeRewardsWith": "Deine Belohnungen erneut bei {validator} staken",
  "bg.multiversx.labelGuardian": "Guardian",
  "bg.multiversx.setGuardianTitle": "{guardian} als Guardian deines Kontos festlegen",
  "bg.multiversx.setGuardianWarn": "Sobald ein Guardian aktiv ist, braucht jede Transaktion von diesem Konto seine Mitsignatur. Wenn du {guardian} nicht selbst gewählt hast, könnte dich jemand aus deinem Konto aussperren.",
  "bg.multiversx.guardAccountTitle": "Guardian deines Kontos einschalten",
  "bg.multiversx.guardAccountWarn": "Ab jetzt braucht jede Transaktion von diesem Konto die Mitsignatur des Guardians. Clip Wallet kann sie nicht liefern, daher kannst du mit Clip Wallet nichts mehr von diesem Konto senden.",
  "bg.multiversx.unguardAccountTitle": "Guardian deines Kontos ausschalten",
  "bg.multiversx.changeOwnerTitle": "Vertrag {contract} an {owner} übergeben",
  "bg.multiversx.changeOwnerWarn": "Damit wird {owner} Eigentümer des Vertrags {contract}. Der neue Eigentümer kann seinen Code ändern und nehmen, was darin liegt. Tu das nur, wenn du ihn wirklich abgeben willst.",
  "bg.multiversx.guardedAccount": "Dieses Konto hat einen Guardian, und Clip Wallet kann dessen Mitsignatur nicht einholen. Es wurde nichts gesendet.",
  // ---- end chains-multiversx
  // ---- chains-icp (icp)
  "bg.icp.toAccountId": "Das geht an eine Konto-ID, die Art von Einzahlungsadresse, die Börsen vergeben. Prüfe, ob sie genau mit der Anzeige der Börse übereinstimmt.",
  "bg.icp.expired": "Diese Überweisung ist abgelaufen, bevor du sie genehmigt hast. Es wurde nichts gesendet. Versuche es noch einmal.",
  // ---- end chains-icp
  // ---- chains-stacks (stacks)
  "bg.stacks.postCondition": "Nachbedingung",
  "bg.stacks.pcYouSendExactly": "Du sendest genau {amount}",
  "bg.stacks.pcYouSendAtMost": "Du sendest höchstens {amount}",
  "bg.stacks.pcYouSendAtLeast": "Du sendest mindestens {amount}",
  "bg.stacks.pcYouSendMoreThan": "Du sendest mehr als {amount}",
  "bg.stacks.pcYouSendLessThan": "Du sendest weniger als {amount}",
  "bg.stacks.pcSendsExactly": "{who} sendet genau {amount}",
  "bg.stacks.pcSendsAtMost": "{who} sendet höchstens {amount}",
  "bg.stacks.pcSendsAtLeast": "{who} sendet mindestens {amount}",
  "bg.stacks.pcSendsMoreThan": "{who} sendet mehr als {amount}",
  "bg.stacks.pcSendsLessThan": "{who} sendet weniger als {amount}",
  "bg.stacks.pcYouSendNft": "Du sendest {item}",
  "bg.stacks.pcYouKeepNft": "Du behältst {item}",
  "bg.stacks.pcYouMaySendNft": "Du sendest möglicherweise {item}",
  "bg.stacks.pcSendsNft": "{who} sendet {item}",
  "bg.stacks.pcKeepsNft": "{who} behält {item}",
  "bg.stacks.pcMaySendNft": "{who} sendet möglicherweise {item}",
  "bg.stacks.pcStakingRule": "Eine Staking-Regel für {who}",
  "bg.stacks.allowMode": "Damit kann der Vertrag jedes deiner Assets bewegen, nicht nur die aufgeführten. Genehmige das nur, wenn du {host} voll und ganz vertraust.",
  "bg.stacks.originatorMode": "Nur die aufgeführten Übertragungen können dein Konto verlassen. Der Vertrag kann trotzdem Assets anderer Konten bewegen.",
  "bg.stacks.nothingLeaves": "Bei dieser Transaktion kann keines deiner Assets dein Konto verlassen, abgesehen von der Netzwerkgebühr.",
  "bg.stacks.highFee": "Die Netzwerkgebühr beträgt {fee}, das ist ungewöhnlich hoch.",
  "bg.stacks.sponsorPays": "Ein von {host} gewählter Sponsor",
  "bg.stacks.deployNamed": "Smart Contract {name} erstellen",
  "bg.stacks.notYourTx": "Diese Transaktion wird von einem anderen Stacks-Konto signiert, daher kann Clip Wallet sie nicht signieren.",
  "bg.stacks.multisig": "Clip Wallet kann noch nicht für gemeinsame Stacks-Konten (Multisignatur) signieren.",
  "bg.stacks.memoTooLong": "Das Memo ist zu lang. Ein Stacks-Memo fasst höchstens 34 Byte.",
  "bg.stacks.feeTooLow": "Die Netzwerkgebühr war zu niedrig, deshalb hat das Netzwerk die Transaktion nicht angenommen. Es wurde nichts gesendet. Versuch es noch einmal.",
  "bg.stacks.nonceBusy": "Eine andere Transaktion dieses Kontos wartet noch. Warte, bis sie abgeschlossen ist, und versuch es dann noch einmal.",
  "bg.stacks.otherNetworkTx": "Diese Transaktion ist für ein anderes Stacks-Netzwerk bestimmt, deshalb wurde sie nicht gesendet.",
  "bg.stacks.badContractCall": "Der Vertragsaufruf der App passt nicht zum Vertrag im Netzwerk. Es wurde nichts gesendet.",
  "bg.stacks.tooManyPending": "Bei diesem Konto warten zu viele Transaktionen. Warte, bis einige abgeschlossen sind, und versuch es dann noch einmal.",
  "bg.stacks.signatureRefused": "Das Netzwerk hat die Signatur nicht akzeptiert. Es wurde nichts gesendet.",
  "bg.stacks.testAddressOnMainnet": "Das ist eine Stacks-Adresse eines Testnetzwerks (ST…). Verwende eine Mainnet-Adresse (SP…).",
  "bg.stacks.mainAddressOnTestnet": "Das ist eine Stacks-Mainnet-Adresse (SP…). Verwende eine Adresse eines Testnetzwerks (ST…).",
  "bg.stacks.notAnAddress": "Das sieht nicht nach einer Stacks-Adresse aus.",
  "bg.stacks.needStxForFee": "Du brauchst etwas STX, um die Netzwerkgebühr zu bezahlen.",
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
