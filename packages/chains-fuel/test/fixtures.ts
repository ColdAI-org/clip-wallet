import type { Account } from "@clip-wallet/core";

/**
 * Fixtures for the public BIP-39 test account ("abandon" ×11 + "about"), Fuel path m/44'/1179993420'/i'/0/0.
 * Public keys come from the vault's deriveAccount; signatures were made OFFLINE with the vault's signEcdsa over the
 * digests below (RFC 6979, low-S, recovery id separate) and pasted here. Nothing secret.
 */
export const ACCOUNT0 = {
  publicKey: "026760754232b8ae531b05039f630cf2549027d47dfe6af603f7504616602dfcd2",
  address: "0x806EC69A1bC1398877A7327c467EE09511B3f26DcfB55b305D8ea2cd2c285b89",
};
export const ACCOUNT1 = {
  publicKey: "02299ba5cbc5529234b97541ee4067d57a02fad90b2b5778a1012dc0510496a57e",
  address: "0x033d76e24F5D3b02966B27932d9D88008175739642951103b1074f90b3785E17",
};

export const ME = ACCOUNT0.address.toLowerCase();
export const OTHER = ACCOUNT1.address.toLowerCase();
export const ETH = "0xf8f8b6283d7fa5b672b530cbb84fcccb4ff8dc40f8176ef4544ddb1f1952ad07";
export const USDC_TESTNET = "0xc26c91055de37528492e7e97d91c6f4abe34aae26f2c4d25cff6bfe45b5dc9a9";
export const CONTRACT = "0xd02112ef9c39f1cea7c8527c26242ca1f5d26bcfe8d1564bee054d3b04175471";

export function account(): Account {
  return {
    id: "fuel:0",
    family: "fuel",
    index: 0,
    curve: "secp256k1",
    derivationPath: "m/44'/1179993420'/0'/0/0",
    publicKey: ACCOUNT0.publicKey,
    address: ACCOUNT0.address,
  };
}

/**
 * A 1-unit ETH transfer to account 1 on the testnet, as createFuelModule().buildTransfer built it against
 * testnet.fuel.network (Oct 2026). Its id was checked against fuels-ts `getTransactionId(0)`, and the transaction
 * signed with SIG.transfer passed `dryRun(utxoValidation: true)` on the testnet.
 */
export const TRANSFER_TX = {
  type: 0,
  gasLimit: "0x40",
  script: "0x24000000",
  scriptData: "0x",
  maxFee: "0xa8",
  inputs: [
    {
      type: 0,
      id: "0xb923732656179a9a2f8f6b4af195fccfc7f7c0f11f63f03e512b4dc82b50fbb50001",
      owner: ME,
      amount: "0x197ae8",
      assetId: ETH,
      txPointer: "0x00000000000000000000000000000000",
      witnessIndex: 0,
      predicateGasUsed: "0x0",
      predicate: "0x",
      predicateData: "0x",
    },
  ],
  outputs: [
    { type: 0, to: OTHER, amount: "0x1", assetId: ETH },
    { type: 2, to: ME, assetId: ETH },
  ],
  witnesses: [`0x${"00".repeat(64)}`],
};
export const TRANSFER_ID = "0x1c39032b4f6237be5d831674d66198ba847cf258dcfc772afbcb77dec1d630f5";

export const TEXT_MESSAGE = "Clip Wallet dapp matrix: sign-in check (testnet)";

/** r ‖ s (64 bytes hex) + recovery id, by digest. */
export const SIG = {
  transfer: { digest: TRANSFER_ID.slice(2), rs: "0e8e8250685cf95cf04184ecbfa6036a6f39d18b9f8487d4cd800561abe89a957c844a5bd036c05ac6a556587c0224c4d70d2614d8b8f80bb775c563f89eb8fd", recovery: 1 },
  text: { digest: "b039b8d8acf23193ca9097154740fd177a933f8c4e86b79d00e575a026e93b38", rs: "990aa9ea2bd26a2994dd486b18c11c7fa81f2a68066a93de4ff7bbcf07e5262124664d9fb670ee07f9313f878f192339bf26452a46ada233d029baff7ca98256", recovery: 0 },
  /** { personalSign: "Hello Fuel" } */
  personal: { digest: "3d47a86470d42088052ed1b8253c8825b8b433b3f1e1f71f9cd9e59087159125", rs: "4ebf51e401d4f4d52f27aba898a8bd58d921620f8051c036d83196aa045dd3ad3b90dee33f9673ad8418a12db8ef85be7e04194776d07a9c9caf1deee9f41ed9", recovery: 1 },
  /** { personalSign: bytes 0xdeadbeef } */
  personalHex: { digest: "bee139ab826234d6edba1c8688a15dd51567bb7abebcff664f2f4c217c07d89d", rs: "f132fad4e1451385762c02c837d4a31441d0e5545759d984b299dc26b01da8eb18f2aac7007dda6b6b323d78eb4859fb4c364d6164d3f9b35a25757ab56280a2", recovery: 1 },
  /** Over sha256("not the request"): a valid signature by this key for something else. */
  other: { digest: "be3ddd57830a8596c34e9bae289e0c10b1591311b3ddedaa397f54882ef2d8e6", rs: "ccc8e27d58bf7fb705e36b095a125e17003e4fcf5194b46d2ff0b7d42cf9ce190df9e67bee73b39caae9de34a5373a932a2a1e9418aceb696fbff31dab3c4d57", recovery: 1 },
};

/** Consensus parameters as both endpoints reported them (Oct 2026). */
export const CHAIN = (chainId: number) => ({
  chain: {
    consensusParameters: {
      chainId: String(chainId),
      baseAssetId: ETH,
      txParams: { maxInputs: "255", maxOutputs: "255", maxGasPerTx: "30000000", maxSize: "112640" },
      feeParams: { gasPriceFactor: "1150000", gasPerByte: "1" },
      gasCosts: {
        ecr1: "31208",
        vmInitialization: { base: "4846", unitsPerGas: "39" },
        s256: { base: "36", unitsPerGas: "3" },
        contractRoot: { base: "36", unitsPerGas: "2" },
      },
    },
  },
});
