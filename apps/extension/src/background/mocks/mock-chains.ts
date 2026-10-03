/**
 * MOCK ChainModules (one per family) with fixture balances/NFTs and a tiny but real decoder for the
 * requests the dev simulator and Send produce. Replaced by @clip-wallet/chains-* at merge (wiring.ts).
 * Never imports the vault (AGENTS rule 2).
 */
import type {
  AssetRef,
  ChainContext,
  ChainModule,
  DappRequest,
  DecodedRequest,
  Family,
  Network,
  Nft,
  Signature,
  SignablePayload,
  TokenBalance,
  Warning,
} from "@clip-wallet/core";
import { ClipError } from "@clip-wallet/core";
import { MOCK_BALANCES, MOCK_NFTS } from "./fixtures";
import { knownAssets, MOCK_NETWORKS } from "./networks";

const ERC20_TRANSFER = "a9059cbb";
const SET_APPROVAL_FOR_ALL = "a22cb465";

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>));
}
const utf8 = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

function assetAt(networkId: string, address?: string): AssetRef | undefined {
  return knownAssets(MOCK_NETWORKS).find(
    (a) => a.networkId === networkId && (address ? a.address?.toLowerCase() === address.toLowerCase() : !a.address),
  );
}

function feeFor(network: Network): DecodedRequest["fee"] {
  // Base-units fee + sponsored flag; fiat is filled by the service's price feed.
  const amounts: Record<Family, string> = { evm: "12000000000000", hedera: "5000000", solana: "5000", bitcoin: "800" };
  return { asset: network.nativeAsset, amount: amounts[network.family], sponsored: network.family === "evm" };
}

const ADDRESS_RE: Record<Family, RegExp> = {
  evm: /^0x[0-9a-fA-F]{40}$/,
  hedera: /^0\.0\.\d{1,12}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  bitcoin: /^(tb1[02-9ac-hj-np-z]{8,87}|[mn2][1-9A-HJ-NP-Za-km-z]{25,34})$/,
};

const SCHEME: Record<Family, SignablePayload["scheme"]> = {
  evm: "ecdsa-secp256k1",
  hedera: "ecdsa-secp256k1",
  solana: "ed25519",
  bitcoin: "ecdsa-secp256k1",
};

const PATHS: Record<Family, (i: number) => string> = {
  evm: (i) => `m/44'/60'/0'/0/${i}`,
  hedera: (i) => `m/44'/3030'/0'/0/${i}`,
  solana: (i) => `m/44'/501'/${i}'/0'`,
  bitcoin: (i) => `m/84'/1'/${i}'/0/0`,
};

/** Mock-only Hedera account ids for EVM aliases (real module asks the mirror node). */
const MOCK_HEDERA_ACCOUNT = "0.0.4815162";

/**
 * Structurally a ChainModule (checked by createMockChains' return type). It is deliberately not
 * declared `implements ChainModule`: the harness treats any package declaring that as a chain-module
 * package, and this app package (rightly) imports the vault in its background.
 */
export class MockChainModule {
  readonly curve;
  constructor(readonly family: Family) {
    this.curve = family === "solana" ? ("ed25519" as const) : ("secp256k1" as const);
  }

  derivationPath(index: number) {
    return PATHS[this.family](index);
  }

  addressFromPublicKey(): string {
    throw new ClipError("Not available in the mock build.", "mock/unsupported");
  }

  isAddress(value: string) {
    return ADDRESS_RE[this.family].test(value.trim());
  }

  networksForAddress(value: string, candidates: Network[]) {
    if (!this.isAddress(value)) return [];
    // An EVM address is valid on every EVM network: that's the "network-matters" case.
    return candidates.filter((n) => n.family === this.family);
  }

