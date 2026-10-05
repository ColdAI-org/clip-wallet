/**
 * The EVM ChainModule. No key material here: prepare() returns 32-byte digests for the vault, finalize()
 * assembles the vault's signatures.
 *
 * prepare() → finalize() state: the unsigned transaction (nonce, fees, gas) is fixed in prepare() so the
 * digest the user approved is exactly what gets broadcast. It is kept in memory per module instance,
 * keyed by request id, and dropped after finalize(). Use one module instance per wallet session.
 */
import {
  ClipError,
  type AssetRef,
  type ChainContext,
  type ChainModule,
  type DappRequest,
  type Network,
  type Signature,
  type SignablePayload,
} from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  type Hex,
  type TransactionSerializable,
  bytesToHex,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  getTypesForEIP712Domain,
  hashMessage,
  hashTypedData,
  isAddress,
  isAddressEqual,
  keccak256,
  recoverAddress,
  serializeTransaction,
  toHex,
} from "viem";
import { getBalances, getNfts } from "./balances.js";
import { chainIdOf, estimateGas, quoteFees } from "./chain.js";
import { GAS_HEADROOM_TENTHS, decodeRequest, type FeeSnapshot } from "./decode.js";
import { parsePersonalSign, parseTx, parseTypedData, typedDataForHash } from "./params.js";
import { RpcError, rpc } from "./rpc.js";

type Pending =
  | { kind: "tx"; tx: TransactionSerializable; digest: Hex }
  | { kind: "sign"; digest: Hex };

export interface EvmModuleOptions {
  /** Request ids are random UUIDs by default; tests can pin them. */
  newId?: () => string;
}

export function derivationPath(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= 2 ** 31) throw new Error("account index out of range");
  return `m/44'/60'/0'/0/${index}`;
}

export function addressFromPublicKey(publicKey: Uint8Array): string {
  const uncompressed = publicKey.length === 65 ? publicKey : secp256k1.Point.fromBytes(publicKey).toBytes(false);
  return getAddress(`0x${keccak256(uncompressed.slice(1)).slice(-40)}`);
}

/** Signature → {r, s, yParity}, recovering yParity from the expected address when the vault leaves it out. */
async function toRsv(sig: Signature, digest: Hex, expected: string): Promise<{ r: Hex; s: Hex; yParity: number }> {
  if (sig.scheme !== "ecdsa-secp256k1" || sig.bytes.length !== 64) throw new ClipError("The signature didn't match this request.", "bad-signature");
  const r = bytesToHex(sig.bytes.slice(0, 32));
  // Normalise to low-s (EIP-2): flip s and the parity if the vault returned high-s.
  let sBig = BigInt(bytesToHex(sig.bytes.slice(32, 64)));
  const n = secp256k1.Point.CURVE().n;
  const candidates = sig.recovery === undefined ? [0, 1] : [sig.recovery];
  let flip = false;
  if (sBig > n / 2n) {
    sBig = n - sBig;
    flip = true;
  }
  const s = toHex(sBig, { size: 32 });
  for (const c of candidates) {
    const yParity = flip ? c ^ 1 : c;
    const addr = await recoverAddress({ hash: digest, signature: { r, s, yParity } });
    if (isAddressEqual(addr, expected as `0x${string}`)) return { r, s, yParity };
  }
  throw new ClipError("The signature didn't match your account, so nothing was sent.", "bad-signature");
}

