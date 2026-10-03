import { ClipError, type Network } from "@clip-wallet/core";
import type { FeatureHost } from "../host.js";
import type { OnRampOptionView, OnRampView } from "../views.js";
import { CHAIN_PREFERENCE, type ChainKey, type OnRampProvider, chainKeyOf } from "./types.js";

/**
 * "What do you want to buy, and how much?" The wallet picks where the coin lands: the cheapest network this
 * wallet has switched on that the provider can deliver to. Test builds use each provider's sandbox.
 */
export class OnRampService {
  constructor(
    private readonly host: FeatureHost,
    private readonly providers: OnRampProvider[],
    private readonly opts: { testnet: boolean },
  ) {}

  /** Asset keys at least one configured provider can deliver somewhere in this wallet. */
  buyable(): { assetKey: string; symbol: string; name: string }[] {
    const out = new Map<string, { assetKey: string; symbol: string; name: string }>();
    for (const a of this.host.assets()) {
      if (a.bridged || a.spam || out.has(a.key)) continue;
      const n = this.host.networks().find((x) => x.id === a.networkId);
      const chain = n && chainKeyOf(n);
      if (!chain) continue;
      if (this.providers.some((p) => !p.configured() && p.supports(a.key, chain, this.opts.testnet))) out.set(a.key, { assetKey: a.key, symbol: a.symbol, name: a.name });
    }
    return [...out.values()];
  }

  private candidates(assetKey: string): { network: Network; chain: ChainKey }[] {
    const nets = this.host
      .networks()
      .filter((n) => this.host.assets().some((a) => a.key === assetKey && a.networkId === n.id && !a.bridged))
      .flatMap((network) => {
        const chain = chainKeyOf(network);
        return chain ? [{ network, chain }] : [];
      });
    return nets.sort((a, b) => CHAIN_PREFERENCE.indexOf(a.chain) - CHAIN_PREFERENCE.indexOf(b.chain));
  }

  async options(p: { assetKey: string; fiatAmount: number; fiatCurrency: string }): Promise<OnRampView> {
    if (!Number.isFinite(p.fiatAmount) || p.fiatAmount <= 0) throw new ClipError("Enter how much you want to spend.", "onramp/bad-amount");
    if (p.fiatAmount > 50_000) throw new ClipError("That's more than these services allow in one go.", "onramp/too-much");
    const asset = this.host.assets().find((a) => a.key === p.assetKey && !a.bridged);
    if (!asset) throw new ClipError("This wallet can't hold that yet.", "onramp/unknown-asset");
    const cands = this.candidates(p.assetKey);
    let picked: Network | undefined;
    const options: OnRampOptionView[] = [];
    for (const prov of this.providers) {
      const why = prov.configured();
      if (why) {
        options.push({ provider: prov.id, name: prov.name, unavailable: why });
        continue;
      }
      const c = cands.find((x) => prov.supports(p.assetKey, x.chain, this.opts.testnet));
      if (!c) {
        options.push({ provider: prov.id, name: prov.name, unavailable: { code: "onramp/unsupported", message: `${prov.name} can't deliver ${asset.symbol} to this wallet${this.opts.testnet ? " in this test version" : ""}.` } });
        continue;
      }
      const ctx = await this.host.ctx(c.network.id);
      const address = c.chain === "hedera" ? ctx.account.hederaAccountId : ctx.account.address;
      if (!address) {
        options.push({ provider: prov.id, name: prov.name, unavailable: { code: "onramp/account-not-open", message: "Your account opens when it first receives HBAR. Receive a little HBAR first." } });
        continue;
      }
      try {
        const url = await prov.buildUrl(
          { assetKey: p.assetKey, chain: c.chain, address, fiatAmount: p.fiatAmount, fiatCurrency: p.fiatCurrency, sandbox: this.opts.testnet },
          this.host.fetch,
        );
        options.push({ provider: prov.id, name: prov.name, url, methods: prov.methods });
        picked ??= c.network;
      } catch (e) {
        options.push({ provider: prov.id, name: prov.name, unavailable: { code: "onramp/failed", message: e instanceof ClipError ? e.userMessage : `${prov.name} isn't available right now.` } });
      }
    }
    const view: OnRampView = {
      assetKey: p.assetKey,
      symbol: asset.symbol,
      explainer: `Your ${asset.symbol} arrives in this wallet. Clip Wallet picked the cheapest way to receive it.${this.opts.testnet ? " This test version uses each service's test mode: no real money moves." : ""}`,
      options,
    };
    if (picked) view.networkId = picked.id;
    return view;
  }
}
