/**
 * Signature fixtures, computed once OFFLINE (outside the repo) from the public BIP-39 test vector ("abandon" ×11 +
 * "about", empty passphrase), SLIP-10 ed25519 at m/44'/508'/0'/0'/0' (derivationPath(0)), with the vault's own
 * derive + sign code. The address equals sdk-core `Mnemonic.fromString(…).deriveKey(0)` (packages/vault
 * test/families87.test.ts checks that). Only the public key, addresses, payloads and signatures live here.
 *
 *  - egld: buildTransfer of 1.5 EGLD me → bob on devnet, nonce 7, gas 50,000 × 1 gwei (the signed bytes are
 *    sdk-core computeBytesForSigning of that transaction)
 *  - usdc: buildTransfer of 2.5 USDC (USDC-350c4e) me → bob, "ESDTTransfer@…@2625a0", gas 413,000
 *  - message: mvx_signMessage "Sign in to app.example" (signature over the 32-byte MessageComputer hash)
 * bob is bech32("erd", sha256("bob")): nobody holds its key.
 */
export const FIX = {
  publicKey: "802f21af709d092b69c7a3ca509d8ff91e8388a136419a359ca0fe954fcc0458",
  me: "erd1sqhjrtmsn5yjk6w85099p8v0ly0g8z9pxeqe5dvu5rlf2n7vq3vqytny9g",
  bob: "erd1sxmr0k8u6trd5c6eu6trzyapzux7090ykujmsng7pdx0m8k93n5s48kwzk",
  egldSig: "254d766ce178bf8683ef3d591a522878657f2a7d483543cafe4f1139988a242a7d9aaf052d7be1f0c41603cbbbb3de33857d97f335b172572e04029516f5f70e",
  usdcSig: "d214629a26b044b6460502069692a495c08b89ed40efa9053475a01eab161af66987569814c5267d8563e643045f54ddf2f3d1bfedfdc00bb2cbc7a1e2269604",
  message: "Sign in to app.example",
  messageSig: "e113110bdab522e665b3ec0c6b164aa3ba65bd569ce2c92c6636167273d2493929655a9ca39505b5b8130e248ba0b6dd0df85b8058928b2876893a5eacee9306",
} as const;
