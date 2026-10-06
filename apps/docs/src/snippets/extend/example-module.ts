/**
 * A complete ChainModule for "Example Ledger": a made-up account-based ed25519 network with a JSON-RPC API.
 *
 *   example_getBalance { address }      → { amount }      base units, decimal string
 *   example_getNonce   { address }      → { nonce }
 *   example_submit     { tx, signature } → { hash }
 *
 * Dapps (through 1Mask) and the wallet's own Send call two methods:
 *   example_sendTransfer { to, amount }   amount in base units
 *   example_signMessage  { message }      UTF-8 text
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  ClipError,
  WALLET_ORIGIN,
  type AssetRef,
  type ChainContext,
  type ChainModule,
  type DecodedRequest,
  type Family,
  type Network,
} from "@clip-wallet/core";

// #region network
// Step 1 adds "example" to Family in @clip-wallet/core (and to NETWORK_FAMILIES in @clip-wallet/config).
// Until then, the cast keeps this file compiling against the published core.
export const FAMILY = "example" as Family;

export const EXM: AssetRef = { key: "exm", symbol: "EXM", name: "Example", decimals: 6, networkId: "example:testnet" };

export const EXAMPLE_TESTNET: Network = {
  id: "example:testnet", // CAIP-2 style: <namespace>:<reference>
  family: FAMILY,
  name: "Example Testnet", // shown only in Advanced mode and the network chip
  nativeAsset: EXM,
  testnet: true,
  rpcUrls: ["https://rpc.testnet.example"],
  explorerUrl: "https://explorer.testnet.example",
};
// #endregion network

// #region helpers
/** Every transfer pays this flat fee (base units). A real module asks the network. */
const FEE = 1_000n;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const utf8 = (s: string) => new TextEncoder().encode(s);
const short = (a: string) => `${a.slice(0, 7)}…${a.slice(-4)}`;
const isAddress = (value: string) => /^ex1[0-9a-f]{64}$/.test(value);

/** A malformed key or signature counts as "doesn't match". */
function verifies(signature: Uint8Array, message: Uint8Array, publicKeyHex: string): boolean {
  try {
    return ed25519.verify(signature, message, fromHex(publicKeyHex));
  } catch {
    return false;
  }
}

