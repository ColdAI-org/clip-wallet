/**
 * Engine test doubles. No keys anywhere: the fake vault hands out the PUBLIC address of the BIP-39
 * "abandon … about" test account and returns a constant 65-byte placeholder signature (never verified here;
 * chain-level signature checks live in packages/chains-* with offline-precomputed fixtures).
 */
import type { Account, ChainContext, ChainModule, DappRequest, DecodedRequest, Family, Network, Signature, SignablePayload } from "@clip-wallet/core";
import { ClipError, WALLET_ORIGIN } from "@clip-wallet/core";
import type { RouterPort } from "@clip-wallet/1mask/background";
import { KnownDappRegistry, NoNameResolver, OneMaskConnector, ReferencePriceFeed } from "../src/adapters.js";
import type { Dependencies, EngineEnv, PrfProvider, WalletConnectBridge, WalletVault } from "../src/types.js";

/** Public address of m/44'/60'/0'/0/0 for the public BIP-39 test vector. */
export const EVM_ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

const eth = (networkId: string) => ({ key: "eth", symbol: "ETH", name: "Ether", decimals: 18, networkId });
export const SEPOLIA: Network = { id: "eip155:11155111", family: "evm", name: "Sepolia", nativeAsset: eth("eip155:11155111"), testnet: true, rpcUrls: ["https://rpc.sepolia.example"], explorerUrl: "https://sepolia.example", chainId: 11155111 };
export const BASE_SEPOLIA: Network = { id: "eip155:84532", family: "evm", name: "Base Sepolia", nativeAsset: eth("eip155:84532"), testnet: true, rpcUrls: ["https://rpc.base-sepolia.example"], explorerUrl: "https://base-sepolia.example", chainId: 84532 };

export class FakeVault implements WalletVault {
  state: "empty" | "locked" | "unlocked" = "empty";
  password = "";
  registered = new Map<string, Uint8Array[]>();
  signed: SignablePayload[] = [];
  passkeys: { credentialId: Uint8Array; createdAt: number; secret: Uint8Array }[] = [];

  async status() {
    return this.state;
  }
  async create(password: string) {
    this.password = password;
    this.state = "unlocked";
  }
  async importPhrase(_phrase: string, password: string) {
    this.password = password;
    this.state = "unlocked";
  }
  async revealPhrase(password: string) {
    if (password !== this.password) throw new ClipError("That password isn't right.", "vault/wrong-password");
    return "(phrase withheld in tests)";
  }
  async unlock(password: string) {
    if (password !== this.password) throw new ClipError("That password isn't right.", "vault/wrong-password");
    this.state = "unlocked";
  }
  async lock() {
    if (this.state !== "empty") this.state = "locked";
  }
  async deriveAccount(family: Family, index: number): Promise<Account> {
    if (this.state !== "unlocked") throw new ClipError("Your wallet is locked.", "vault/locked");
    return { id: `${family}:${index}`, family, index, curve: "secp256k1", derivationPath: "m/44'/60'/0'/0/0", publicKey: "02", address: EVM_ADDRESS };
  }
  registerApproval(id: string, hashes: Uint8Array[]) {
    this.registered.set(id, hashes);
  }
  revokeApproval(id: string) {
    this.registered.delete(id);
  }
  async sign(payload: SignablePayload): Promise<Signature> {
    if (!this.registered.has(payload.approvalId)) throw new ClipError("Not approved.", "vault/not-approved");
    this.signed.push(payload);
    return { scheme: payload.scheme, bytes: new Uint8Array(64).fill(7), recovery: 1, publicKey: "02" };
  }
  async enrollPasskey(password: string, prf: PrfProvider) {
    if (password !== this.password) throw new ClipError("That password isn't right.", "vault/wrong-password");
    const input = new Uint8Array(32).fill(1);
    const { credentialId, prfOutput } = await prf.enroll(input);
    this.passkeys.push({ credentialId, createdAt: 1, secret: prfOutput });
    return { credentialId, createdAt: 1 };
  }
  async unlockWithPasskey(prf: PrfProvider) {
    const pk = this.passkeys[0];
    if (!pk) throw new ClipError("No passkey.", "passkey/none");
    const out = await prf.evaluate(pk.credentialId, new Uint8Array(32).fill(1));
    if (out.join() !== pk.secret.join()) throw new ClipError("Passkey didn't match.", "passkey/mismatch");
    this.state = "unlocked";
  }
  async listPasskeys() {
    return this.passkeys.map(({ credentialId, createdAt }) => ({ credentialId, createdAt }));
  }
  /* vault-v2 account API: one account per family until addAccount */
  counts = new Map<Family, number>();
  async listAccounts(families: readonly Family[] = ["evm"]): Promise<Account[]> {
    const out: Account[] = [];
    for (const f of families) for (let i = 0; i < (this.counts.get(f) ?? 1); i++) out.push(await this.deriveAccount(f, i));
    return out;
  }
  async addAccount(family: Family): Promise<Account> {
    const n = this.counts.get(family) ?? 1;
    this.counts.set(family, n + 1);
    return this.deriveAccount(family, n);
  }
  async setAccountLabel() {}
  async freshChange(): Promise<never> {
    throw new ClipError("No change addresses in tests.", "test/no-change");
  }
  async listChange() {
    return [];
  }
  async createPasskeyBackup(): Promise<Uint8Array> {
    throw new ClipError("Not in tests.", "test/unsupported");
  }
  async restorePasskeyBackup(): Promise<void> {
    throw new ClipError("Not in tests.", "test/unsupported");
  }
  async removePasskey(id: Uint8Array) {
    this.passkeys = this.passkeys.filter((p) => p.credentialId.join() !== id.join());
  }
}

