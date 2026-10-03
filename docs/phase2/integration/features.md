# Integration: features stream (HashPack parity)

New in this stream:
- `packages/features` (`@clip-wallet/features`)
- `packages/ui/src/features/*`
- `apps/extension/src/background/features.ts`
- `apps/extension/src/shared/features-bus.ts`

Small edits already on this branch, because the new files need them to compile:
- `packages/ui/package.json`: dependency `@clip-wallet/features` (type-only use).
- `packages/ui/src/index.ts`: `export * from "./features";`
- `apps/extension/package.json`: dependency `@clip-wallet/features`.

Everything below is for the integration step. The edits were applied on a scratch copy and checked with
`pnpm typecheck && pnpm test` (see the end of this file).

## 1. Bus messages: `apps/extension/src/shared/messages.ts`

```ts
// imports
import { FEATURE_REQUESTS, type FeatureResponseMap } from "@clip-wallet/features";

// in `export const Request = z.discriminatedUnion("type", [ … ])`, after the devSimulateRequest entry:
  ...FEATURE_REQUESTS,

// change the ResponseMap declaration line to:
export interface ResponseMap extends FeatureResponseMap {
```

## 2. Background service: `apps/extension/src/background/service.ts`

```ts
// imports
import { isFeatureRequest, type FeatureRequest, type FeaturesService } from "@clip-wallet/features";

// field on WalletService
  private features?: FeaturesService;

// public methods on WalletService (the FeatureHost adapter calls these)
  attachFeatures(f: FeaturesService) {
    this.features = f;
  }
  featureCtx(networkId: string): Promise<ChainContext> {
    return this.ctx(networkId);
  }
  async featureBalances(): Promise<TokenBalance[]> {
    return (await this.portfolio()).balances;
  }
  /** Wallet-built request (staking, swap, trade) → the normal approval queue. */
  enqueueWalletRequest(request: DappRequest, appName: string) {
    return this.enqueueTransaction(request, { name: appName, origin: "wallet", domain: appName, verified: true });
  }
  async decodeForFeatures(request: DappRequest): Promise<DecodedRequest> {
    const network = this.network(request.networkId);
    return this.module(network.family).decode(request, await this.ctx(network.id));
  }

// in dispatch(), right after `this.requireUnlocked(status);`
    if (isFeatureRequest(m)) {
      if (!this.features) throw new ClipError("This isn't available in this build.", "features/off");
      return this.features.handle(m as FeatureRequest);
    }

// in enqueueTransaction(), right after the try/catch that sets `decoded`:
    decoded = this.features?.refine(request, decoded) ?? decoded;
```

Wallet-built requests carry `origin: "wallet"`, which `createFeatureHost` sets. That keeps the existing
"isn't a site … recognises" caution off them.

## 3. Wiring: `apps/extension/src/background/wiring.ts`

Replace the reference price table with the CoinGecko feed:

```ts
// imports: remove ReferencePriceFeed from the "./real" import, add:
import { createPriceFeed } from "./features";

// in createDependencies(), real branch: replace `const prices = new ReferencePriceFeed();` with
  const prices = createPriceFeed(opts.kv, opts.features?.coingeckoDemoKey);

// WiringOptions: add
  /** Partner keys for features (from build env; never committed). */
  features?: import("@clip-wallet/features").FeaturesConfig & { coingeckoDemoKey?: string };
```

Optional: also mark featured domains as verified in `KnownDappRegistry.lookup` (`real.ts`):

```ts
import { isFeaturedOrigin } from "@clip-wallet/features";
// in lookup(), before `return name ? …`:
    const featured = isFeaturedOrigin(origin);
    if (!name && featured) return { name: featured.name, verified: true };
```

## 4. Background bootstrap: `apps/extension/src/background/main.ts`

```ts
// imports
import { createFeatureHost, createFeatures } from "./features";

// pass to createDependencies({ … }):
    features: __CLIP_FEATURES__,

// after `const svc = service;`
  svc.attachFeatures(
    createFeatures(
      createFeatureHost({
        networks: deps.networks,
        assets: deps.assets,
        kv,
        ctx: (id) => svc.featureCtx(id),
        balances: () => svc.featureBalances(),
        enqueue: (request, appName) => svc.enqueueWalletRequest(request, appName),
        decode: (request) => svc.decodeForFeatures(request),
        usd: (key) => deps.prices.usd(key),
      }),
      __CLIP_FEATURES__,
    ),
  );
```

## 5. Build config: `apps/extension/wxt.config.ts` and `src/env.d.ts`

