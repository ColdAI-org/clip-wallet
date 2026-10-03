/**
 * Signature fixtures, computed once offline (outside this repository) by the public BIP-39 test-vector account
 * ("abandon … about") at the Aptos SDK hardened path m/44'/637'/0'/0'/0'. AGENTS.md rule 1: no signing code
 * outside packages/vault, tests included, so only the address, public key, transaction bytes and signatures live here.
 * The tests only verify them. All transactions: testnet (chain id 2), sequence 3, max gas 2000, gas price 100,
 * expiry 1800000000.
 *
 *  - transfer: 0x1::aptos_account::transfer(bob, 1.5 APT); transferSig / transferAuthenticator / transferSigned are the
 *    SDK's own signature, AccountAuthenticatorEd25519 BCS and SignedTransaction BCS for it
 *  - usdcTransfer: 0x1::primary_fungible_store::transfer<Metadata>(testnet USDC, bob, 2.5 USDC) (decode only)
 *  - swap: 0xabab…::router::swap_exact_input<AptosCoin>(0.1, 1) (decode only)
 *  - sponsored: bob → me 5 octas with a fee-payer slot (0x0); feePayerSig is this account signing as fee payer
 *  - messageSig: over fullMessage (aptos:signMessage with address, application and chainId)
 */
export const FIX = {
  "me": "0xeb663b681209e7087d681c5d3eed12aaa8e1915e7c87794542c3f96e94b3d3bf",
  "publicKey": "a686f0309ab80312979606cfccc10ea2740147ae6888351488d11c46f08fbf60",
  "bob": "0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0",
  "usdc": "0x69091fbab5f7d635ee7ac5098cf0c1efbe31d68fec0f2cd565e8d168daf52832",
  "transfer": "62Y7aBIJ5wh9aBxdPu0SqqjhkV58h3lFQsP5bpSz078DAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ1hcHRvc19hY2NvdW50CHRyYW5zZmVyAAIgsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLAIgNHwCAAAAADQBwAAAAAAAGQAAAAAAAAAANJJawAAAAACAA==",
  "transferSig": "5ecdc1fcba2597db4756a88443bbacbbb9fbe0da2fcc1e854c29dca674339b207be36d0167be29b401733ad872d921aa85effb32144bfab913025cacf0a05f01",
  "transferAuthenticator": "ACCmhvAwmrgDEpeWBs/MwQ6idAFHrmiINRSI0RxG8I+/YEBezcH8uiWX20dWqIRDu6y7ufvg2i/MHoVMKdymdDObIHvjbQFnvim0AXM62HLZIaqF7/syFEv6uRMCXKzwoF8B",
  "transferSigned": "62Y7aBIJ5wh9aBxdPu0SqqjhkV58h3lFQsP5bpSz078DAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ1hcHRvc19hY2NvdW50CHRyYW5zZmVyAAIgsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLAIgNHwCAAAAADQBwAAAAAAAGQAAAAAAAAAANJJawAAAAACACCmhvAwmrgDEpeWBs/MwQ6idAFHrmiINRSI0RxG8I+/YEBezcH8uiWX20dWqIRDu6y7ufvg2i/MHoVMKdymdDObIHvjbQFnvim0AXM62HLZIaqF7/syFEv6uRMCXKzwoF8B",
  "usdcTransfer": "62Y7aBIJ5wh9aBxdPu0SqqjhkV58h3lFQsP5bpSz078DAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARZwcmltYXJ5X2Z1bmdpYmxlX3N0b3JlCHRyYW5zZmVyAQcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ5mdW5naWJsZV9hc3NldAhNZXRhZGF0YQADIGkJH7q199Y17nrFCYzwwe++MdaP7A8s1WXo0Wja9SgyILCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwCKAlJgAAAAAA0AcAAAAAAABkAAAAAAAAAADSSWsAAAAAAgA=",
  "swap": "62Y7aBIJ5wh9aBxdPu0SqqjhkV58h3lFQsP5bpSz078DAAAAAAAAAAKrq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urqwZyb3V0ZXIQc3dhcF9leGFjdF9pbnB1dAEHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEKYXB0b3NfY29pbglBcHRvc0NvaW4AAgiAlpgAAAAAAAgBAAAAAAAAANAHAAAAAAAAZAAAAAAAAAAA0klrAAAAAAIA",
  "sponsored": "sLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLADAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ1hcHRvc19hY2NvdW50CHRyYW5zZmVyAAIg62Y7aBIJ5wh9aBxdPu0SqqjhkV58h3lFQsP5bpSz078IBQAAAAAAAADQBwAAAAAAAGQAAAAAAAAAANJJawAAAAACAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "feePayerSig": "e3a6a9b21809e0b61f3971ad9f3f78ce34e3e9937b686acbd24b4a4d255526d01fe0ddf019a1dedcadcaabd42c8dcd10c82d2352fde051d9b3dc57d52a563b09",
  "fullMessage": "APTOS\naddress: 0xeb663b681209e7087d681c5d3eed12aaa8e1915e7c87794542c3f96e94b3d3bf\napplication: https://app.example\nchainId: 2\nmessage: Welcome to app.example\nnonce: 8f2c",
  "messageSig": "769348f6df89013c166e439197cd4e51fe4d2b6909c659da4ac68f1ad86e0c6d7ead4730eef57e3103ecc1c60afe8b48db68417be6f836fa855bece0eabfed02"
} as const;
