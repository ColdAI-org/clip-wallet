/**
 * Signature fixtures. The account is the public BIP-39 test vector ("abandon" ×11 + "about", empty passphrase)
 * derived with SLIP-10 ed25519 at m/44'/1729'/0'/0'. Signatures were computed once OFFLINE, outside the repo, with a
 * throwaway script (AGENTS.md rule 1: no signing code outside packages/vault, tests included). Only the public key,
 * address, signed payload descriptions and signatures live here.
 *
 * The address/public key equal the WalletConnect `tezos_getAccounts` example
 * (docs.reown.com/advanced/multichain/rpc-reference/tezos-rpc): tz1VQA4…h5GL / edpku4US…Dvf.
 */
export const FIX = {
  path: "m/44'/1729'/0'/0'",
  publicKey: "370ffb098088e67f8284ca4938f8f1eac02c3e2ab150f29adc8a7075a5ce7e63",
  address: "tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GL",
  edpk: "edpku4US3ZykcZifjzSGFCmFr3zRgCKndE82estE4irj4d5oqDNDvf",
} as const;

/**
 *  - xtzSend: blake2b-256(0x03 ‖ forged) for "send 5 XTZ to tz1cJ9…ioGP", fee 481, counter 25155454, gas 2269,
 *    branch BMKoX9…WVc (the tezos_send test).
 *  - signIn: blake2b-256 of the Micheline-packed "Tezos Signed Message: https://app.example 2026-10-03T00:00:00Z Sign in to App".
 */
export const SIGS = {
  xtzSend: "4d83f138f84a1c09e654196b3cc250a7a5bd3cfcc6cffe98e263eacbd56cc6458a784fb9d5df3e4d504c2a0bd55847e06877feb03fd18c1975f230fecb6c020d",
  signIn: "4cb2e9fbd2e349e4353f45e84fdaaff98dc269fba3fbc84a1b942e1c6d310a91f1a8bc7fa31bf8263dcfb00bce5db67f08888a92c5443d501d6e964ff4623f01",
} as const;
