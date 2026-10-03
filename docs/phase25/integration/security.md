# Integration: security (Phase 2.5)

Stream branch `p25/security`. New package `@clip-wallet/security`, new screens in `packages/ui/src/security/`.
Nothing here touches the shared background, catalog, engine, 1Mask or config files. This doc has the exact lines
for the integration step. Everything below is additive.

Already on the branch (small and additive, outside the shared list):
- `packages/core/src/index.ts`: `Warning.code` gains `"phishing-site" | "address-poisoning" | "malicious-transaction"`.
- `packages/ui/src/client.ts`: `ConnectView.warnings?: Warning[]`. `packages/ui/src/screens/Approval.tsx`: the
  connect approval renders those warnings. With a danger warning, the button becomes "Connect anyway" (danger
  style). Today the WalletConnect Verify warnings passed to `enqueueConnect` are dropped; this is where they go.
- `packages/ui/src/index.ts`: `export * from "./security";`
- `packages/ui/package.json`: depends on `@clip-wallet/security` (type-only import of `/views`).

## 0. Dependencies

`apps/extension/package.json` and `packages/engine/package.json` → `"@clip-wallet/security": "workspace:*"`.

## 1. Build config (keys never committed)

Next to `__CLIP_FEATURES__` (extension `wxt.config.ts` define, mobile build config), add `__CLIP_SECURITY__`:

```ts
// SecurityConfig from @clip-wallet/security
const security = {
  testnet: true,
  threat: {
    openLists: true,            // MetaMask, ScamSniffer, Phantom, PolkadotJS (downloads only)
    refreshHours: 24,
    // Blockaid is OFF unless a key is present. When on, Blockaid receives the site, the transaction and the user's address.
    ...(process.env.CLIP_BLOCKAID_API_KEY ? { blockaid: { apiKey: process.env.CLIP_BLOCKAID_API_KEY } } : {}),
  },
};
```

Note: a key compiled into an extension can be read by anyone who has the bundle. For production, point
`blockaid.baseUrl` at a proxy you run that adds the key. The proxy then sees the same data Blockaid sees. Say so
in the privacy policy.

## 2. Extension background: `apps/extension/src/background/main.ts`

After `svc.attachFeatures(...)`:

```ts
import { RecipientLog, SecurityService } from "@clip-wallet/security";
// …
const recipients = new RecipientLog(kv);
const security = new SecurityService(
  {
    ...createFeatureHost({
      networks: deps.networks,
      assets: deps.assets,
      kv,
      ctx: (id) => svc.featureCtx(id),
      balances: () => svc.featureBalances(),
      enqueue: (request, appName) => svc.enqueueWalletRequest(request, appName),
      decode: (request) => svc.decodeForFeatures(request),
      usd: (key) => deps.prices.usd(key),
    }),
    nfts: () => svc.securityNfts(),
    history: () => recipients.list(),
  },
  __CLIP_SECURITY__,
);
svc.attachSecurity(security, recipients);
void security.start(); // loads cached lists; refreshes stale ones in the background
```

## 3. Extension background: `apps/extension/src/background/service.ts` (about 25 lines)

```ts
import type { RecipientLog, SecurityService } from "@clip-wallet/security";
import { hideKey, isSecurityRequest, type SecurityRequest } from "@clip-wallet/security";

  private security?: Pick<SecurityService, "handle" | "refine" | "assessSite" | "threat" | "cleanup">;
  private recipients?: RecipientLog;
  attachSecurity(s: SecurityService, recipients?: RecipientLog) {
    this.security = s;
    this.recipients = recipients;
  }
  securityNfts(): Promise<Nft[]> {
    return this.collectibles();
  }
```

Bus dispatch, right after the `isFeatureRequest` block:

```ts
    if (isSecurityRequest(m)) {
      if (!this.security) throw new ClipError("This isn't available in this build.", "security/off");
      return this.security.handle(m as SecurityRequest);
    }
```

**Decode path.** In `enqueueTransaction`, right after `decoded = this.features?.refine(request, decoded) ?? decoded;`:

