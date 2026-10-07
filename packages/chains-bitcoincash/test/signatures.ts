/**
 * Signature fixtures, computed once OFFLINE (outside the repo) with the vault's own derivation and signEcdsa
 * (packages/vault/src/derive.ts + sign.ts: RFC 6979, low-S) from the public BIP-39 test vector ("abandon" x11 +
 * "about", empty passphrase) at m/44'/145'/0'/0/0, this module's derivationPath(0). Each is r ‖ s (hex) ":" recovery
 * id over a digest the tests compute (BCH sighashes and the signed-message hash). packages/vault/test/families87.test.ts
 * cross-checks the key's CashAddr against libauth.
 *
 * AGENTS.md rule 1: no key or signing code outside packages/vault, tests included, so only the public key, addresses
 * and signatures live here.
 */
export const FIX = {
  publicKey: "02bbe7dbcdf8b2261530a867df7180b17a90b482f74f2736b8a30d3f756e42e217",
  mainnet: "bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6",
  testnet: "bchtest:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnqseeszx8x",
  /** Account 1 (m/44'/145'/0'/0/1): somebody else in these tests. */
  otherPublicKey: "0262f8bf1ab1d25111c569da0133c30f8b3fa411e2f8af2565d3f0111cb34ae7f6",
  otherTestnet: "bchtest:qp8sfdhgjlq68hlzka9lcsxtcnvuvnd0xqzwvwq4lg",
  otherMainnet: "bitcoincash:qp8sfdhgjlq68hlzka9lcsxtcnvuvnd0xqxugfzzc5",
  sigs: {
    "061c3e26ecd3fb3b": "d42f98751a7a11c7a7bb577c01f8f9b6a9081314635ecefdabbb8db0904b897630b40df6ce4acb0ff7cc1ed66471da2af443aa35f12b8b8765972ba6f36c8041:0",
    "2415758ece436187": "3aff570529e371a06bc8d5530d53668d2de9ceb6508637cd88c993290164a08d51fd2386761a3100cdf45aa052c8dc8ef419f1fa1b4f3e1ec3efcd47cd3b9ba0:0",
    "7b77e855492ffd3c": "6950dab1c3b282610d55a44b42418ee71f7126d0c6dcc108b35e55382b64be372fc45f1bf2a47b3ac6b24227dfa80bb78bbeb5464d5dca9b085d66b4756db905:0",
  } as Record<string, string>,
};
