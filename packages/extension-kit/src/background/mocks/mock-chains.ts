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
import { ClipError, FAMILIES, WALLET_ORIGIN, isWalletOrigin } from "@clip-wallet/core";
import { SETTLE_DEPOSIT_ABI, SETTLE_DEPOSIT_SELECTOR } from "@clip-wallet/route";
import { decodeFunctionData, toFunctionSelector } from "viem";
import { MOCK_BALANCES, MOCK_NFTS } from "./fixtures";
import { knownAssets, MOCK_NETWORKS } from "./networks";

const ERC20_TRANSFER = "a9059cbb";
const SET_APPROVAL_FOR_ALL = "a22cb465";
const ERC20_APPROVE = "095ea7b3";
const SETTLE_DEPOSIT = SETTLE_DEPOSIT_SELECTOR.slice(2);
const CLAIM_DEFAULT = toFunctionSelector("claimDefault(bytes32)").slice(2);

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
  const amounts: Partial<Record<Family, string>> = {
    evm: "12000000000000",
    hedera: "5000000",
    solana: "5000",
    bitcoin: "800",
    sui: "2000000",
    aptos: "1000",
    cardano: "170000",
    substrate: "150000000",
    starknet: "30000000000000000",
    ton: "5000000",
    near: "450000000000000000000",
    stellar: "100",
    tezos: "1200",
    algorand: "1000",
  };
  return { asset: network.nativeAsset, amount: amounts[network.family] ?? "0", sponsored: network.family === "evm" };
}

const ADDRESS_RE: Partial<Record<Family, RegExp>> = {
  evm: /^0x[0-9a-fA-F]{40}$/,
  hedera: /^0\.0\.\d{1,12}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  bitcoin: /^(tb1[02-9ac-hj-np-z]{8,87}|[mn2][1-9A-HJ-NP-Za-km-z]{25,34})$/,
  // Phase 2 (fixture-grade checks only; the real modules validate checksums).
  sui: /^0x[0-9a-fA-F]{64}$/,
  aptos: /^0x[0-9a-fA-F]{64}$/,
  starknet: /^0x0[0-9a-fA-F]{63}$/,
  cardano: /^addr_test1[02-9ac-hj-np-z]{50,110}$/,
  substrate: /^[1-9A-HJ-NP-Za-km-z]{47,48}$/,
  ton: /^[EUk0]Q[A-Za-z0-9_-]{46}$/,
  near: /^([0-9a-f]{64}|[a-z0-9_-]+\.testnet)$/,
  stellar: /^G[A-Z2-7]{55}$/,
  tezos: /^tz[1-4][1-9A-HJ-NP-Za-km-z]{33}$/,
  algorand: /^[A-Z2-7]{58}$/,
};

const SCHEME: Partial<Record<Family, SignablePayload["scheme"]>> = {
  evm: "ecdsa-secp256k1",
  hedera: "ecdsa-secp256k1",
  solana: "ed25519",
  bitcoin: "ecdsa-secp256k1",
  sui: "ed25519",
  aptos: "ed25519",
  cardano: "ed25519",
  substrate: "sr25519",
  starknet: "stark-ecdsa",
  ton: "ed25519",
  near: "ed25519",
  stellar: "ed25519",
  tezos: "ed25519",
  algorand: "ed25519",
};

const PATHS: Partial<Record<Family, (i: number) => string>> = {
  evm: (i) => `m/44'/60'/0'/0/${i}`,
  hedera: (i) => `m/44'/3030'/0'/0/${i}`,
  solana: (i) => `m/44'/501'/${i}'/0'`,
  bitcoin: (i) => `m/84'/1'/${i}'/0/0`,
  sui: (i) => `m/44'/784'/${i}'/0'/0'`,
  aptos: (i) => `m/44'/637'/${i}'/0'/0'`,
  cardano: (i) => `m/1852'/1815'/${i}'`,
  substrate: (i) => `//${i}`,
  starknet: (i) => `m/44'/9004'/0'/0/${i}`,
  ton: (i) => `m/44'/607'/${i}'`,
  near: (i) => `m/44'/397'/${i}'`,
  stellar: (i) => `m/44'/148'/${i}'`,
  tezos: (i) => `m/44'/1729'/${i}'/0'`,
  algorand: (i) => `m/44'/283'/${i}'/0/0`,
};

