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
  "bg.stacks.postCondition": "Postcondizione",
  "bg.stacks.pcYouSendExactly": "Invii esattamente {amount}",
  "bg.stacks.pcYouSendAtMost": "Invii al massimo {amount}",
  "bg.stacks.pcYouSendAtLeast": "Invii almeno {amount}",
  "bg.stacks.pcYouSendMoreThan": "Invii più di {amount}",
  "bg.stacks.pcYouSendLessThan": "Invii meno di {amount}",
  "bg.stacks.pcSendsExactly": "{who} invia esattamente {amount}",
  "bg.stacks.pcSendsAtMost": "{who} invia al massimo {amount}",
  "bg.stacks.pcSendsAtLeast": "{who} invia almeno {amount}",
  "bg.stacks.pcSendsMoreThan": "{who} invia più di {amount}",
  "bg.stacks.pcSendsLessThan": "{who} invia meno di {amount}",
  "bg.stacks.pcYouSendNft": "Invii {item}",
  "bg.stacks.pcYouKeepNft": "Mantieni {item}",
  "bg.stacks.pcYouMaySendNft": "Potresti inviare {item}",
  "bg.stacks.pcSendsNft": "{who} invia {item}",
  "bg.stacks.pcKeepsNft": "{who} mantiene {item}",
  "bg.stacks.pcMaySendNft": "{who} potrebbe inviare {item}",
  "bg.stacks.pcStakingRule": "Una regola di staking per {who}",
  "bg.stacks.allowMode": "Così il contratto può spostare qualsiasi tuo asset, non solo quelli elencati. Approvalo solo se ti fidi completamente di {host}.",
  "bg.stacks.originatorMode": "Solo i trasferimenti elencati possono lasciare il tuo account. Il contratto può comunque spostare gli asset di altri account.",
  "bg.stacks.nothingLeaves": "In questa transazione nessuno dei tuoi asset può lasciare il tuo account, a parte la commissione di rete.",
  "bg.stacks.highFee": "La commissione di rete è {fee}, un valore insolitamente alto.",
  "bg.stacks.sponsorPays": "Uno sponsor scelto da {host}",
  "bg.stacks.deployNamed": "Crea lo smart contract {name}",
  "bg.stacks.notYourTx": "Questa transazione è firmata da un altro account Stacks, quindi Clip Wallet non può firmarla.",
  "bg.stacks.multisig": "Clip Wallet non può ancora firmare per gli account Stacks condivisi (multifirma).",
  "bg.stacks.memoTooLong": "Il memo è troppo lungo. Un memo Stacks contiene al massimo 34 byte.",
  "bg.stacks.feeTooLow": "La commissione di rete era troppo bassa, quindi la rete non ha accettato la transazione. Non è stato inviato nulla. Riprova.",
  "bg.stacks.nonceBusy": "Un'altra transazione di questo account è ancora in attesa. Aspetta che finisca, poi riprova.",
  "bg.stacks.otherNetworkTx": "Questa transazione è per un'altra rete Stacks, quindi non è stata inviata.",
  "bg.stacks.badContractCall": "La chiamata al contratto dell'app non corrisponde al contratto sulla rete. Non è stato inviato nulla.",
  "bg.stacks.tooManyPending": "Questo account ha troppe transazioni in attesa. Aspetta che alcune finiscano, poi riprova.",
  "bg.stacks.signatureRefused": "La rete non ha accettato la firma. Non è stato inviato nulla.",
  "bg.stacks.testAddressOnMainnet": "Questo è un indirizzo Stacks di una rete di test (ST…). Usa un indirizzo della rete principale (SP…).",
  "bg.stacks.mainAddressOnTestnet": "Questo è un indirizzo Stacks della rete principale (SP…). Usa un indirizzo di una rete di test (ST…).",
  "bg.stacks.notAnAddress": "Non sembra un indirizzo Stacks.",
  "bg.stacks.needStxForFee": "Ti serve un po' di STX per pagare la commissione di rete.",
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
