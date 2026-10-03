/**
 * Signature fixtures, computed once offline with a throwaway ed25519 key that was discarded afterwards
 * (AGENTS.md rule 1: no signing code outside packages/vault, tests included). Only addresses,
 * transaction bytes and signatures live here. Transactions use a fixed blockhash.
 *
 *  - solTransfer: v0, CU limit 200k, CU price 1000 µlamports, 1.5 SOL me → bob
 *  - usdcTransfer: v0, create the devnet-USDC ATA for bob (idempotent) + transferChecked 2.5 USDC
 *  - messageSig: "Hello Solana"; siwsSig: the SIWS text in solana.test.ts
 */
export const FIX = {
  "me": "DQiaMPLWF8392SQYSLxXziw4UXBotXwPg6we92KacyEM",
  "bob": "B4TKXjrdvz5BwPmkhUfjW7hMXWPDCsAdzH53761WMfVt",
  "blockhash": "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N",
  "myUsdcAta": "7qNj4m13Pe8QAiNbLAMLvC4E3DaLJBLn4nqDskgAC9jU",
  "bobUsdcAta": "8LWwVipcVrMsrG9w47uFHwzfRhLkMVZwtkNhrQv1tjdM",
  "solTransfer": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQACBLhfnFqAIP5DKx+d8deLROUxa2zcea9DdhZGBE02ixHulXdfCJAPfD6M8Ln9t4izRrkDykDOrfNJjSWNGhpeEBMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMGRm/lIRcy/+ytunLDm+e8jOW7xfcSayxDmzpAAAAAzEkOkozS44c7s0P8ldozF5ymD02/RsLDbpEpnVXU5rkDAwAFAkANAwADAAkD6AMAAAAAAAACAgABDAIAAAAAL2hZAAAAAAA=",
  "solTransferSig": "073b864f5bc6f0b5ee219e6135401a335d129d822bd5ebe60f93908f792055ef2796efa842d84374f7c6fc72337ba3e2609b8a6f4443de20447bdce3e9753701",
  "usdcTransfer": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQAFCLhfnFqAIP5DKx+d8deLROUxa2zcea9DdhZGBE02ixHuZYqQsiKvpj6c3Qwx74/lxxdHqEjot8lAxvf3Kx9IlSdtAbJW8apXiraQFvPNyLIEsJcW8CwkDMivML+aAOJAfAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqeMlyWPTiSJ8bs9ECkUjg2DC1oTmdr/EIQEjnvY2+n4WZV3XwiQD3w+jPC5/beIs0a5A8pAzq3zSY0ljRoaXhATBt324ddloZPZy+FGzut5rBy0he1fWzeROoz1hX7/AKnMSQ6SjNLjhzuzQ/yV2jMXnKYPTb9GwsNukSmdVdTmuQIFBgACBgQDBwEBBwQBBAIACgygJSYAAAAAAAYA",
  "usdcTransferSig": "a56b9880260c9a042c89330ed8fd54df0152b99bda90d51f05fe76cd4f9813bbb15a47b4904697f2011d8dc23e894d6eda1600d7861210a24fd9d33988f7c209",
  "messageSig": "85c0daec101ced324ce87f287c9e5f2a4b240d8b75bab6d3ba7a47e9ea388e5fd94e3b6d35c7e9c9ae1335ad046f4a1e511f11733a067992a81e0d6a66a6500b",
  "siwsSig": "60ee28c515c7633791cd64d4cd91381d346fa46e8e44722f7988e8b27eed260904e088e9356c04c33af598ffd55ba79a27d48b7acb67a6620f0a363383ab6a09"
} as const;
