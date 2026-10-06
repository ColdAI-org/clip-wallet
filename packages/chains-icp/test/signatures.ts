/**
 * Signature fixtures, computed once OFFLINE (outside the repo) from the public BIP-39 test vector ("abandon" ×11 +
 * "about", empty passphrase), secp256k1 at m/44'/223'/0'/0/0 (derivationPath(0)), with the vault's own derive +
 * signEcdsa (RFC 6979, low-S). The principal equals @dfinity/identity-secp256k1 `fromSeedPhrase(…).getPrincipal()`
 * (packages/vault test/families87.test.ts checks that). Only the public key, principals, payload digests and
 * signatures live here.
 *
 * Both requests are buildTransfer on the test network (TESTICP ledger xafvr-…-cai) with the helpers' fixed clock
 * (NOW = 1_790_000_000_000 ms) and nonce (16 × 0x07), fee 10,000 e8s, amount 1.5 TESTICP:
 *  - toPrincipal: icrc1_transfer to bob's principal. [call, read_state] signatures over
 *    SHA-256("\x0Aic-request" ‖ request id).
 *  - toAccountId: the ICP ledger's legacy `transfer` to bob's account identifier.
 */
export const FIX = {
  publicKey: "03abdb60eb7c96408414d1e251d41ca0ecf89a4541768cba7eed8174c53246d58c",
  me: "tgzar-4lpln-fq34h-6hxo4-wlm3x-6g3or-6hxvr-d6jbw-ooh2b-lzsw4-aqe",
  bob: "mnnk5-gfqmo-4omau-3uj75-wcco3-qwour-lsvsv-tmcw3-2kwze-f6orv-yqe",
  bobAccountId: "39837cd2d2dc28c9f9d1445ca4ed1115d1e72bd200cc7f463537aad571ad7a18",
  toPrincipalDigests: ["7f2f39c8874f40368760653fb7f504f817caf0098ff48cdbf528eebf62c602f9", "e7cf41d82f2594757f723739d724cbfad0a1e533378b75e375f9837e97bb6e8d"],
  toPrincipalSigs: [
    "bb2d386cd39d5eda8ce2762bab212afc5aa50a43b84ce6fcbb8270372a0c4ac325761149e52ed868a60fd1e46075fd0a7a795c5529a0fed5f575567fb5186364",
    "e9c695d912ba28744ef1dfa0ec9833a61bb0f55bda089ef4e0a72e0f211a3de71dee25de8b531b4134cdfd1232db1222fcd4c024c71c3622d8c4b39a6a2ecfb8",
  ],
  toAccountIdDigests: ["5bdfeea9c488597a26f42c2739b117eb75304f1045cf7ff5c1395e89e9bd5463", "ba6a9ff48a78dc81f68564749f65beaf55148ddf147510e938fd4cc4045d9064"],
  toAccountIdSigs: [
    "7c2d8009a277acc3de1205cad754641bed81c7cc56e7f29d186168bb47ce171b5a1eea764f4154505948016ed915a9b63d3120aea8e0421b47eb8be33b6cd5aa",
    "ff3e7bb1718eed3f5fcfc352261ee31c2e87351c2486acdb82626e2ca7bfebfb4694e40b12c7913790a9bc5aaf60d800a121423704f53e8deaf314e07f10fd64",
  ],
} as const;