/** Minimal EVM-like chain module: decodes personal_sign and native sends, signs nothing itself. */
export function stubEvm(): ChainModule & { finalized: DappRequest[] } {
  const finalized: DappRequest[] = [];
  return {
    finalized,
    family: "evm",
    curve: "secp256k1",
    derivationPath: (i) => `m/44'/60'/0'/0/${i}`,
    addressFromPublicKey: () => EVM_ADDRESS,
    isAddress: (v) => /^0x[0-9a-fA-F]{40}$/.test(v),
    networksForAddress: (_v, c) => c,
    async getBalances(ctx: ChainContext) {
      return ctx.network.id === SEPOLIA.id ? [{ asset: ctx.network.nativeAsset, amount: "500000000000000000" }] : [];
    },
    async getNfts() {
      return [];
    },
    async decode(req: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
      if (req.method === "personal_sign") {
        return { requestId: req.id, title: `Sign in to ${new URL(req.origin).host}`, lines: [{ label: "Message", value: "hello" }], balanceChanges: [], simulated: true, blind: false, warnings: [], networkId: ctx.network.id };
      }
      if (req.method === "eth_sendTransaction") {
        const p = (req.params as { value: string }[])[0]!;
        return {
          requestId: req.id,
          title: `Send ${Number(BigInt(p.value)) / 1e18} ETH`,
          lines: [],
          balanceChanges: [{ asset: ctx.network.nativeAsset, delta: `-${BigInt(p.value)}` }],
          fee: { asset: ctx.network.nativeAsset, amount: "21000000000000" },
          simulated: false,
          blind: false,
          warnings: [],
          networkId: ctx.network.id,
        };
      }
      throw new Error("undecodable");
    },
    async prepare(req, ctx, approvalId) {
      return [{ accountId: ctx.account.id, scheme: "ecdsa-secp256k1", bytes: new Uint8Array(32).fill(req.method.length), approvalId }];
    },
    async finalize(req, sigs) {
      finalized.push(req);
      return req.method === "personal_sign" ? `0x${"07".repeat(64)}1c` : { txHash: `0x${"ab".repeat(32)}`, sigs: sigs.length };
    },
    async buildTransfer(p, ctx) {
      return { id: "send-1", origin: WALLET_ORIGIN, via: "injected", family: "evm", networkId: ctx.network.id, method: "eth_sendTransaction", params: [{ from: ctx.account.address, to: p.to, value: p.amount }] };
    },
  };
}

export class DisabledWalletConnect implements WalletConnectBridge {
  enabled = false;
  start() {}
  async pair() {
    throw new ClipError("Connecting with a code isn't switched on in this build yet.", "walletconnect/no-project-id");
  }
  async sessions() {
    return [];
  }
  async disconnect() {}
}

export function makeDeps(vault: FakeVault, evm = stubEvm()): Dependencies & { evm: ReturnType<typeof stubEvm> } {
  const networks = [SEPOLIA, BASE_SEPOLIA];
  return {
    mocks: false,
    evm,
    vault,
    hashPayload: (p) => p.bytes,
    chains: { evm },
    networks,
    assets: networks.map((n) => n.nativeAsset),
    route: {
      async plan({ decoded }) {
        return { source: "Your balance", sponsored: false, readyInSeconds: 12, steps: [{ kind: "action", title: decoded.title }], settlement: "If it fails, nothing leaves your balance." };
      },
    },
    dapps: new OneMaskConnector(networks),
    walletConnect: new DisabledWalletConnect(),
    prices: new ReferencePriceFeed(),
    names: new NoNameResolver(),
    registry: new KnownDappRegistry({ "dapp.test": "Test Dapp" }),
    hederaAccountId: async () => undefined,
  };
}

export function makeEnv(onApproval: (id: string) => void = () => {}): EngineEnv & { broadcasts: number; locks: number[] } {
  let n = 0;
  const env = {
    walletName: "Clip Wallet",
    broadcasts: 0,
    locks: [] as number[],
    openApproval: (id: string) => onApproval(id),
    broadcast() {
      env.broadcasts++;
    },
    armAutoLock(m: number) {
      env.locks.push(m);
    },
    fetch: (async () => {
      throw new Error("no network in tests");
    }) as unknown as typeof fetch,
    randomUUID: () => `id-${++n}`,
  };
  return env;
}

/** A RouterPort pair: `send` plays the WebView/content side; `replies` collects what the router posts. */
export function fakePort() {
  const listeners: ((m: unknown) => void)[] = [];
  const replies: { type: string; id?: string; result?: unknown; error?: { code: number; message: string }; event?: string }[] = [];
  const waiters = new Map<string, (r: (typeof replies)[number]) => void>();
  const port: RouterPort = {
    postMessage(m) {
      const r = m as (typeof replies)[number];
      replies.push(r);
      if (r.type === "response" && r.id) waiters.get(r.id)?.(r);
    },
    onMessage: { addListener: (cb) => void listeners.push(cb) },
    onDisconnect: { addListener() {} },
  };
  let seq = 0;
  const send = (origin: string, method: string, params?: unknown) => {
    const id = `r${++seq}`;
    const done = new Promise<(typeof replies)[number]>((res) => waiters.set(id, res));
    for (const l of listeners) l({ type: "request", id, origin, family: "evm", method, ...(params !== undefined ? { params } : {}) });
    return done;
  };
  return { port, replies, send };
}

export const tick = () => new Promise((r) => setTimeout(r, 0));