const CURVE: Record<Family, ChainModule["curve"]> = {
  evm: "secp256k1",
  hedera: "secp256k1",
  solana: "ed25519",
  bitcoin: "secp256k1",
  sui: "ed25519",
  aptos: "ed25519",
  cardano: "bip32-ed25519",
  substrate: "sr25519",
  starknet: "stark",
  ton: "ed25519",
  near: "ed25519",
  stellar: "ed25519",
  tezos: "ed25519",
  algorand: "bip32-ed25519",
  cosmos: "secp256k1",
  provenance: "secp256k1",
  thorchain: "secp256k1",
  initia: "secp256k1",
  tron: "secp256k1",
  xrpl: "secp256k1",
  antelope: "secp256k1",
  multiversx: "ed25519",
  icp: "secp256k1",
  stacks: "secp256k1",
  fuel: "secp256k1",
  bitcoincash: "secp256k1",
};

/** Mock-only Hedera account ids for EVM aliases (real module asks the mirror node). */
const MOCK_HEDERA_ACCOUNT = "0.0.4815162";

/**
 * Structurally a ChainModule (checked by createMockChains' return type). It is deliberately not
 * declared `implements ChainModule`: the harness treats any package declaring that as a chain-module
 * package, and this app package (rightly) imports the vault in its background.
 */
export class MockChainModule {
  readonly curve: ChainModule["curve"];
  constructor(readonly family: Family) {
    this.curve = CURVE[family];
  }

  derivationPath(index: number) {
    return PATHS[this.family]!(index);
  }

  addressFromPublicKey(): string {
    throw new ClipError("Not available in the mock build.", "mock/unsupported");
  }

  isAddress(value: string) {
    return ADDRESS_RE[this.family]!.test(value.trim());
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
            title: `${request.origin.startsWith("chrome-extension:") || isWalletOrigin(request.origin) ? "Send" : "Pay"} ${human} ${token.symbol}`,
            balanceChanges: [{ asset: token, delta: `-${amount}` }],
            fee,
            simulated: true,
            blind: false,
          };
        }
      }
      // Settle on Hedera (requests the wallet builds itself): exact allowance, Connector payment, claim.
      if (data.startsWith(ERC20_APPROVE) && data.length >= 8 + 128) {
        const token = assetAt(request.networkId, tx?.to);
        if (token) {
          const human = Number(BigInt(`0x${data.slice(8 + 64, 8 + 128)}`)) / 10 ** token.decimals;
          return { ...base, title: `Allow exactly ${human} ${token.symbol} for this payment`, balanceChanges: [], fee, simulated: true, blind: false };
        }
      }
      if (data.startsWith(SETTLE_DEPOSIT)) {
        const { args } = decodeFunctionData({ abi: SETTLE_DEPOSIT_ABI, data: `0x${data}` });
        const q = args[0] as { assetIn: string; amountIn: bigint };
        const token = assetAt(request.networkId, BigInt(q.assetIn) === 0n ? undefined : `0x${q.assetIn.slice(-40)}`);
        const human = token ? Number(q.amountIn) / 10 ** token.decimals : 0;
        return {
          ...base,
          title: `Pay ${human} ${token?.symbol ?? ""} to a Connector`.replace("  ", " "),
          balanceChanges: token ? [{ asset: token, delta: `-${q.amountIn}` }] : [],
          fee,
          simulated: true,
          blind: false,
        };
      }
      if (data.startsWith(CLAIM_DEFAULT)) {
        return { ...base, title: "Claim a late payment back", balanceChanges: [], fee, simulated: true, blind: false };
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
          title: `${isWalletOrigin(request.origin) ? "Send" : "Pay"} ${human} ETH`,
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
    // Stark ECDSA signs a field element: keep the digest below 2^251.
    if (this.family === "starknet") digest[0]! &= 0x03;
    return [{ accountId: ctx.account.id, scheme: SCHEME[this.family]!, bytes: digest, approvalId }];
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
        origin: WALLET_ORIGIN,
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
    return { id, origin: WALLET_ORIGIN, via: "injected", family: this.family, networkId: ctx.network.id, method: "clip_transfer", params: { ...p } };
  }
}

export function createMockChains(): Partial<Record<Family, ChainModule>> {
  // One mock per family, all 14 (fixture balances above for a few of the Phase 2 ones).
  return Object.fromEntries(FAMILIES.map((f) => [f, new MockChainModule(f)])) as Partial<Record<Family, ChainModule>>;
}

export { MOCK_HEDERA_ACCOUNT };