export function createEvmModule(opts: EvmModuleOptions = {}): ChainModule & { pendingCount(): number } {
  const pending = new Map<string, Pending>();
  /** Fee terms each transaction's approval screen showed, by request id (audit EVM-04). */
  const feeSnapshots = new Map<string, FeeSnapshot & { at: number }>();
  const FEE_SNAPSHOT_TTL_MS = 15 * 60_000;
  const newId = opts.newId ?? (() => globalThis.crypto.randomUUID());

  const payload = (ctx: ChainContext, digest: Hex, approvalId: string): SignablePayload[] => [
    { accountId: ctx.account.id, scheme: "ecdsa-secp256k1", bytes: hexToU8(digest), approvalId },
  ];

  const mod: ChainModule & { pendingCount(): number } = {
    family: "evm",
    curve: "secp256k1",
    derivationPath,
    addressFromPublicKey: (publicKey: Uint8Array, _network: Network) => addressFromPublicKey(publicKey),
    isAddress: (value: string) => isAddress(value),
    /** Any EVM address is valid on every EVM network: callers must treat a result longer than 1 as "network-matters". */
    networksForAddress: (value: string, candidates: Network[]) => (mod.isAddress(value) ? candidates.filter((n) => n.family === "evm") : []),

    getBalances,
    getNfts,
    decode: (request: DappRequest, ctx: ChainContext) =>
      decodeRequest(request, ctx, (snap) => {
        const now = Date.now();
        for (const [k, v] of feeSnapshots) if (now - v.at > FEE_SNAPSHOT_TTL_MS) feeSnapshots.delete(k);
        feeSnapshots.set(request.id, { ...snap, at: now });
      }),

    async prepare(request: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
      switch (request.method) {
        case "eth_sendTransaction": {
          const p = parseTx(request, ctx);
          const chainId = chainIdOf(ctx);
          const call = { from: p.from, data: p.data, value: toHex(p.value), ...(p.to ? { to: p.to } : {}) };
          const shown = feeSnapshots.get(request.id);
          const fresh = shown && Date.now() - shown.at <= FEE_SNAPSHOT_TTL_MS ? shown : undefined;
          const [nonceHex, fees, gas] = await Promise.all([
            rpc<Hex>(ctx.network, ctx.fetch, "eth_getTransactionCount", [p.from, "pending"]),
            // The fee caps the approval screen was built on, never a new quote taken after the user said yes.
            fresh ? Promise.resolve(fresh.fees) : quoteFees(ctx),
            p.gas !== undefined
              ? Promise.resolve(p.gas)
              : estimateGas(ctx, call).catch((e) => {
                  if (e instanceof RpcError) throw new ClipError("This would fail on the network, so we didn't send it.", "would-revert", e);
                  throw e;
                }),
          ]);
          if (fresh && p.gas === undefined && gas > (fresh.gas * GAS_HEADROOM_TENTHS) / 10n) {
            throw new ClipError("This now needs more network fee than you were shown, so it wasn't sent. Ask the app to try again.", "fee-changed");
          }
          const common = { chainId, nonce: Number(BigInt(nonceHex)), gas, value: p.value, data: p.data, ...(p.to ? { to: p.to } : {}) };
          const tx: TransactionSerializable =
            fees.type === "eip1559"
              ? { ...common, type: "eip1559", maxFeePerGas: fees.maxFeePerGas!, maxPriorityFeePerGas: fees.maxPriorityFeePerGas! }
              : { ...common, type: "legacy", gasPrice: fees.gasPrice! };
          const serialized = serializeTransaction(tx);
          const digest = keccak256(serialized);
          pending.set(request.id, { kind: "tx", tx, digest });
          // Hardware wallets sign the unsigned transaction itself, never a bare digest.
          return [{ ...payload(ctx, digest, approvalId)[0]!, raw: { format: "evm-tx", bytes: hexToU8(serialized), chainId } }];
        }
        case "personal_sign":
        case "wallet_authenticate": {
          const { message } = parsePersonalSign(request, ctx);
          const isHex = typeof message === "string" && message.startsWith("0x");
          const digest = hashMessage(isHex ? { raw: message as Hex } : message);
          pending.set(request.id, { kind: "sign", digest });
          const msgBytes = isHex ? hexToU8(message as Hex) : new TextEncoder().encode(String(message));
          return [{ ...payload(ctx, digest, approvalId)[0]!, raw: { format: "evm-personal", bytes: msgBytes } }];
        }
        case "eth_signTypedData_v4":
        case "eth_signTypedData": {
          const td = parseTypedData(request, ctx);
          const forHash = typedDataForHash(td);
          const digest = hashTypedData(forHash);
          pending.set(request.id, { kind: "sign", digest });
          // The FULL typed data, with EIP712Domain in `types` (Ledger requires it).
          const full = { ...td, types: { EIP712Domain: td.types.EIP712Domain ?? getTypesForEIP712Domain({ domain: td.domain as never }), ...forHash.types } };
          const json = JSON.stringify(full, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
          return [{ ...payload(ctx, digest, approvalId)[0]!, raw: { format: "eip712", bytes: new TextEncoder().encode(json) } }];
        }
        case "eth_sign":
          throw new ClipError("Clip Wallet doesn't sign unreadable requests like this one, because they can authorize anything.", "eth-sign-refused");
        default:
          throw new ClipError("Clip Wallet doesn't support this kind of request yet.", "unsupported-method", request.method);
      }
    },

    async finalize(request: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
      const p = pending.get(request.id);
      if (!p) throw new ClipError("This request expired. Please try again from the app.", "not-prepared");
      const sig = signatures[0];
      if (!sig) throw new ClipError("The request wasn't signed.", "no-signature");
      const rsv = await toRsv(sig, p.digest, ctx.account.address);
      pending.delete(request.id);
      feeSnapshots.delete(request.id);
      if (p.kind === "sign") {
        return `${rsv.r}${rsv.s.slice(2)}${(27 + rsv.yParity).toString(16)}`;
      }
      const signed = serializeTransaction(p.tx, { r: rsv.r, s: rsv.s, yParity: rsv.yParity, v: BigInt(27 + rsv.yParity) });
      try {
        return await rpc<Hex>(ctx.network, ctx.fetch, "eth_sendRawTransaction", [signed]);
      } catch (e) {
        if (e instanceof RpcError) {
          if (/insufficient funds/i.test(e.message)) throw new ClipError(`You don't have enough ${ctx.network.nativeAsset.symbol} to pay for this and its fee.`, "insufficient-funds", e);
          if (/nonce too low|already known/i.test(e.message)) throw new ClipError("This was already sent.", "already-sent", e);
          throw new ClipError("The network rejected this. Nothing was sent.", "broadcast-rejected", e);
        }
        throw e;
      }
    },

    async buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
      if (!isAddress(p.to)) throw new ClipError("That address isn't valid. Check it and try again.", "bad-address");
      if (p.asset.networkId !== ctx.network.id) throw new ClipError("That asset is on a different network.", "network-mismatch");
      const amount = BigInt(p.amount);
      if (amount <= 0n) throw new ClipError("Enter an amount above zero.", "bad-amount");
      const from = getAddress(ctx.account.address);
      const tx = p.asset.address
        ? { from, to: getAddress(p.asset.address), value: "0x0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [getAddress(p.to), amount] }) }
        : { from, to: getAddress(p.to), value: toHex(amount), data: "0x" };
      return { id: newId(), origin: "clip-wallet://send", via: "injected", family: "evm", networkId: ctx.network.id, method: "eth_sendTransaction", params: [tx] };
    },

    pendingCount: () => pending.size,
  };
  return mod;
}

const hexToU8 = (h: Hex): Uint8Array => {
  const out = new Uint8Array((h.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
};
