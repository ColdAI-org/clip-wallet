/**
 * Clip handles: "@alex" (or "alex.clip") → the addresses Alex chose to publish, one per network family, read from
 * the ClipHandles contract on Hedera's EVM (contracts/handles). Reads only, over the Hedera JSON-RPC relay
 * (Hashio, https://docs.hedera.com/evm/quickstart/setup-metamask.md: testnet chain id 296).
 *
 * The contract isn't deployed yet, so there is no default address: without one the backend says plainly that
 * handles aren't switched on. Every record is checked with the family's own address rules (ChainModule.isAddress,
 * passed in as `isAddress`) before it is returned; anything else is dropped.
 */
import { ClipError, FAMILIES, type Family, type Network, type NetworkId } from "@clip-wallet/core";
import { createPublicClient, http, isAddress as isEvmAddress, getAddress, type Address } from "viem";
import { hedera, hederaTestnet } from "viem/chains";
import type { Backend, ResolvedName } from "./types.js";

/** The ClipHandles ABI subset the resolver reads (matches contracts/handles/abi/ClipHandles.json; checked in tests). */
export const CLIP_HANDLES_ABI = [
  {
    type: "function",
    name: "recordsOf",
    stateMutability: "view",
    inputs: [{ name: "handle", type: "string" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "registeredAt", type: "uint64" },
      { name: "updatedAt", type: "uint64" },
      { name: "families", type: "string[]" },
      { name: "addrs", type: "string[]" },
    ],
  },
  { type: "function", name: "handleOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "ownedHandle", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "isAvailable", stateMutability: "view", inputs: [{ name: "handle", type: "string" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ name: "handle", type: "string" }], outputs: [] },
  {
    type: "function",
    name: "setAddresses",
    stateMutability: "nonpayable",
    inputs: [
      { name: "families", type: "string[]" },
      { name: "addrs", type: "string[]" },
    ],
    outputs: [],
  },
  { type: "function", name: "release", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "setReverse", stateMutability: "nonpayable", inputs: [{ name: "enabled", type: "bool" }], outputs: [] },
] as const;

/** Where ClipHandles lives per Hedera ledger. Empty until deployed (contracts/handles/README.md). */
export const CLIP_HANDLES_DEPLOYMENTS: Partial<Record<"mainnet" | "testnet", { address: Address; contractId?: string }>> = {};

export interface HandleRecords {
  owner: string;
  registeredAt: number;
  updatedAt: number;
  families: string[];
  addrs: string[];
}

/** The contract reads the resolver needs, so tests (and other hosts) can stub them. */
export interface HandlesReader {
  recordsOf(handle: string): Promise<HandleRecords>;
  handleOf(owner: string): Promise<string>;
  /** The handle an owner holds, regardless of the reverse opt-in (to show the user their own). */
  ownedHandle?(owner: string): Promise<string>;
  isAvailable?(handle: string): Promise<boolean>;
}

/** Same rule as ClipHandles.isValidHandle: 3–32 of [a-z0-9-], no leading/trailing/double hyphen. */
export function isValidHandle(handle: string): boolean {
  return /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,31}$/.test(handle);
}

/** "@Alex", "alex.clip", "ALEX.CLIP" → "alex"; null when it isn't handle-shaped. */
export function parseHandle(input: string): string | null {
  const v = input.trim().toLowerCase();
  const m = /^@([^\s@.]+)$/.exec(v) ?? /^([^\s@.]+)\.clip$/.exec(v);
  return m && isValidHandle(m[1]!) ? m[1]! : null;
}

export function isClipHandle(input: string): boolean {
  const v = input.trim();
  return /^@[^\s@.]+$/.test(v) || /^[^\s@.]+\.clip$/i.test(v);
}

export interface ClipHandlesOptions {
  ledger?: "mainnet" | "testnet";
  /** Contract address; default CLIP_HANDLES_DEPLOYMENTS[ledger]. Without one, handles are off. */
  address?: string;
  rpcUrl?: string;
  fetch?: typeof fetch;
  reader?: HandlesReader;
  /** Per-family address checks (ChainModule.isAddress). Families without a check accept nothing. */
  isAddress?: Partial<Record<Family, (value: string) => boolean>>;
  /** The wallet's networks: families it doesn't have are dropped. */
  networks?: Network[];
  now?: () => number;
}

/** A handle whose owner registered it this recently gets `recentlyRegistered` (Send shows a caution). */
export const RECENT_HANDLE_MS = 7 * 24 * 60 * 60 * 1000;

export class ClipHandlesBackend implements Backend {
  readonly service = "clip" as const;
  private readonly reader?: HandlesReader;
  private readonly families: Set<Family> | null;
  private readonly now: () => number;

  constructor(private readonly opts: ClipHandlesOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.families = opts.networks ? new Set(opts.networks.map((n) => n.family)) : null;
    if (opts.reader) {
      this.reader = opts.reader;
      return;
    }
    const ledger = opts.ledger ?? "testnet";
    const address = opts.address ?? CLIP_HANDLES_DEPLOYMENTS[ledger]?.address;
    if (address && isEvmAddress(address)) this.reader = viemReader(getAddress(address), ledger, opts.rpcUrl, opts.fetch);
  }

  /** False when no contract is configured (the UI hides the "Publish a handle" entry). */
  get enabled(): boolean {
    return !!this.reader;
  }

