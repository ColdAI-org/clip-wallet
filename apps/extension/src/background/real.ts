/**
 * Adapters from the real packages to the background's seams (see wiring.ts).
 */
import type { Family, Network, Warning } from "@clip-wallet/core";
import { ClipError } from "@clip-wallet/core";
import type { ApprovalPlan, PlanStep, SessionView } from "@clip-wallet/ui";
import type { ClipConfig } from "@clip-wallet/config";
import { createOneMaskRouter, EVM_METHODS, type OneMaskRouter, type RouterPort } from "@clip-wallet/1mask/background";
import { createRouteClient, findShortfall, type RouteClient } from "@clip-wallet/route";
import type { DappConnector, DappHost, DappRegistry, NameResolver, PriceFeed, RoutePlanner, WalletConnectBridge } from "./wiring";

const CONNECT_METHODS = new Set<string>(["eth_requestAccounts", "wallet_requestPermissions", "standard:connect", "bitcoin:connect", "aptos:connect"]);
const READ_ONLY = new Set<string>(EVM_METHODS.readOnly);

/* ------------------------------------------------------------------ 1Mask */

export class OneMaskConnector implements DappConnector {
  private router?: OneMaskRouter;
  constructor(private readonly networks: Network[]) {}

  start(host: DappHost) {
    this.router = createOneMaskRouter({
      networks: this.networks,
      permissions: host.permissions,
      accountsFor: (origin, family) => host.accountsFor(origin, family),
      isUnlocked: () => host.isUnlocked(),
      defaultNetwork: (_origin, family) => host.preferredNetwork(family),
      cancel: (requestId) => host.cancel(requestId),
      handle: async (req) => {
        if (CONNECT_METHODS.has(req.method)) {
          const ok = await host.approveConnect({ origin: req.origin, family: req.family, networkId: req.networkId, via: "injected" });
          if (!ok) throw new ClipError("You declined to connect.", "user-rejected");
          return true;
        }
        if (READ_ONLY.has(req.method)) return host.rpc(req.networkId, req.method, req.params);
        return host.request(req);
      },
    });
  }

  attachPort(port: RouterPort, senderOrigin?: string) {
    this.router?.attachPort(port, { senderOrigin });
  }

  disconnected(origin: string) {
    void this.router?.revoke(origin);
  }

  accountsChanged() {
    void this.router?.notifyAccountsChanged();
  }
}

/* ------------------------------------------------------------------ WalletConnect */

type WcWallet = Awaited<ReturnType<typeof import("@clip-wallet/1mask/walletconnect")["createWalletConnectWallet"]>>;

/**
 * WalletConnect via @clip-wallet/1mask/walletconnect (Reown WalletKit). Needs a project id
 * (clip.config walletConnect.projectId, from CLIP_WALLETCONNECT_PROJECT_ID at build time); without one,
 * pairing explains that this build has WalletConnect switched off.
 */
export class WalletConnectAdapter implements WalletConnectBridge {
  private wallet?: Promise<WcWallet>;
  private host?: DappHost;
  constructor(
    private readonly config: ClipConfig,
    private readonly networks: Network[],
    private readonly iconUrl: string,
  ) {}

  start(host: DappHost) {
    this.host = host;
  }

  private load(): Promise<WcWallet> {
    const projectId = this.config.walletConnect.projectId;
    if (!projectId) {
      return Promise.reject(new ClipError("Connecting with a code isn't switched on in this build yet.", "walletconnect/no-project-id"));
    }
    this.wallet ??= import("@clip-wallet/1mask/walletconnect").then(({ createWalletConnectWallet }) =>
      createWalletConnectWallet({
        projectId,
        metadata: { name: this.config.name, description: this.config.name, url: "https://clipwallet.example", icons: [this.iconUrl] },
        networks: this.networks,
        addressesFor: (_chain, family) => {
          const a = this.host!.cachedAccount(family);
          return a ? [a.hederaAccountId ?? a.address] : [];
        },
        approveProposal: async (s) => {
          const chain = s.approvedChains[0];
          const net = this.networks.find((n) => n.id === chain) ?? this.networks[0]!;
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
        cancel: (id) => this.host!.cancel(id),
      }),
    );
    return this.wallet;
  }

  async pair(uri: string) {
    try {
      await (await this.load()).pair(uri);
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

const PLAIN_ETA: Partial<Record<Family, number>> = { evm: 12, hedera: 4, solana: 2, bitcoin: 600, sui: 1, aptos: 1 };

/** CLPRouter funding through @clip-wallet/route. Phase 1 routes pay on Hedera from EVM networks. */
export class RoutePlannerAdapter implements RoutePlanner {
  private client: RouteClient;
  constructor(
    private readonly config: ClipConfig,
    private readonly prices: PriceFeed,
    private readonly currency: () => Promise<string>,
  ) {
    this.client = createRouteClient({ network: "testnet" });
  }

  async plan({ decoded, balances, networks }: Parameters<RoutePlanner["plan"]>[0]): Promise<ApprovalPlan> {
    const net = networks.find((n) => n.id === decoded.networkId);
    const steps: PlanStep[] = [];
    let readyInSeconds = PLAIN_ETA[net?.family ?? "evm"] ?? 30;
    let problem: string | undefined;
    let feeFiat = decoded.fee?.fiatValue;
    const shortfalls = findShortfall(decoded, balances);
    for (const s of shortfalls) {
      try {
        const [quote] = await this.client.quote({
          to: decoded.networkId,
          asset: s.asset,
          amount: s.missing,
          mode: this.config.route.mode,
          filters: this.config.route.filters,
          portfolio: balances,
        });
        if (!quote) throw new ClipError(`You don't have enough ${s.asset.symbol} for this.`, "route/no-quote");
        steps.push({ kind: "funding", title: quote.title, detail: quote.steps.map((x) => x.text).join(" · ") });
        readyInSeconds = Math.max(readyInSeconds, quote.time.p90Seconds);
        const fx = this.prices.fx(await this.currency());
        feeFiat = (feeFiat ?? 0) + quote.fee.usd * fx;
        // Executing the funding leg (planPayOnHedera → Router.send) is not wired in this build yet.
        problem = "Moving money from your other balances isn't switched on in this build yet.";
      } catch (e) {
        problem = e instanceof ClipError ? e.userMessage : `You don't have enough ${s.asset.symbol} for this.`;
      }
    }
    const sponsored = !!decoded.fee?.sponsored;
    if (decoded.fee) steps.push({ kind: "gas", title: sponsored ? "Network fee paid for you" : "Network fee" });
    steps.push({ kind: "action", title: decoded.title, balanceChanges: decoded.balanceChanges });
    return {
      source: "Your balance",
      feeFiat,
      sponsored,
      readyInSeconds,
      steps,
      settlement: shortfalls.length
        ? "Settles once delivery is proven. If it doesn't arrive in time, the money comes back to you."
        : "If it fails, nothing leaves your balance.",
      problem,
    };
  }
}

/* ------------------------------------------------------------------ prices, names, dapps */

/**
 * Reference USD prices so testnet balances read as money. Placeholder until a price service exists;
 * testnet coins have no market value.
 */
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
  lookup(origin: string) {
    let host = origin;
    try {
      host = new URL(origin).hostname.replace(/^www\./, "");
    } catch {
      /* keep */
    }
    const name = KNOWN_DAPPS[host];
    return name ? { name, verified: true } : { name: host, verified: false };
  }
}

export type { Warning };
