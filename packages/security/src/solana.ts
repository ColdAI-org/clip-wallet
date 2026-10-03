import { type ChainContext, ClipError, type DappRequest } from "@clip-wallet/core";
import { SolanaRpc, TOKEN_2022_PROGRAM, clusterOf } from "@clip-wallet/chains-solana";
import {
  type Instruction,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { randomId } from "./util.js";

/** A token account as `getTokenAccountsByOwner` (jsonParsed) returns it. */
export interface ParsedTokenAccount {
  pubkey: string;
  /** Token program that owns it (Tokenkeg… or Token-2022). */
  program: string;
  lamports: number;
  mint: string;
  owner: string;
  state: "initialized" | "frozen" | string;
  amount: string;
  decimals: number;
  isNative: boolean;
  delegate?: string;
  delegatedAmount?: string;
}

export const TOKEN_PROGRAMS = [TOKEN_PROGRAM_ADDRESS as string, TOKEN_2022_PROGRAM];

export function rpcFor(ctx: ChainContext): SolanaRpc {
  const url = ctx.network.rpcUrls[0];
  if (!url) throw new ClipError("Solana isn't reachable right now.", "security/no-rpc");
  return new SolanaRpc(url, ctx.fetch);
}

interface RawTokenAccount {
  pubkey: string;
  account: {
    lamports: number;
    owner: string;
    data: {
      parsed?: {
        type?: string;
        info?: {
          mint: string;
          owner: string;
          state: string;
          isNative?: boolean;
          tokenAmount: { amount: string; decimals: number };
          delegate?: string;
          delegatedAmount?: { amount: string };
        };
      };
    };
  };
}

/** Every SPL Token and Token-2022 account you own (https://solana.com/docs/rpc/http/gettokenaccountsbyowner). */
export async function ownerTokenAccounts(ctx: ChainContext): Promise<ParsedTokenAccount[]> {
  const rpc = rpcFor(ctx);
  const out: ParsedTokenAccount[] = [];
  for (const programId of TOKEN_PROGRAMS) {
    const res = await rpc.call<{ value: RawTokenAccount[] }>("getTokenAccountsByOwner", [
      ctx.account.address,
      { programId },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]);
    for (const r of res.value ?? []) {
      const info = r.account.data.parsed?.info;
      if (!info || r.account.data.parsed?.type !== "account" || info.owner !== ctx.account.address) continue;
      out.push({
        pubkey: r.pubkey,
        program: r.account.owner ?? programId,
        lamports: r.account.lamports,
        mint: info.mint,
        owner: info.owner,
        state: info.state,
        amount: info.tokenAmount.amount,
        decimals: info.tokenAmount.decimals,
        isNative: !!info.isNative,
        delegate: info.delegate,
        delegatedAmount: info.delegatedAmount?.amount,
      });
    }
  }
  return out;
}

/** One unsigned v0 transaction paid by you, as a wallet-built request on the normal approval path. */
export async function solanaRequest(instructions: Instruction[], ctx: ChainContext): Promise<DappRequest> {
  const rpc = rpcFor(ctx);
  const me = address(ctx.account.address);
  const { value: latest } = await rpc.call<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(me, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: latest.blockhash as never, lastValidBlockHeight: BigInt(latest.lastValidBlockHeight) }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const wire = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
  let bin = "";
  for (const b of wire) bin += String.fromCharCode(b);
  const cluster = clusterOf(ctx.network.id);
  return {
    id: randomId(),
    origin: "wallet",
    via: "injected",
    family: "solana",
    networkId: ctx.network.id,
    method: "solana:signAndSendTransaction",
    params: { inputs: [{ account: me, transaction: btoa(bin), chain: cluster ? `solana:${cluster}` : ctx.network.id }] },
  };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function lamportsText(lamports: bigint | number): string {
  const v = Number(lamports) / 1e9;
  if (v === 0) return "0 SOL";
  if (v < 0.0001) return "<0.0001 SOL";
  return `${v.toLocaleString("en-US", { maximumFractionDigits: v < 0.01 ? 4 : 3 })} SOL`;
}
