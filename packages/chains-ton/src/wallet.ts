import "./buffer.js";
import { type Address, type Cell, type MessageRelaxed, SendMode, beginCell, external, storeMessage, storeStateInit } from "@ton/core";
import { WalletContractV4, WalletContractV5R1 } from "@ton/ton";

/**
 * Wallet contract. v5r1 (W5) is the default: it's what Tonkeeper, MyTonWallet and the TON docs create today,
 * allows up to 255 messages per transfer and binds the network into the wallet id (so the same key has a
 * different address on mainnet and testnet). v4r2 is available as a module option for keys that already hold
 * funds there (4 messages per transfer). The vault records which one an account uses; both are computed with
 * @ton/ton's own contract classes.
 *
 * v4r2's wallet id (in every signed message) has no network in it: with the standard id on both networks, a transfer
 * signed on testnet could be replayed on mainnet by anyone who saw it (audit CHAIN-L). So v4r2 uses the standard id
 * (698983191 + workchain, what Trust Wallet and Tonkeeper use) on mainnet only, and a network-bound id elsewhere:
 * the standard id XOR the network's global_id. A v4r2 testnet wallet therefore has its own address.
 */
export type TonWalletVersion = "v5r1" | "v4r2";

export const MAX_MESSAGES: Record<TonWalletVersion, number> = { v5r1: 255, v4r2: 4 };

export type TonWallet = WalletContractV5R1 | WalletContractV4;

/** TON mainnet's global_id. */
const MAINNET_GLOBAL_ID = -239;
/** The standard v4r2 subwallet id for workchain 0. */
export const V4_STANDARD_WALLET_ID = 698983191;

/** v4r2 wallet id: the standard one on mainnet, bound to the network's global_id anywhere else. */
export function v4WalletId(globalId: number): number {
  return globalId === MAINNET_GLOBAL_ID ? V4_STANDARD_WALLET_ID : (V4_STANDARD_WALLET_ID ^ (globalId >>> 0)) >>> 0;
}

export function walletFor(publicKey: Uint8Array, globalId: number, version: TonWalletVersion): TonWallet {
  if (publicKey.length !== 32) throw new Error("ed25519 public key must be 32 bytes");
  const pk = Buffer.from(publicKey);
  if (version === "v4r2") return WalletContractV4.create({ workchain: 0, publicKey: pk, walletId: v4WalletId(globalId) });
  return WalletContractV5R1.create({
    walletId: { networkGlobalId: globalId, context: { walletVersion: "v5r1", workchain: 0, subwalletNumber: 0 } },
    publicKey: pk,
  });
}

/** User-facing form: non-bounceable ("UQ…" / "0Q…" on testnet), as TEP-2 recommends for wallets. */
export function friendly(a: Address, testnet: boolean, bounceable = false): string {
  return a.toString({ urlSafe: true, bounceable, testOnly: testnet });
}

export function stateInitBoc(w: TonWallet): string {
  return beginCell().store(storeStateInit(w.init)).endCell().toBoc().toString("base64");
}

export interface TransferPlan {
  seqno: number;
  /** Unix seconds after which the wallet refuses the message. */
  timeout: number;
  messages: MessageRelaxed[];
  /** Include the wallet's StateInit (first transaction of an uninitialized wallet). */
  deploy: boolean;
}

/** PAY_GAS_SEPARATELY + IGNORE_ERRORS (3), as TON Connect asks wallets to use. */
export const SEND_MODE = SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS;

/**
 * The wallet's signed body, built with @ton/ton's signer hook: `sign` receives the signing-message cell and
 * returns the 64-byte signature. The vault signs `cell.hash()` (32 bytes) with ed25519.
 */
export async function transferBody(w: TonWallet, plan: TransferPlan, sign: (signingMessage: Cell) => Promise<Buffer>): Promise<Cell> {
  const args = { seqno: plan.seqno, timeout: plan.timeout, messages: plan.messages, sendMode: SEND_MODE, signer: sign };
  return w instanceof WalletContractV5R1 ? w.createTransfer(args) : w.createTransfer(args);
}

/** The hash the vault signs for this plan. */
export async function signingHash(w: TonWallet, plan: TransferPlan): Promise<Uint8Array> {
  let h: Uint8Array | null = null;
  await transferBody(w, plan, async (cell) => {
    h = new Uint8Array(cell.hash());
    return Buffer.alloc(64);
  });
  return h!;
}

/** External-in message (BoC, base64) carrying the signed body, with the StateInit on first use. */
export function externalBoc(w: TonWallet, body: Cell, deploy: boolean): string {
  const msg = external({ to: w.address, body, ...(deploy ? { init: w.init } : {}) });
  return beginCell().store(storeMessage(msg)).endCell().toBoc().toString("base64");
}
