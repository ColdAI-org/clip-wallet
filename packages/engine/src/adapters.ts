/**
 * Adapters from the real packages to the engine's seams (types.ts). Environment-agnostic: no chrome.*,
 * no DOM, no React Native. The host passes WalletConnect's storage/factory when its platform needs one.
 */
import type { Family, Network } from "@clip-wallet/core";
import { ClipError, knownMsg, recallMsg, msg } from "@clip-wallet/core";
import type { ApprovalPlan, PlanStep, SessionView } from "@clip-wallet/ui";
import type { ClipConfig } from "@clip-wallet/config";
import { CARDANO_METHODS_ALLOWED, createOneMaskRouter, EVM_METHODS, type OneMaskRouter, type RouterPort } from "@clip-wallet/1mask/background";
import { P2_CONNECT_METHODS } from "@clip-wallet/1mask/background/p2";
import type { createStarknetModule } from "@clip-wallet/chains-starknet";
import type { createTonModule } from "@clip-wallet/chains-ton";
import type { WalletConnectWalletOptions } from "@clip-wallet/1mask/walletconnect";
import { createRouteClient, findShortfall, type RouteClient, type SettleFunding } from "@clip-wallet/route";
import type { DappConnector, DappHost, DappRegistry, NameResolver, PriceFeed, RoutePlanner, WalletConnectBridge } from "./types.js";

/** Connect methods of every family's connector (same set as the extension's). */
const CONNECT_METHODS = new Set<string>([
  "eth_requestAccounts",
  "wallet_requestPermissions",
  "standard:connect",
  "bitcoin:connect",
  "aptos:connect",
  ...P2_CONNECT_METHODS,
  "cardano_enable",
  "substrate_enable",
  "wallet_requestAccounts", // Starknet (get-starknet)
  "tonconnect:connect",
]);
const READ_ONLY = new Set<string>(EVM_METHODS.readOnly);
/** Read-only chain calls a module answers without an approval (CIP-30 getUtxos, getBalance, …). */
const CHAIN_READ = new Set<string>(CARDANO_METHODS_ALLOWED.readOnly);

/* ------------------------------------------------------------------ 1Mask */

export class OneMaskConnector implements DappConnector {
  private router?: OneMaskRouter;
  constructor(
    private readonly networks: Network[],
    private readonly mods: { starknet?: ReturnType<typeof createStarknetModule>; ton?: ReturnType<typeof createTonModule> } = {},
  ) {}

  start(host: DappHost) {
    this.router = createOneMaskRouter({
      networks: this.networks,
      permissions: host.permissions,
      accountsFor: (origin, family) => host.accountsFor(origin, family),
      isUnlocked: () => host.isUnlocked(),
      defaultNetwork: (_origin, family) => host.preferredNetwork(family),
      cancel: (requestId) => host.cancel(requestId),
      // Hedera DAppConnector / HashConnect find the wallet as an extension and hand over their WalletConnect code.
      ...(host.pairWalletConnect ? { walletConnectPair: (_origin: string, uri: string) => host.pairWalletConnect!(uri) } : {}),
      starknetDeploymentData: async (origin, net) => {
        const [account] = await host.accountsFor(origin, "starknet");
        return account && this.mods.starknet ? this.mods.starknet.deploymentDataFor({ network: net, account, fetch: globalThis.fetch.bind(globalThis) }) : null;
      },
      tonAddrItem: async (origin, net) => {
        const [account] = await host.accountsFor(origin, "ton");
        if (!account || !this.mods.ton) throw new ClipError("Connect a TON account first.", "ton/no-account");
        return this.mods.ton.tonAddrItem(Uint8Array.from(account.publicKey.match(/../g)!.map((h) => parseInt(h, 16))), net);
      },
      handle: async (req) => {
        if (CONNECT_METHODS.has(req.method)) {
          const ok = await host.approveConnect({ origin: req.origin, family: req.family, networkId: req.networkId, via: "injected" });
          if (!ok) throw new ClipError("You declined to connect.", "user-rejected");
          return true;
        }
        if (CHAIN_READ.has(req.method)) return host.chainRead(req);
        if (READ_ONLY.has(req.method)) return host.rpc(req.networkId, req.method, req.params);
        return host.request(req);
      },
    });
  }

  attachPort(port: RouterPort, senderOrigin?: string) {
    this.router?.attachPort(port, { senderOrigin });
  }

  /** Audit 1MASK-02: revoke only the family the user disconnected, so the site is told about that one. */
  async disconnected(origin: string, family?: Family) {
    await this.router?.revoke(origin, family);
  }

  accountsChanged() {
    void this.router?.notifyAccountsChanged();
  }
}

/* ------------------------------------------------------------------ WalletConnect */

type WcWallet = Awaited<ReturnType<typeof import("@clip-wallet/1mask/walletconnect")["createWalletConnectWallet"]>>;

