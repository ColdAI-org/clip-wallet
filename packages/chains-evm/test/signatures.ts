/**
 * Signatures over the fixture digests (test/fixtures.ts), made offline by the BIP-39 test-vector account
 * ("abandon … about", m/44'/60'/0'/0/0). No key material is in this repository: only the 65-byte
 * r||s||v results, which the tests check by recovering the public address.
 */
export const SIGS = {
  sendNative: "0x10f253b7e72bc9589c9b856fabca525dfc1781d7cde9dbc9615bcc6c3638da856f980a82a1c6178e482159038a6fee737ec8d60f5ed5d899e0696b88689bfb551b",
  sendLegacy: "0x479c692c265da8062983d010c8f8c855b4ac4550fa8c82bdcc173aa67554c22b3e2fc44a116526e9887323ca08d8fa97ddc1202c4ae6f9ed2411127d9248a5d81c",
  personal: "0x1ca8e328bc5c02ae487f5d880382e27ae116132b789e1bcf80e872a3c63a1bb973e0f9382f3c81214aeafc4908e0e5ac4a999b0a50e671ebf214c0a96ee3ddc61c",
  typed: "0x83a4e46de4b8b9d3ec594c78fa7fcee6f228d03f9e589579a36262863393d20876bf2a62a1ca6673446b3d5f0d48676f5dd43090a8c8eb3d23269c78241672221b",
} as const;
