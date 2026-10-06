/**
 * Signatures computed once OFFLINE (outside the repo) with the vault's own `deriveFamilyKey` + `signEcdsa` (RFC 6979,
 * low-S) for the public BIP-39 test vector ("abandon" ×11 + "about", empty passphrase) at m/44'/144'/0'/0/0, over
 * SHA-512Half(0x53545800 ‖ signing fields) of the fixtures in ./fixtures.ts. r ‖ s hex, as the vault returns them.
 * AGENTS.md rule 1: no key or signing code outside packages/vault, so only these signatures live here.
 */
export const SIGS = {
  XRP_SEND: "12da991c97431ada3ee86aca1691c9d5bb4ad021c2383e362d694d8fa3a4c54c5d076277f19f17403febdb25bb290699e29dd04290d103c58f6347d233eca2ed",
  RLUSD_SEND: "500f1cf861d41c9841b763c712265a0587d4dc36f22f940ad21891086b942d432fea9b5c0b2f0d7f98a3e8ec10352a1e1d6826cc71a8f83ce3a8d60b99f5e2f4",
  DAPP_FILLED: "6cee20e9dc97524e11090f22d07b79760c0595790d61eec9775fb731aad614bb2ebd79ca116c7372c30b4772412e3bc88628a42a384ade646f38efc3643e53ae",
} as const;