function units(amount: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const frac = (amount % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${amount / base}${frac ? `.${frac}` : ""}`;
}

/** The dapp's params, checked. A ClipError's plain words reach the approval screen if decode() throws. */
function transferOf(params: unknown): { to: string; amount: bigint } {
  const p = params as { to?: unknown; amount?: unknown } | null;
  if (typeof p?.to !== "string" || !isAddress(p.to)) {
    throw new ClipError("This payment's recipient isn't an Example Ledger address.", "example/bad-address");
  }
  if (typeof p.amount !== "string" || !/^[1-9]\d*$/.test(p.amount)) {
    throw new ClipError("This payment's amount isn't valid.", "example/bad-amount");
  }
  return { to: p.to, amount: BigInt(p.amount) };
}

async function rpc<T>(ctx: ChainContext, method: string, params: unknown): Promise<T> {
  let body: { result?: T; error?: { message: string } };
  try {
    const res = await ctx.fetch(ctx.network.rpcUrls[0]!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    body = (await res.json()) as typeof body;
  } catch (e) {
    throw new ClipError("We couldn't reach Example Ledger. Check your connection and try again.", "example/offline", e);
  }
  if (body.error || body.result === undefined) {
    throw new ClipError("Example Ledger didn't accept this. Try again in a moment.", "example/rpc-error", body.error);
  }
  return body.result;
}
// #endregion helpers

export function createExampleModule(): ChainModule {
  /** What prepare() built, by request id: finalize() sends exactly the bytes the vault signed. */
  const prepared = new Map<string, { bytes: Uint8Array; kind: "transfer" | "message" }>();

  return {
    family: FAMILY,
    curve: "ed25519",

    // #region keys
    // SLIP-10 ed25519, all hardened. Step 4 teaches the vault the same path.
    derivationPath: (index) => `m/44'/9999'/${index}'`,
    addressFromPublicKey: (publicKey) => `ex1${hex(publicKey)}`,
    isAddress,
    // One address format for every Example network: all candidates fit, so Send asks "which network?" only
    // when the asset exists on more than one of them.
    networksForAddress: (value, candidates) => (isAddress(value) ? candidates : []),
    // #endregion keys

    // #region reads
    async getBalances(ctx) {
      const { amount } = await rpc<{ amount: string }>(ctx, "example_getBalance", { address: ctx.account.address });
      return [{ asset: { ...EXM, networkId: ctx.network.id }, amount }];
    },
    async getNfts() {
      return []; // Example Ledger has no NFTs
    },
    // #endregion reads

    // #region decode
    async decode(request, ctx): Promise<DecodedRequest> {
      const asset = { ...EXM, networkId: ctx.network.id };
      const base = { requestId: request.id, networkId: ctx.network.id, simulated: false };

      if (request.method === "example_sendTransfer") {
        const { to, amount } = transferOf(request.params);
        return {
          ...base,
          title: `Send ${units(amount, asset.decimals)} EXM to ${short(to)}`,
          lines: [{ label: "To", value: to }],
          balanceChanges: [{ asset, delta: `-${amount + FEE}` }],
          fee: { asset, amount: FEE.toString() },
          blind: false,
          warnings: [],
        };
      }
      if (request.method === "example_signMessage") {
        const { message } = (request.params ?? {}) as { message?: unknown };
        if (typeof message !== "string") throw new ClipError("This message isn't readable text.", "example/bad-params");
        return {
          ...base,
          title: "Sign a message",
          lines: [{ label: "Message", value: message }],
          balanceChanges: [],
          blind: false,
          warnings: [],
        };
      }
      // Anything else is unreadable: blind, and blocked unless the person turns on Advanced mode.
      return {
        ...base,
        title: "Unreadable request",
        lines: [],
        balanceChanges: [],
        blind: true,
        warnings: [{ level: "danger", code: "blind-signing", message: "Clip Wallet can't read this request." }],
      };
    },
    // #endregion decode

    // #region prepare
    async prepare(request, ctx, approvalId) {
      let bytes: Uint8Array;
      let kind: "transfer" | "message";
      if (request.method === "example_sendTransfer") {
        const { to, amount } = transferOf(request.params);
        const { nonce } = await rpc<{ nonce: number }>(ctx, "example_getNonce", { address: ctx.account.address });
        const tx = { chain: ctx.network.id, from: ctx.account.address, to, amount: amount.toString(), fee: FEE.toString(), nonce };
        bytes = utf8(JSON.stringify(tx));
        kind = "transfer";
      } else if (request.method === "example_signMessage") {
        // A fixed prefix, so a signed message can never be replayed as a transaction.
        bytes = utf8(`Example Signed Message:\n${(request.params as { message: string }).message}`);
        kind = "message";
      } else {
        throw new ClipError("Clip Wallet can't sign this kind of request.", "example/unsupported-method");
      }
      prepared.set(request.id, { bytes, kind });
      // The vault signs these bytes with the account's ed25519 key, once, for this approval only.
      return [{ accountId: ctx.account.id, scheme: "ed25519", bytes, approvalId }];
    },
    // #endregion prepare

    // #region finalize
    async finalize(request, signatures, ctx) {
      const p = prepared.get(request.id);
      if (!p) throw new ClipError("This request wasn't prepared for signing. Nothing was sent.", "example/not-prepared");
      prepared.delete(request.id);
      const [signature] = signatures;
      // Verification is public-key maths, allowed outside the vault. Never send a signature you haven't checked.
      if (!signature || signature.scheme !== "ed25519" || !verifies(signature.bytes, p.bytes, ctx.account.publicKey)) {
        throw new ClipError("The signature didn't match. Nothing was sent.", "example/bad-signature");
      }
      if (p.kind === "message") return { signature: hex(signature.bytes) };
      const { hash } = await rpc<{ hash: string }>(ctx, "example_submit", { tx: hex(p.bytes), signature: hex(signature.bytes) });
      return { hash };
    },
    // #endregion finalize

    // #region transfer
    // Send in the wallet builds a request like a dapp's, so it goes through the same decode and approval.
    async buildTransfer({ asset, to, amount }, ctx) {
      if (asset.address) throw new ClipError("Only EXM can be sent on Example Ledger.", "example/unsupported-token");
      return {
        id: crypto.randomUUID(),
        origin: WALLET_ORIGIN,
        via: "injected",
        family: FAMILY,
        networkId: ctx.network.id,
        method: "example_sendTransfer",
        params: { to, amount },
      };
    },
    // #endregion transfer
  };
}
