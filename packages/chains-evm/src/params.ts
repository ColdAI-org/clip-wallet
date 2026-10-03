/** Parsing and validating dapp request params. Everything here throws ClipError with plain words. */
import { ClipError, type ChainContext, type DappRequest } from "@clip-wallet/core";
import { type Hex, type TypedDataDefinition, isAddress, isAddressEqual, isHex } from "viem";

export interface TxParams {
  from: `0x${string}`;
  to?: `0x${string}`;
  value: bigint;
  data: Hex;
  gas?: bigint;
}

const bad = (msg: string) => new ClipError("This request from the app is malformed, so we stopped it.", "bad-request", msg);

function quantity(v: unknown, field: string): bigint | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string" && isHex(v)) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "bigint") return v;
  throw bad(`${field} is not a quantity`);
}

export function assertOwnAddress(ctx: ChainContext, address: unknown): void {
  if (typeof address !== "string" || !isAddress(address) || !isAddressEqual(address, ctx.account.address as `0x${string}`)) {
    throw new ClipError("This request is for a different account than the one you're using.", "wrong-account");
  }
}

export function parseTx(req: DappRequest, ctx: ChainContext): TxParams {
  const p = Array.isArray(req.params) ? req.params[0] : req.params;
  if (!p || typeof p !== "object") throw bad("missing transaction object");
  const t = p as Record<string, unknown>;
  const from = (t.from ?? ctx.account.address) as string;
  assertOwnAddress(ctx, from);
  if (t.to !== undefined && t.to !== null && (typeof t.to !== "string" || !isAddress(t.to))) throw bad("to is not an address");
  const data = (t.data ?? t.input ?? "0x") as string;
  if (typeof data !== "string" || !isHex(data)) throw bad("data is not hex");
  if (t.chainId !== undefined && ctx.network.chainId !== undefined && quantity(t.chainId, "chainId") !== BigInt(ctx.network.chainId)) {
    throw new ClipError("The app asked for a different network than the one selected. Switch networks in the app and try again.", "chain-mismatch");
  }
  const out: TxParams = { from: from as `0x${string}`, value: quantity(t.value, "value") ?? 0n, data: data as Hex };
  if (typeof t.to === "string") out.to = t.to as `0x${string}`;
  const gas = quantity(t.gas ?? t.gasLimit, "gas");
  if (gas !== undefined) out.gas = gas;
  return out;
}

/** personal_sign: [message, address] (some dapps send [address, message]). */
export function parsePersonalSign(req: DappRequest, ctx: ChainContext): { message: Hex | string } {
  const p = req.params as unknown[];
  if (!Array.isArray(p) || p.length < 2) throw bad("personal_sign needs [message, address]");
  const [a, b] = p as [unknown, unknown];
  const ownA = typeof a === "string" && isAddress(a) && isAddressEqual(a, ctx.account.address as `0x${string}`);
  const message = ownA && !(typeof b === "string" && isAddress(b)) ? b : a;
  const address = message === a ? b : a;
  assertOwnAddress(ctx, address);
  if (typeof message !== "string") throw bad("message is not a string");
  return { message };
}

export type TypedData = TypedDataDefinition & { domain: Record<string, unknown>; message: Record<string, unknown>; primaryType: string; types: Record<string, { name: string; type: string }[]> };

export function parseTypedData(req: DappRequest, ctx: ChainContext): TypedData {
  const p = req.params as unknown[];
  if (!Array.isArray(p) || p.length < 2) throw bad("eth_signTypedData_v4 needs [address, data]");
  assertOwnAddress(ctx, p[0]);
  let td: unknown = p[1];
  if (typeof td === "string") {
    try {
      td = JSON.parse(td);
    } catch {
      throw bad("typed data is not JSON");
    }
  }
  const o = td as Record<string, unknown>;
  if (!o || typeof o !== "object" || typeof o.primaryType !== "string" || !o.types || !o.message) throw bad("typed data is incomplete");
  return { ...(o as object), domain: (o.domain ?? {}) as Record<string, unknown> } as TypedData;
}

/** Typed data without EIP712Domain in `types` (viem derives it from `domain`). */
export function typedDataForHash(td: TypedData): TypedDataDefinition {
  const { EIP712Domain: _ignored, ...types } = td.types;
  return { domain: td.domain as TypedDataDefinition["domain"], types, primaryType: td.primaryType, message: td.message } as TypedDataDefinition;
}