```ts
    if (this.security) {
      decoded = await this.security.refine(request, decoded, network, ctx.account.hederaAccountId ?? ctx.account.address, {
        recipients: extra.recipient ? [extra.recipient] : [],
      });
    }
```

Then remember real sends for the look-alike check. In the same method, after `this.approvals.set(...)`:

```ts
    if (extra.recipient && this.recipients) {
      const out = decoded.balanceChanges.find((c) => c.delta.startsWith("-"));
      promise.then(() => this.recipients!.record({ family: network.family, networkId: network.id, counterparty: extra.recipient!, amount: out ? out.delta.slice(1) : "1", assetKey: out?.asset.key, timestamp: Date.now() })).catch(() => undefined);
    }
```

**Connect path.** In `enqueueConnect`, before building `view`:

```ts
    const siteWarnings = [...(p.warnings ?? []), ...((await this.security?.assessSite(p.origin).catch(() => [])) ?? [])];
```

Then add `warnings: siteWarnings` to the `connect: { … }` object.

**WalletConnect.** In `apps/extension/src/background/real.ts`, `createWalletConnectWallet({ … })`, add:

```ts
        isKnownScam: (origin) => this.host!.isKnownScam?.(origin) ?? false,
```

Expose it on the service (sync; it uses only the loaded lists):

```ts
  isKnownScam(origin: string): boolean {
    return this.security?.threat.isKnownScam(origin) ?? false;
  }
```

Also add `isKnownScam?(origin: string): boolean` to the `DappHost` type the adapter holds. `assessVerify` in
`@clip-wallet/1mask/walletconnect/verify.ts` already merges Verify's `isScam` with this hook. With it, a listed
site shows "known-scam" on the proposal and on every request.

**Hide spam.** In `portfolio()` (and `collectibles()`), filter what Cleanup hid:

```ts
    const hidden = (await this.security?.cleanup.hidden()) ?? new Set<string>();
    balances = balances.filter((b) => !b.asset.address || !hidden.has(hideKey(b.asset.networkId, b.asset.address)));
    // collectibles: nfts.filter((n) => !hidden.has(hideKey(n.networkId, n.collection.address, n.tokenId)) && !hidden.has(hideKey(n.networkId, n.tokenId)))
```

(The second NFT key covers Solana, where a hidden NFT is keyed by its mint.)

## 4. Shared messages: `apps/extension/src/shared/messages.ts` (and `packages/engine/src/messages.ts`)

```ts
import { SECURITY_REQUESTS, type SecurityResponseMap } from "@clip-wallet/security/messages";
// in the Request union, after ...FEATURE_REQUESTS:
  ...SECURITY_REQUESTS,
// ResponseMap:
export interface ResponseMap extends FeatureResponseMap, SecurityResponseMap {
```

## 5. Page-side client: new file `apps/extension/src/shared/security-bus.ts`

```ts
import type { SecurityRequest, SecurityResponseMap } from "@clip-wallet/security";
import type { SecurityClient } from "@clip-wallet/ui";
import { browser } from "wxt/browser";
import { Envelope } from "./messages";

class SecurityBusError extends Error {
  constructor(public readonly userMessage: string, public readonly code: string) {
    super(`${code}: ${userMessage}`);
  }
}

export function createSecurityBusClient(transport: (m: SecurityRequest) => Promise<unknown> = (m) => browser.runtime.sendMessage(m)): SecurityClient {
  async function call<T extends SecurityRequest["type"]>(msg: Extract<SecurityRequest, { type: T }>): Promise<SecurityResponseMap[T]> {
    let raw: unknown;
    try {
      raw = await transport(msg);
    } catch {
      throw new SecurityBusError("The wallet is waking up. Try again in a moment.", "bus/unavailable");
    }
    const env = Envelope.safeParse(raw);
    if (!env.success) throw new SecurityBusError("Something went wrong. Please try again.", "bus/bad-reply");
    if (!env.data.ok) throw new SecurityBusError(env.data.error.userMessage, env.data.error.code);
    return env.data.data as SecurityResponseMap[T];
  }
  return {
    approvalsScan: () => call({ type: "secApprovalsScan" }),
    revoke: (p) => call({ type: "secRevoke", ...p }),
    cleanupScan: () => call({ type: "secCleanupScan" }),
    cleanupPreview: (p) => call({ type: "secCleanupPreview", ...p }),
    cleanupRun: (p) => call({ type: "secCleanupRun", ...p }),
    unhide: (p) => call({ type: "secUnhide", ...p }),
    threatStatus: () => call({ type: "secThreatStatus" }),
    threatRefresh: () => call({ type: "secThreatRefresh" }),
    checkSite: (p) => call({ type: "secCheckSite", ...p }),
  };
}
```

