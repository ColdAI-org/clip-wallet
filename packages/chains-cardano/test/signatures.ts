/**
 * Signature fixtures, computed once offline (outside the repo) with throwaway ed25519 keys that were discarded
 * afterwards (AGENTS.md rule 1: no signing code outside packages/vault, tests included). Only public keys,
 * addresses and signatures live here. Cardano verifies BIP32-Ed25519 signatures as plain Ed25519, so plain keys
 * stand in for the CIP-1852 payment (role 0) and stake (role 2) keys.
 *
 *  - dappTxSig: body hash of dappTx() in helpers.ts (payment key)
 *  - transferSig / tokenTransferSig: buildTransfer of 2 ADA / 2 CLIP to bob with standardRoutes()
 *  - delegatePaymentSig + delegateStakeSig: buildDelegate(FIX.pool) (stake key not yet registered)
 *  - dataSig / rewardDataSig: CIP-8 Sig_structure of "Sign in to example.org" for the base / reward address
 */
export const FIX = {
  "paymentPub": "f8573c6dbfde4d69363f64f688063e6227ef4bd4d3e3dd2bbb2744205d2124d6",
  "stakePub": "5672598feec2b38672e09ccc81839fcd275658b57686156404013198e7e97eba",
  "address": "addr_test1qzk2jt3l5uxmzvvgtkfn65mcmakqexsxm0ard84zxng7dd5ck5cvjgqxmagnjvycn5he68cp606q6x7kwkhk734wve9q7umnwu",
  "rewardAddress": "stake_test1uzvt2vxfyqrd75fexzvf6tuaruqa8aqdr0t8ttm0g6hxvjsnadee2",
  "bob": "addr_test1vzdf6zwphptjcwvz2x9mrl8ecf5g00dr7lffj9xk46lmw9qm6jrnh",
  "otherKeyHash": "d47358368b4d3ee6c3b2cdc02b6f1cc13a03f7e094ead185accd0684",
  "otherAddress": "addr_test1vr28xkpk3dxnaekrktxuq2m0rnqn5qlhuz2w45v94nxsdpqnn99nr",
  "policy": "162abb629bbc319ab555bbc8fecda53923f4cf63aae7869092c51cf3",
  "pool": "pool1v0vwpn83adnefq83s5n5p7hs7qyrkafd6m3sq700sq59zm95s6j",
  "slot": 100000000
} as const;

export const SIGS = {
  "dappTxSig": "7261b02ad96d42a50d77b450c52f2170d4252869b628def82ba5bc01760377e99829dd1e49e9b74ef5674b49f7b2e88f64b419e92c2d4330a13015795bbea50e",
  "transferSig": "a1e852199d2033ae45ad9657dd0953ac6414a82c22b77e932547bf667132ee30155ac108c9742440a8a4c28741d333ee21a7a316c756d66960f073ad4d44d20c",
  "tokenTransferSig": "5ad1f40f7f4cfc40dee2484d42cbb445ec7251793bc7e046c12f0bb600d95a1f3d4799ab87412c3d7d35651b59307629ef710d7135c100a5d3d5f1221d86d10a",
  "delegatePaymentSig": "d756ed35093586eb5fc202fede8a8ee5ebccc1c5045023bd6aeffa4e2e48c866f554fa37a6dcd738e2bad3a184940119abb0f3fd70e325cfffca2cd38b042c0a",
  "delegateStakeSig": "0aa5f40637ed97a36e4cc4a472683cd96f58d7b420756fdc344f74a61a91a44a77c5b9c5bc4ccf02b735674e2985b0da2c834233827c712767ea99353090660d",
  "dataSig": "7d6499305fa110cc16755cd7e2c984690a65c58f1ec02ca9e0183ec57c02331222e502c5c8443ccbea24a1e65e360a7c2fe0b15c578c3b1dd756d680a5b5a200",
  "rewardDataSig": "ef18276eb3d86b1e3fa7b1afd1df53ef50fc668a4bdb954f1a3caed90a49d8a2675708b3a467bc7232a20645bfaa53df2c57b226c80c9f6e78bbf74224767d02"
} as const;
