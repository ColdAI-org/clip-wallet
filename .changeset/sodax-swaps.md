---
"@clip-wallet/features": minor
"@clip-wallet/core": minor
---

Cross-network swaps through SODAX (`SodaxSwap`), with the disclosed 0.875 % Clip fee on the amount you sell, paid to
ColdAI LLC through SODAX's partner fee in its exact amount form. Mainnet builds only (SODAX has no test networks), and
off unless the build sets an ExClip server URL and a fee receiver that is on the reviewed list
(`sodax-fee-receivers.json`). Before anything can be approved the wallet decodes the transaction it
built and refuses it unless the fee receiver is reviewed, the fee is at most 0.875 % and everything else matches the
quote. Tokenised stocks (`isRwa`) are never offered. Quotes carry `clipFee` and `arrivesOn`; new exports `SodaxSwap`,
`sodaxTokens`, `SODAX_SPOKES`, `SODAX_INTENTS`, `checkSodaxSwap`, `decodeSodaxSwap`, `sodaxFeeData`, `sodaxSwapTx`,
`CLIP_FEE`, `clipFeeOn`, `withinClipFee`, `SODAX_FEE_RECEIVERS`, `isReviewedFeeReceiver`, `isFeeReceiverAddress`,
`parseFeeReceivers` and the `@clip-wallet/features/sodax-fee` entry. Core gains the refusal and line-label messages in
all 12 languages. See docs/features/sodax-swaps.md.