`apps/extension/src/pages/mount.tsx`: pass `security={createSecurityBusClient()}` to `<WalletApp …>`.

## 6. UI routing: `packages/ui/src/App.tsx` (about 10 lines)

```ts
import { SecurityProvider, securityRoute, useSecurityOptional, type SecurityClient } from "./security";
// WalletAppProps:
  /** Settings → Security (permissions, spam cleanup, scam protection). Without it the entry is hidden. */
  security?: SecurityClient;
// WalletApp: wrap <Routes /> (inside the FeaturesProvider branch and the plain branch):
  {props.security ? <SecurityProvider client={props.security}><Routes /></SecurityProvider> : <Routes />}
// Routes(): next to `const features = useFeaturesOptional();`
  const security = useSecurityOptional();
// case "settings":
      if (seg[1] === "security" && security) return securityRoute(seg)!;
```

## 7. Settings menu: `packages/ui/src/screens/Settings.tsx` (4 lines)

In the `<nav className="clip-menu" aria-label="Backup and accounts">` block, after "Accounts":

```tsx
          {security && (
            <button type="button" className="clip-menu__item" onClick={() => navigate("/settings/security")}>Security</button>
          )}
```

with `const security = useSecurityOptional();` next to `useHardwareOptional()`.

## 8. Mobile / engine (`packages/engine/src/engine.ts`, `apps/mobile/src/background/host.ts`)

Mirror sections 2–4 in the engine (it has the same `attachFeatures`, `enqueueTransaction` and `enqueueConnect`
shapes). For WalletConnect, add `isKnownScam` in `packages/engine/src/adapters.ts` `createWalletConnectWallet({…})`.
In `apps/mobile/src/background/host.ts`, build the `SecurityService` next to the features. Pass the same host
plus `kv` from the mobile KV adapter.

## Behaviour after wiring

- **Connect** (injected and WalletConnect): open-list hits (and Blockaid's site scan when on) appear on the
  connect approval as danger warnings; Connect becomes "Connect anyway".
- **Every approval**: after the chain module's decode and `features.refine`, `security.refine` adds:
  `phishing-site` (origin on a list), `malicious-transaction` (a spender/recipient on a scam address list, or
  Blockaid Malicious/Warning), `address-poisoning` (recipient looks like a saved/used address, or only seen in a
  zero-value transfer), `new-recipient` (contract created in the last 7 days). It never throws and never removes
  the module's own warnings.
- **Revoke / cleanup**: queued one approval at a time through `host.enqueue` (origin "wallet"). The user confirms
  each transaction on the normal approval screen; the vault signs there.

## Gaps (said plainly)

- Activity has no counterparties, so look-alike checks use the user's saved sends (`RecipientLog`) and the
  address book (none exists yet; `SecurityHost.addressBook` is ready for it). Zero-value poisoning detection
  needs inbound transfers from an indexer (Blockscout `/api/v2/addresses/{me}/token-transfers`). Not wired, so
  only zero-value entries the host reports are used.
- EVM permissions without Blockscout are checked only over the last 200 000 blocks (`partial` note shown).
  ERC-721 single-token approvals aren't listed (they clear when the NFT moves).
- Starknet, Tezos FA2 operators, Polkadot Asset Hub approvals/proxies and Stellar Soroban allowances exist
  but aren't listed yet (shown as notes). Aptos and Sui have no allowance concept (shown as notes).
- Burning a Metaplex NFT with the token program leaves its metadata accounts (and their deposit) behind. Using
  Metaplex `BurnV1` would return it, but the Solana module would show it as blind.
- Open lists carry their own licences and update cadences (ScamSniffer's open copy is 7 days behind).