  handles(name: string): boolean {
    return isClipHandle(name);
  }

  private requireReader(): HandlesReader {
    if (!this.reader) throw new ClipError("Clip handles aren't switched on in this version yet. Paste their address instead.", "names/clip-off");
    return this.reader;
  }

  /** The handle `owner` (an EVM address) holds, with its raw records; null when none or handles are off. */
  async owned(owner: string): Promise<{ handle: string; records: HandleRecords } | null> {
    if (!this.reader?.ownedHandle || !isEvmAddress(owner)) return null;
    const handle = await this.reader.ownedHandle(getAddress(owner));
    if (!handle) return null;
    return { handle, records: await this.reader.recordsOf(handle) };
  }

  /** Whether `owner` turned reverse lookup on (handleOf answers). */
  async reverseOn(owner: string): Promise<boolean> {
    if (!this.reader || !isEvmAddress(owner)) return false;
    return (await this.reader.handleOf(getAddress(owner))) !== "";
  }

  /** Whether a handle can be claimed now (valid, free, not cooling down). Null when handles are off. */
  async available(handle: string): Promise<boolean | null> {
    if (!this.reader) return null;
    if (!isValidHandle(handle)) return false;
    if (this.reader.isAvailable) return this.reader.isAvailable(handle);
    const rec = await this.reader.recordsOf(handle);
    return !rec.owner || /^0x0{40}$/i.test(rec.owner);
  }

  /** Every valid record of a handle, by family. Null when the handle is free or has no usable address. */
  async lookup(input: string): Promise<{ handle: string; byFamily: Partial<Record<Family, string>>; records: HandleRecords } | null> {
    const handle = parseHandle(input);
    if (!handle) return null;
    let rec: HandleRecords;
    try {
      rec = await this.requireReader().recordsOf(handle);
    } catch (e) {
      if (e instanceof ClipError) throw e;
      throw new ClipError("We couldn't look up that handle right now. Paste their address instead, or try again.", "names/clip-unavailable", e);
    }
    if (!rec.owner || /^0x0{40}$/i.test(rec.owner)) return null;
    const byFamily: Partial<Record<Family, string>> = {};
    rec.families.forEach((f, i) => {
      const family = f as Family;
      const addr = rec.addrs[i] ?? "";
      if (!(FAMILIES as readonly string[]).includes(f)) return;
      if (this.families && !this.families.has(family)) return;
      const check = this.opts.isAddress?.[family];
      if (!check || !check(addr)) return;
      byFamily[family] = addr;
    });
    return Object.keys(byFamily).length ? { handle, byFamily, records: rec } : null;
  }

  async resolve(input: string): Promise<ResolvedName | null> {
    const hit = await this.lookup(input);
    if (!hit) return null;
    const order: Family[] = ["evm", ...FAMILIES.filter((f) => f !== "evm")];
    const primary = order.find((f) => hit.byFamily[f])!;
    const display = `@${hit.handle}`;
    return {
      name: display,
      address: hit.byFamily[primary]!,
      family: primary,
      networkIds: [] as NetworkId[],
      service: "clip",
      displayName: display,
      byFamily: hit.byFamily,
      handle: {
        owner: hit.records.owner,
        registeredAt: hit.records.registeredAt * 1000,
        updatedAt: hit.records.updatedAt * 1000,
        recentlyRegistered: this.now() - hit.records.registeredAt * 1000 < RECENT_HANDLE_MS,
      },
    };
  }

  /**
   * "@alex" for an address, only when its owner turned reverse lookup on AND the handle publishes this very
   * address (forward check), so nobody can put their handle on someone else's address.
   */
  async reverse(address: string, family: Family): Promise<string | null> {
    if (!this.reader || (family !== "evm" && family !== "hedera") || !isEvmAddress(address)) return null;
    try {
      const handle = await this.reader.handleOf(getAddress(address));
      if (!handle) return null;
      const hit = await this.lookup(`@${handle}`);
      const published = hit?.byFamily[family];
      return published && published.toLowerCase() === address.toLowerCase() ? `@${handle}` : null;
    } catch {
      return null;
    }
  }
}

function viemReader(address: Address, ledger: "mainnet" | "testnet", rpcUrl?: string, f?: typeof fetch): HandlesReader {
  const chain = ledger === "mainnet" ? hedera : hederaTestnet;
  const client = createPublicClient({ chain, transport: http(rpcUrl ?? chain.rpcUrls.default.http[0], { fetchFn: f, timeout: 8000, retryCount: 1 }) });
  return {
    async recordsOf(handle) {
      const [owner, registeredAt, updatedAt, families, addrs] = await client.readContract({ address, abi: CLIP_HANDLES_ABI, functionName: "recordsOf", args: [handle] });
      return { owner, registeredAt: Number(registeredAt), updatedAt: Number(updatedAt), families: [...families], addrs: [...addrs] };
    },
    handleOf: (owner) => client.readContract({ address, abi: CLIP_HANDLES_ABI, functionName: "handleOf", args: [owner as Address] }),
    ownedHandle: (owner) => client.readContract({ address, abi: CLIP_HANDLES_ABI, functionName: "ownedHandle", args: [owner as Address] }),
    isAvailable: (handle) => client.readContract({ address, abi: CLIP_HANDLES_ABI, functionName: "isAvailable", args: [handle] }),
  };
}
