/**
 * networks87 chain modules and their 1Mask providers ("bg.<family>.*", plain {arguments} only). One section per
 * package: keep each package's ids between its markers (translations: ../locales/n87/<code>.ts, same sections).
 */
export default {
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
  "bg.fuel.changeToOther": "Everything left of your {symbol} after this goes to {to}, not back to you.",
  "bg.fuel.leftoverLost": "{amount} isn't sent anywhere by this transaction and would be lost.",
  "bg.fuel.coinsSpent": "Some of the coins this transaction uses were already spent. Ask the app to try again.",
  "bg.fuel.feeRose": "The network fee went up since this was prepared. Nothing was sent. Try again.",
  "bg.fuel.failedOnChain": "This transaction failed on the Fuel network. Only the network fee was spent.",
  "bg.fuel.tooManyCoins": "This needs too many small coins at once. Send a smaller amount first.",
  // ---- end chains-fuel
  // ---- chains-bitcoincash (bitcoincash)
  // ---- end chains-bitcoincash
  // ---- 1mask (networks87 providers) (1mask)
  // ---- end 1mask (networks87 providers)
  // ---- chains-evm (networks87: STRATO)
  "bg.label.networkCharge": "Network charge",
  "bg.evm.flatFee": "{amount} per transaction, even if it fails",
  // ---- end chains-evm
} as const;