  async getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    await new Promise((r) => setTimeout(r, 30));
    return structuredClone(MOCK_BALANCES[ctx.network.id] ?? []);
  }

  async getNfts(ctx: ChainContext): Promise<Nft[]> {
    return structuredClone(MOCK_NFTS[ctx.network.id] ?? []);
  }

  async decode(request: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const base = { requestId: request.id, networkId: request.networkId, lines: [] as { label: string; value: string }[], warnings: [] as Warning[] };
    const fee = feeFor(ctx.network);
    const p = request.params as Record<string, unknown> | unknown[] | undefined;

    if (this.family === "evm" && request.method === "eth_sendTransaction") {
      const tx = (Array.isArray(p) ? p[0] : p) as { to?: string; value?: string; data?: string } | undefined;
      const data = (tx?.data ?? "0x").replace(/^0x/, "").toLowerCase();
      if (data.startsWith(ERC20_TRANSFER) && data.length >= 8 + 128) {
        const token = assetAt(request.networkId, tx?.to);
        const amount = BigInt(`0x${data.slice(8 + 64, 8 + 128)}`).toString();
        if (token) {
          const human = Number(amount) / 10 ** token.decimals;
          return {
            ...base,
            title: `${request.origin.startsWith("chrome-extension:") || request.origin === "wallet" ? "Send" : "Pay"} ${human} ${token.symbol}`,
            balanceChanges: [{ asset: token, delta: `-${amount}` }],
            fee,
            simulated: true,
            blind: false,
          };
        }
      }
      if (data.startsWith(SET_APPROVAL_FOR_ALL)) {
        return {
          ...base,
          title: "Let this app move all your collectibles",
          balanceChanges: [],
          fee,
          simulated: true,
          blind: false,
          warnings: [
            { level: "danger", code: "approval-for-all", message: "This gives the app control of every item in this collection. Only do this on sites you trust." },
          ],
        };
      }
      if (data === "" && tx?.value) {
        const amount = BigInt(tx.value).toString();
        const human = Number(amount) / 1e18;
        return {
          ...base,
          title: `${request.origin === "wallet" ? "Send" : "Pay"} ${human} ETH`,
          balanceChanges: [{ asset: ctx.network.nativeAsset, delta: `-${amount}` }],
          fee,
          simulated: true,
          blind: false,
        };
      }
    }
    if (request.method === "personal_sign") {
      const domain = (() => {
        try {
          return new URL(request.origin).hostname;
        } catch {
          return request.origin;
        }
      })();
      return { ...base, title: `Sign in to ${domain}`, balanceChanges: [], simulated: true, blind: false };
    }
    if (request.method === "clip_transfer") {
      const t = p as { asset: AssetRef; amount: string; to: string };
      return {
        ...base,
        title: `Send ${Number(t.amount) / 10 ** t.asset.decimals} ${t.asset.symbol}`,
        balanceChanges: [{ asset: t.asset, delta: `-${t.amount}` }],
        fee,
        simulated: this.family !== "bitcoin",
        blind: false,
      };
    }
    // Anything else: we could not read it.
    return {
      ...base,
      title: "Unreadable request",
      balanceChanges: [],
      simulated: false,
      blind: true,
      warnings: [{ level: "danger", code: "blind-signing", message: "Clip Wallet can't read this request." }],
    };
  }

  async prepare(request: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const digest = await sha256(utf8(JSON.stringify({ m: request.method, p: request.params, n: request.networkId })));
    return [{ accountId: ctx.account.id, scheme: SCHEME[this.family], bytes: digest, approvalId }];
  }

  async finalize(_request: DappRequest, signatures: Signature[]): Promise<unknown> {
    const sig = signatures[0];
    if (!sig) throw new ClipError("Nothing was signed.", "mock/no-signature");
    // Mock "broadcast": a deterministic fake tx hash from the real signature.
    return { txHash: `0x${hex((await sha256(sig.bytes)).slice(0, 32))}` };
  }

  async buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    const id = crypto.randomUUID();
    if (this.family === "evm") {
      const to = p.to.toLowerCase().replace(/^0x/, "").padStart(64, "0");
      const amt = BigInt(p.amount).toString(16).padStart(64, "0");
      return {
        id,
        origin: "wallet",
        via: "injected",
        family: "evm",
        networkId: ctx.network.id,
        method: "eth_sendTransaction",
        params: [
          p.asset.address
            ? { from: ctx.account.address, to: p.asset.address, data: `0x${ERC20_TRANSFER}${to}${amt}` }
            : { from: ctx.account.address, to: p.to, value: `0x${BigInt(p.amount).toString(16)}`, data: "0x" },
        ],
      };
    }
    return { id, origin: "wallet", via: "injected", family: this.family, networkId: ctx.network.id, method: "clip_transfer", params: { ...p } };
  }
}

export function createMockChains(): Record<Family, ChainModule> {
  return {
    evm: new MockChainModule("evm"),
    hedera: new MockChainModule("hedera"),
    solana: new MockChainModule("solana"),
    bitcoin: new MockChainModule("bitcoin"),
  };
}

export { MOCK_HEDERA_ACCOUNT };