export interface WalletConnectAdapterOptions {
  /** Reown project id. Empty/undefined = WalletConnect is switched off in this build, said plainly. */
  projectId: string | undefined;
  name: string;
  url: string;
  iconUrl: string;
  networks: Network[];
  /** Platform storage etc. for @walletconnect/core (React Native passes nothing: react-native-compat handles it). */
  coreOptions?: Record<string, unknown>;
  walletKitFactory?: WalletConnectWalletOptions["walletKitFactory"];
  /** Defaults to a dynamic import of @clip-wallet/1mask/walletconnect. */
  load?: () => Promise<typeof import("@clip-wallet/1mask/walletconnect")>;
}

export class WalletConnectAdapter implements WalletConnectBridge {
  private wallet?: Promise<WcWallet>;
  private host?: DappHost;
  constructor(private readonly o: WalletConnectAdapterOptions) {}

  get enabled() {
    return !!this.o.projectId;
  }

  start(host: DappHost) {
    this.host = host;
  }

  private loadWallet(): Promise<WcWallet> {
    const projectId = this.o.projectId;
    if (!projectId) {
      return Promise.reject(new ClipError("Connecting with a code isn't switched on in this build yet.", "walletconnect/no-project-id"));
    }
    const load = this.o.load ?? (() => import("@clip-wallet/1mask/walletconnect"));
    this.wallet ??= load().then(({ createWalletConnectWallet }) =>
      createWalletConnectWallet({
        projectId,
        metadata: { name: this.o.name, description: this.o.name, url: this.o.url, icons: [this.o.iconUrl] },
        networks: this.o.networks,
        coreOptions: this.o.coreOptions,
        walletKitFactory: this.o.walletKitFactory,
        addressesFor: (_chain, family) => {
          const a = this.host!.cachedAccount(family);
          return a ? [a.hederaAccountId ?? a.address] : [];
        },
        approveProposal: async (s) => {
          const chain = s.approvedChains[0];
          const net = this.o.networks.find((n) => n.id === chain) ?? this.o.networks[0]!;
          return this.host!.approveConnect({
            origin: s.origin,
            family: net.family,
            networkId: net.id,
            via: "walletconnect",
            name: s.peer.name,
            iconUrl: s.peer.icons?.[0],
            warnings: s.warnings,
          });
        },
        handle: (req, ctx) => this.host!.request(req, { name: ctx.peer.name, iconUrl: ctx.peer.icons?.[0], warnings: ctx.warnings }),
        // Phishing lists (security stream): a listed site shows "known-scam" on the proposal and every request.
        isKnownScam: (origin) => this.host?.isKnownScam?.(origin) ?? false,
        cancel: (id) => this.host!.cancel(id),
      }),
    );
    this.wallet.catch(() => (this.wallet = undefined));
    return this.wallet;
  }

  /** Start WalletKit early (mobile: so sessions restored from storage receive requests after a cold start). */
  async warmUp(): Promise<void> {
    if (this.enabled) await this.loadWallet().catch(() => undefined);
  }

  async pair(uri: string) {
    try {
      await (await this.loadWallet()).pair(uri);
    } catch (e) {
      if (e instanceof ClipError) throw e;
      throw new ClipError("That code didn't connect. Get a fresh one from the app and try again.", "walletconnect/pair-failed", e);
    }
  }

  async sessions(): Promise<SessionView[]> {
    if (!this.wallet) return [];
    const w = await this.wallet.catch(() => undefined);
    return (w?.sessions() ?? []).map((s) => {
      const origin = s.peer.url;
      let domain = origin;
      try {
        domain = new URL(origin).hostname;
      } catch {
        /* keep */
      }
      return {
        id: s.topic,
        dapp: { name: s.peer.name, origin, domain, verified: false, iconUrl: s.peer.icons?.[0] },
        via: "walletconnect" as const,
        connectedAt: (s.expiry - 7 * 86_400) * 1000,
        networkIds: s.chains,
      };
    });
  }

  async disconnect(topic: string) {
    const w = await this.wallet?.catch(() => undefined);
    await w?.disconnect(topic);
  }
}

/* ------------------------------------------------------------------ route */

const PLAIN_ETA: Record<Family, number> = {
  evm: 12,
  hedera: 4,
  solana: 2,
  bitcoin: 600,
  sui: 1,
  aptos: 1,
  cardano: 40,
  substrate: 12,
  starknet: 10,
  ton: 6,
  near: 2,
  stellar: 6,
  tezos: 10,
  algorand: 4,
};