```ts
// wxt.config.ts, top level
/** Feature partner keys from the build environment. Absent = that provider shows as "not switched on". */
const FEATURES = {
  testnet: !clipConfig.mainnet,
  swap: { zeroExApiKey: process.env.CLIP_0X_API_KEY || undefined, jupiterApiKey: process.env.CLIP_JUPITER_API_KEY || undefined },
  onramp: {
    moonpay: process.env.CLIP_MOONPAY_API_KEY && process.env.CLIP_MOONPAY_SIGNER_URL
      ? { apiKey: process.env.CLIP_MOONPAY_API_KEY, signerUrl: process.env.CLIP_MOONPAY_SIGNER_URL } : undefined,
    banxa: process.env.CLIP_BANXA_PARTNER ? { partner: process.env.CLIP_BANXA_PARTNER } : undefined,
    c14: process.env.CLIP_C14_CLIENT_ID ? { clientId: process.env.CLIP_C14_CLIENT_ID, assetIds: JSON.parse(process.env.CLIP_C14_ASSET_IDS || "{}") } : undefined,
  },
  coingeckoDemoKey: process.env.CLIP_COINGECKO_DEMO_KEY || undefined,
};

// manifest(): host_permissions: [...rpHost, "https://api.coingecko.com/*", "https://api.jup.ag/*", "https://api.0x.org/*"],
// vite().define: add
      __CLIP_FEATURES__: JSON.stringify(FEATURES),
```

```ts
// src/env.d.ts, inside `declare global`
  /** Feature partner keys and switches (wxt.config.ts FEATURES). */
  const __CLIP_FEATURES__: import("@clip-wallet/features").FeaturesConfig & { coingeckoDemoKey?: string };
```

Test configs that define globals (`apps/extension/vitest.config.ts`) need `__CLIP_FEATURES__: JSON.stringify({ testnet: true })`.

Partner keys and the MoonPay signer URL are build-time env only. Never commit them or put them in
`clip.config.ts`.

## 6. Pages: `apps/extension/src/pages/mount.tsx`

```ts
import { createFeaturesBusClient } from "../shared/features-bus";
// in mountWallet(): add the prop
  render(<WalletApp … features={createFeaturesBusClient()} />);
```

## 7. UI routes: `packages/ui/src/App.tsx`

```ts
// imports
import { FeaturesProvider, featureRoute, type FeaturesClient } from "./features";

// in Routes(), right after `const seg = pathname.split("/").filter(Boolean);`
  const feature = featureRoute(seg, query, typeof location !== "undefined" ? location.hash : "");
  if (feature) return feature;

// WalletAppProps: add
  features?: FeaturesClient;

// WalletApp(): wrap the Router children
        <Frame>
          {props.features ? <FeaturesProvider client={props.features}><Routes /></FeaturesProvider> : <Routes />}
        </Frame>
```

## 8. Entry points: Home actions and the Settings menu

`packages/ui/src/screens/Home.tsx`, in the hero `clip-actions` after Receive:

```tsx
        <Button variant="secondary" onClick={() => navigate("/swap")}>Swap</Button>
        <Button variant="secondary" onClick={() => navigate("/buy")}>Buy</Button>
```

In `AssetDetail`'s hero actions (stake only for coins that can be staked):

```tsx
        <Button variant="ghost" onClick={() => navigate(`/swap?sell=${encodeURIComponent(asset.key)}`)}>Swap</Button>
        {["hbar", "sol"].includes(asset.key) && (
          <Button variant="ghost" onClick={() => navigate(`/stake?asset=${encodeURIComponent(asset.key)}`)}>Stake</Button>
        )}
```

`packages/ui/src/screens/Settings.tsx`, a new section before "Display":

```tsx
      <Section title="More">
        <Row label={<button type="button" className="clip-link" onClick={() => navigate("/stake")}>Stake</button>} value="" />
        <Row label={<button type="button" className="clip-link" onClick={() => navigate("/trade")}>Secure Trade</button>} value="" />
        <Row label={<button type="button" className="clip-link" onClick={() => navigate("/explore")}>Explore apps</button>} value="" />
      </Section>
```

The bottom TabBar is unchanged. Swap, Buy, Stake, Secure Trade and Explore are reached from Home and Settings.

## 9. Secure Trade links into the wallet

Share links look like `https://clipwallet.example/trade#offer=…`. Set `FeaturesConfig.tradeLinkBase` to a page
you control that forwards the fragment into the extension (`tab.html#/trade/open` + the `#offer=` fragment), or
paste the link into **Secure Trade → Open a trade link**. `featureRoute` reads `?link=` or the hash.

1Mask must keep `clip_hedera_signTransactionBytes` internal (it is already wallet-only in chains-hedera).
Never add it to `packages/1mask/src/background/methods.ts`.

## 10. Families from other streams

- Staking: implement `StakingProvider` (`packages/features/src/staking/types.ts`) for Cardano, Substrate, NEAR and
  Tezos (plans in `staking/stubs.ts`). Add the instances in `FeaturesService`'s constructor
  (`packages/features/src/background.ts`) and delete the matching `PENDING_STAKING` entry.
- Swaps: implement `SwapProvider` and add it to the `SwapService` list there.
- Featured apps for those families already exist in `dapps/featured.json`. They appear once the family's
  network is switched on.

## Verification (on a scratch copy with sections 1–8 applied)

`pnpm install && pnpm typecheck && pnpm test && pnpm harness` all passed. See the stream report for counts.
