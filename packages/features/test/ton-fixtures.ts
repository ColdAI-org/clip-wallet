import type { Account, ChainContext, Network } from "@clip-wallet/core";
import { TON_MAINNET, TON_TESTNET, addressCellHex, tonModule } from "@clip-wallet/chains-ton";

/** Public key only, from packages/chains-ton/test/signatures.ts (FIX.publicKey). No private key exists here. */
export const TON_PUB = "4ab9e5d394a7d21e58523aa1c1175a8ae372747ca61112a0a1943f45ef74081d";

export const TON_MAIN: Network = { ...TON_MAINNET, rpcUrls: ["https://toncenter.test/api"], indexerUrl: "https://tonapi.test" };
export const TON_TEST: Network = { ...TON_TESTNET, rpcUrls: ["https://testnet.toncenter.test/api"], indexerUrl: "https://testnet.tonapi.test" };

export function tonAccount(network: Network): Account {
  const w = tonModule.walletAddress(Uint8Array.from(Buffer.from(TON_PUB, "hex")), network);
  return { id: "ton:0", family: "ton", index: 0, curve: "ed25519", derivationPath: "m/44'/607'/0'", publicKey: TON_PUB, address: w.friendly };
}

export function tonMe(network: Network): string {
  return tonModule.walletAddress(Uint8Array.from(Buffer.from(TON_PUB, "hex")), network).raw;
}

export const tonCtx = (network: Network, f: typeof fetch): ChainContext => ({ network, account: tonAccount(network), fetch: f });

/** tonapi get_wallet_data answer for a jetton wallet. */
export function walletData(owner: string, master: string) {
  return {
    success: true,
    exit_code: 0,
    stack: [
      { type: "num", num: "0x0" },
      { type: "cell", cell: addressCellHex(owner) },
      { type: "cell", cell: addressCellHex(master) },
      { type: "cell", cell: "b5ee9c72010101010002000000" },
    ],
  };
}

/** A raw address made of one repeated byte (labels only). */
export const rawOf = (byte: number) => `0:${byte.toString(16).padStart(2, "0").repeat(32)}`;