/** CLPRouter funding through @clip-wallet/route. */
export class RoutePlannerAdapter implements RoutePlanner {
  private client: RouteClient;
  constructor(
    private readonly config: ClipConfig,
    private readonly prices: PriceFeed,
    private readonly currency: () => Promise<string>,
    /** Phase 3 "settle on Hedera" (config route.settleOnHedera + a known deployment); null = off. */
    private readonly settle: SettleFunding | null = null,
  ) {
    this.client = createRouteClient({ network: "testnet" });
  }

  async plan({ decoded, balances, networks, account }: Parameters<RoutePlanner["plan"]>[0]): Promise<ApprovalPlan> {
    const net = networks.find((n) => n.id === decoded.networkId);
    const steps: PlanStep[] = [];
    let readyInSeconds = PLAIN_ETA[net?.family ?? "evm"] ?? 30;
    let problem: string | undefined;
    let feeFiat = decoded.fee?.fiatValue;
    const shortfalls = findShortfall(decoded, balances);
    // Phase 3: a bonded Connector pays the shortfall from the user's money on another network (settle on Hedera).
    const funded = this.settle ? await this.settle.plan(shortfalls, account, networks) : null;
    if (funded) {
      steps.push({ kind: "funding", title: funded.step.title, detail: funded.step.detail });
      readyInSeconds = Math.max(readyInSeconds, funded.info.etaSeconds);
    }
    for (const s of funded ? [] : shortfalls) {
      try {
        const [quote] = await this.client.quote({
          to: decoded.networkId,
          asset: s.asset,
          amount: s.missing,
          mode: this.config.route.mode,
          filters: this.config.route.filters,
          portfolio: balances,
        });
        if (!quote) throw new ClipError(msg("bg.err.notEnoughForThis", { symbol: s.asset.symbol }), "route/no-quote");
        steps.push({ kind: "funding", title: quote.title, ...(recallMsg(quote.title) ? { titleMsg: recallMsg(quote.title) } : {}), detail: quote.steps.map((x) => x.text).join(" · ") });
        readyInSeconds = Math.max(readyInSeconds, quote.time.p90Seconds);
        const fx = this.prices.fx(await this.currency());
        feeFiat = (feeFiat ?? 0) + quote.fee.usd * fx;
        problem = "Moving money from your other balances isn't switched on in this build yet.";
      } catch (e) {
        problem = e instanceof ClipError ? e.userMessage : `You don't have enough ${s.asset.symbol} for this.`;
      }
    }
    const sponsored = !!decoded.fee?.sponsored;
    if (decoded.fee) steps.push({ kind: "gas", title: sponsored ? "Network fee paid for you" : "Network fee", titleMsg: knownMsg(sponsored ? "Network fee paid for you" : "Network fee") });
    steps.push({ kind: "action", title: decoded.title, titleMsg: decoded.titleMsg, balanceChanges: decoded.balanceChanges });
    return {
      source: "Your balance",
      feeFiat,
      sponsored,
      readyInSeconds,
      steps,
      settlement: funded
        ? "If the money doesn't arrive in time, you're paid back from the Connector's bond on Hedera."
        : shortfalls.length
          ? "Settles once delivery is proven. If it doesn't arrive in time, the money comes back to you."
          : "If it fails, nothing leaves your balance.",
      problem,
      ...(funded ? { funding: funded.info } : {}),
    };
  }
}

/* ------------------------------------------------------------------ prices, names, dapps */

/** Reference USD prices so testnet balances read as money. Testnet coins have no market value. */
const REFERENCE_USD: Record<string, number> = {
  usdc: 1,
  "usdc-testnet": 1,
  "usdc.e": 1,
  eth: 3000,
  hbar: 0.07,
  sol: 150,
  btc: 62000,
  "btc-testnet": 62000,
};
const FX: Record<string, number> = { USD: 1, EUR: 0.92, GBP: 0.79 };

export class ReferencePriceFeed implements PriceFeed {
  usd(key: string) {
    return REFERENCE_USD[key];
  }
  fx(currency: string) {
    return FX[currency] ?? 1;
  }
}

export class NoNameResolver implements NameResolver {
  async resolve() {
    return null;
  }
}

/** Curated app registry (v0). Unknown domains show as "not verified". */
const KNOWN_DAPPS: Record<string, string> = {
  "magiceden.io": "Magic Eden",
  "app.uniswap.org": "Uniswap",
  "saucerswap.finance": "SaucerSwap",
  "jup.ag": "Jupiter",
  "opensea.io": "OpenSea",
  "hashpack.app": "HashPack",
};

export class KnownDappRegistry implements DappRegistry {
  constructor(private readonly extra: Record<string, string> = {}) {}
  lookup(origin: string) {
    let host = origin;
    try {
      host = new URL(origin).hostname.replace(/^www\./, "");
    } catch {
      /* keep */
    }
    const name = KNOWN_DAPPS[host] ?? this.extra[host];
    return name ? { name, verified: true } : { name: host, verified: false };
  }
}
