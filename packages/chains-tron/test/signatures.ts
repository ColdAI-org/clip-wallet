/**
 * Signature fixtures, computed once OFFLINE (outside the repo) with the vault's own signer from the public BIP-39 test
 * vector "abandon abandon … about" (empty passphrase), secp256k1 at m/44'/195'/0'/0/0 (TronLink / TronWeb.fromMnemonic):
 * address TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH. Each is r ‖ s ‖ v (v = 27 + recovery), hex. Only public data lives here.
 *
 *  - builtTrx: the raw transaction buildTransfer makes for 1.5 TRX me → bob on Nile, reference block 71585237
 *    (0000000004444dd5…d8faf835, time 1791284757000), now = 1791284760000, expiration = block time + 10 min.
 *  - dappTransfer / dappTrc20: NILE_TX.transfer / NILE_TX.trc20 (txID).
 *  - message: TronWeb signMessageV2("Sign in to app.example").
 */
export const ME = "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH";
export const ME_PUB = "03ff21f8e64d3a3c0198edfbb7afdc79be959432e92e2f8a1984bb436a414b8edc";
/** m/44'/195'/0'/0/1 of the same phrase. */
export const BOB = "TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK";
export const BOB_PUB = "0209b9854ad6e016c5d72aee08f763821bd5e32489c12bcc078a935a14f29dbed6";
export const SIG = {
  "builtRaw": "0a024dd522086ee3c6be8649ac0a40c8d3b58791345a67080112630a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412320a1541c8599111f29c1e1e061265b4af93ea1f274ad78a121541b6e708a39781c96bd399c7657780ff9fe9f052a818e0c65b70c09b91879134",
  "builtTrx": "16761d2008808f38988a645eed3e750728e7c3b97cdbc6dfb5035d275bcfd2ff1b3501a93e35a8c69caa322197502afe2935feabdfa674851256592d50b0ffed1c",
  "dappTransfer": "9485a2c63119a6cf857a44c7deb8e67a53f886f14ca68d025b9bcb8e6119afcb1997334fa58fc7b998bc2dbc602d28101f5e0daabb9cf4ef78d6a551f83ff8011b",
  "dappTrc20": "a3c0b03a398b4c258a0d84602ea548d8df92b789ec942f0eb5226d88684e32a63799d382aa7cc5e9c5c03fe4342260700bf7be2745d31600fc15f8c26aba4d261c",
  "message": "fe7da50500197d661fb366ffe53bab38460868ebfb02e2f002507659f990aaa02b28a20d6201b014a6276f9b54689401f6c5dbd114753d056ec22bc6d67391b61c"
} as const;
