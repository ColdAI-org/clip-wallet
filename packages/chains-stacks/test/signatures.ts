/**
 * Signature fixtures, computed once OFFLINE (outside the repo) with the vault's own derivation and signEcdsa
 * (packages/vault/src/derive.ts + sign.ts: RFC 6979, low-S) from the public BIP-39 test vector ("abandon" x11 +
 * "about", empty passphrase) at m/44'/5757'/0'/0/0, this module's derivationPath(0). Each is r ‖ s (hex) ":" recovery
 * id over the digest named in the key (see stacks.test.ts). The same key in @stacks/wallet-sdk account 0 gives the
 * addresses below (packages/vault/test/families87.test.ts cross-checks it).
 *
 * AGENTS.md rule 1: no key or signing code outside packages/vault, tests included, so only the public key, addresses,
 * digests' signatures and transactions live here.
 */
export const FIX = {
  publicKey: "03d5d038bce81b3965314dba54f636f093c7dbdd6617cded013a53474fbccb100c",
  mainnet: "SPC5KHM41H6WHAST7MWWDD807YSPRQKJ69FSH54J",
  testnet: "STC5KHM41H6WHAST7MWWDD807YSPRQKJ68T330BQ",
  /** Account 1 (m/44'/5757'/0'/0/1): somebody else in these tests. */
  otherPublicKey: "03121507b88c654be90c0973965b73f5b25597c393eb95b0a206d4217ee725582a",
  otherTestnet: "ST3XHES5990FYDV5BHBZCJRFYFD2Z4X3FMEXRWMFR",
  otherMainnet: "SP3XHES5990FYDV5BHBZCJRFYFD2Z4X3FMD2N3MGH",
  sigs: {
    "023eefe248a241dc": "6e6b626f22bd3431538ff513e8e11f300ab09ae80c589b3bb90a2612ecd95b39465fc9ace88e8cadc6d33013409ee145c9cb877317cedd371fd78908e40acb17:1",
    "18bc87706cfb6b18": "be895ec7db80feca54973e3d53e576d95092a3f74865151171d6af31c2c26af70ffe7cc7c04ec4e26f0e408bc6123b9121bfcf3aa239754805ff547ab1a91e79:1",
    "1b92e41fd31680e9": "9b00251402906769d067fe62345d7aa558a5373ffd7b85476ed166e329e1cbd36d51163cd092eb8043a7341c4c34621b343c2f6c1094b70f2ff16e7be5cf0413:0",
    "42ae84c80bad64c6": "ce7d75016b3b5849e18686f33e96e1a37e31542ba7a5f650342f57506ac17d3d519f052dbb34d90d593efe8b9fb2f43f909738f9b852418e13da632bddc39099:0",
    "6a5ac20b47bfa132": "034c974129a8c23984f70424b779f08144286fe474dc47914c53119e66fff3850b676597638fba39058a382a30e352ee1a02947f463e4732edbf746a870ef4a6:0",
    "7d9f2007d107aab5": "0f237bae10f1697ce956c4c546fccb13882f8c85aa5a75482e41a297c754dab20511b27533aa97d5e08af1e07489bb8653ef21c94cd88925dabeb95a22cfabd0:0",
    "e5663eecbcd636b9": "0e0a4ad500c541cbf992305796bd9e0cdf166c6ae80f480858350e530b2281ae7640f79ce411bbe67c5ef74d57b6d8b7b7020d32ec3ee208e2513b680f47be3c:1",
  } as Record<string, string>,
};
