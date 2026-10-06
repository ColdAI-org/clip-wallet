/**
 * Signatures computed once OFFLINE (outside the repo) with the vault's own `deriveFamilyKey` + `signEcdsaCanonical`
 * (RFC 6979 with the canonical-K1 retry counter, low-S) for the public BIP-39 test vector ("abandon" ×11 + "about",
 * empty passphrase) at m/44'/194'/0'/0/0, over SHA-256(chain_id ‖ packed_trx ‖ 32 zero bytes) of the fixtures in
 * ./fixtures.ts on Jungle4. r ‖ s hex and the recovery id, as the vault returns them. AGENTS.md rule 1: only
 * signatures live here, never keys or signing code.
 */
export const SIGS = {
  EOS_SEND: { rs: "3684361037bd1a9a964e95b027298504ce3cdcb0f363717621423626685a97a95f10044be5e1f7a00b0a1b32d5b5517401e3eed48d671e22bbd997ad4863a597", recovery: 0 },
  TAKEOVER: { rs: "080f15df8c332fe9467f33ccd1ba28a5b5ad32c1dc4cb4bc0e6d6544f9ec863614155ea9b6f31d8a21cb5ed6a292c3d78bb1e89b54311da28a66d7b6ccfae486", recovery: 0 },
} as const;
