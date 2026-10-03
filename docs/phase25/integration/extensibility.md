# Phase 2.5 integration: extensibility (stream p25/extensibility)

Three pieces:

1. **Clip Plugins**: new package `@clip-wallet/plugins` (the MetaMask Snaps idea, narrower).
2. **Google / Apple sign-in** for passkey backups: `services/backup`, `@clip-wallet/backup-client`, the engine and the UI.
3. **"Trade & earn" in Explore**: curated, verified dapps for regulated products, reached only through 1Mask or WalletConnect.

What is already in the tree:

- The packages, the Worker, tests, the UI screens and their routes.
- Optional client methods.
- Additive type changes:
  - `NameService` gains `"plugin"`, and `ResolvedName` gains `via?`.
  - `FeaturedDappView.category` gains `"trade"`, plus optional `kind` and `note`.

What this doc gives the integration step: the exact lines for the shared extension files, which this stream did not touch (`apps/extension/src/background/{wiring,service}.ts`, `apps/extension/src/shared/*`, `wxt.config.ts`, `packages/engine/src/engine.ts`).

Small edits made directly, all additive:

| File | Change |
|---|---|
| `packages/ui/src/App.tsx` | 2 lines: the `settings/plugins` route |
| `packages/ui/src/screens/Settings.tsx` | 6 lines: a "Plugins" button, shown only in Advanced mode and only when the client has plugins |
| `packages/ui/src/screens/Approval.tsx` | 2 lines: `<PluginInsights>` under the wallet's own warnings |
| `packages/ui/src/screens/PasskeyBackup.tsx` | Google/Apple buttons |
| `packages/ui/src/platform/client.ts` | Optional `backupProviders?` / `backupSocialSignIn?` |
| `packages/ui/src/index.ts` | Re-exports plugins |
| `packages/names` | `PluginBackend` |
| `packages/features` | Trade & earn data, `TRADE_DISCLAIMER`, `tradeAndEarnFor` |
| `packages/engine/src/social-signin.ts` | New file |

`services/backup` is merged with main (Resend email, the deploy).

---

## 1. Clip Plugins

### Safety model (what integration must preserve)

- **Off by default.** `PluginRegistry.runnable()` returns `[]` unless Advanced mode **and** the Plugins switch are both on. Turning either off must stop everything: call `sync` (below) after `setPrefs` too.
- Plugins run **only** in the sandbox page (`plugin-sandbox.html`: opaque origin, no `chrome.*`, CSP `SANDBOX_CSP`), one iframe per plugin, under SES `lockdown()` + `Compartment`.
- The iframes live in an **offscreen document**, never in the popup or the approval window. A plugin that loops forever can then only freeze that document; the background closes it on timeout.
- The background never passes a plugin anything from the vault. Plugin output is attached as `decoded.pluginInsights` and **never** merged into `decoded.lines` / `decoded.warnings`. The approval UI renders it in its own "From <plugin>" card.
- A plugin can't sign. Nothing in the plugin message schema reaches `approve`, and the approval flow is unchanged.

### 1a. `apps/extension/wxt.config.ts` (manifest)

```ts
import { SANDBOX_CSP } from "@clip-wallet/plugins";
// …
const csp = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; frame-src 'self'";   // was frame-src 'none': the offscreen host frames the sandbox page (same extension origin only)
return {
  // …
  permissions: ["storage", "alarms", "offscreen", "identity"],     // + offscreen (plugin host), + identity (Google/Apple sign-in)
  host_permissions: [ /* … */ "https://registry.npmjs.org/*" ],   // plugin install
  content_security_policy: manifestVersion === 3 ? { extension_pages: csp, sandbox: SANDBOX_CSP } : (csp as unknown as never),
  sandbox: { pages: ["plugin-sandbox.html"] },
};
```

Firefox doesn't support the manifest `sandbox` key or `chrome.offscreen`. For Firefox builds, leave the plugin wiring out: `asPlugins(client)` returns null and the UI says "Plugins aren't available in this version".

### 1b. New entrypoints (copy the templates)

- `packages/plugins/extension/plugin-sandbox.html` → `apps/extension/src/entrypoints/plugin-sandbox/index.html`
- `packages/plugins/extension/plugin-host.ts` → `apps/extension/src/entrypoints/plugin-host/main.ts`, plus an `index.html` containing `<script type="module" src="./main.ts"></script>`

Add `"@clip-wallet/plugins": "workspace:*"` to `apps/extension/package.json`.

### 1c. Background (`apps/extension/src/background/wiring.ts` / `service.ts`)

New file `apps/extension/src/background/plugins.ts` (so `service.ts` only gets the hooks below):

```ts
import { PluginRegistry, PluginsService, type HostBridgeRequest, type InstalledPlugin, type PluginInsight, type InsightInput, type PluginNameResult } from "@clip-wallet/plugins";

const HOST_URL = "plugin-host.html";
async function ensureHost() {
  if (await chrome.offscreen.hasDocument?.()) return;
  await chrome.offscreen.createDocument({ url: HOST_URL, reasons: [chrome.offscreen.Reason.IFRAME_SCRIPTING], justification: "Run sandboxed plugins" });
}
async function toHost<T>(request: HostBridgeRequest, timeoutMs: number): Promise<T | null> {
  await ensureHost();
  const timer = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
  const res = (await Promise.race([chrome.runtime.sendMessage({ target: "plugin-host", request }), timer])) as T | null;
  if (res === null) await chrome.offscreen.closeDocument().catch(() => undefined);   // a stuck plugin can't hold the wallet
  return res;
}

export function createPlugins(kv: KV, prefs: () => Promise<{ advanced: boolean }>) {
  let running: InstalledPlugin[] = [];
  const registry = new PluginRegistry({ kv, advanced: async () => (await prefs()).advanced, changed: () => void sync() });
  async function sync() {
    running = await registry.runnable();
    if (!running.length) {
      if (await chrome.offscreen.hasDocument?.()) await chrome.offscreen.closeDocument();
      return;
    }
    await toHost({ type: "pluginHostSync", plugins: running }, 10_000);
  }
  return {
    service: new PluginsService(registry),
    sync,
    insights: async (input: InsightInput) =>
      running.some((p) => p.manifest.permissions.transactionInsight) ? ((await toHost<PluginInsight[]>({ type: "pluginHostInsights", input }, 2000)) ?? []) : [],
    resolveName: (name: string) => toHost<PluginNameResult>({ type: "pluginHostResolveName", name }, 2000),
    suffixes: () => running.flatMap((p) => p.manifest.permissions.nameResolution?.suffixes ?? []),
  };
}
```

In `service.ts`:

```ts
// constructor
this.plugins = createPlugins(kv, () => this.prefs());
// start()
void this.plugins.sync();
// dispatch(), next to the platform line
if (this.plugins.service.handles(m.type)) { this.requireUnlocked(status); return this.plugins.service.handle(m); }
// setPrefs(): after saving
void this.plugins.sync();
// enqueueTransaction(): after the domain-mismatch warning is pushed, before the approval is stored
const insights = decoded.blind ? [] : await this.plugins.insights(toInsightInput(decoded, request.origin, ctx.account.address));
decoded = withPluginInsights(decoded, insights);
```

(`toInsightInput` and `withPluginInsights` come from `@clip-wallet/plugins`.) Plugins are not asked about blind requests.

Plugin notifications arrive as `{ type: "pluginNotification", pluginName, from, text }` from the host document. Show them with `chrome.notifications.create({ title: `${pluginName} (plugin)`, message: text })`, which needs the `notifications` permission, or as an in-wallet notice. They are already rate-limited (3 an hour, 10 a day) by the host.

Names: in `wiring.ts`, pass the plugin backend last (built-ins always win):

```ts
import { EnsBackend, HnsBackend, MultiNameResolver, PluginBackend, SnsBackend } from "@clip-wallet/names";
names: new MultiNameResolver({ networks }, [
  new EnsBackend({ networks }), new SnsBackend({}), new HnsBackend({ ledger: hasHederaTestnet ? "testnet" : "mainnet" }),
  new PluginBackend((n) => plugins.resolveName(n), () => plugins.suffixes()),
]),
```

Send must show `resolved.via.from` ("from <plugin>") next to a plugin-resolved address. `ResolvedName.displayName` already includes it.

### 1d. Bus (`apps/extension/src/shared/messages.ts` + `bus.ts`, and the engine copies)

Add to the request union:

```ts
...PluginsRequestSchema.options,      // from @clip-wallet/plugins
```

Add to `ResponseMap`:

```ts
pluginsStatus: PluginsStatusView; pluginsSetEnabled: void; pluginsPrepareInstall: PendingInstallView;
pluginsConfirmInstall: PluginView; pluginsCancelInstall: void; pluginsRemove: void; pluginsSetPluginEnabled: void;
```

Client (`bus.ts`):

```ts
pluginsStatus: () => call({ type: "pluginsStatus" }),
pluginsSetEnabled: (p) => call({ type: "pluginsSetEnabled", ...p }),
pluginsPrepareInstall: (p) => call({ type: "pluginsPrepareInstall", ...p }),
pluginsConfirmInstall: (p) => call({ type: "pluginsConfirmInstall", ...p }),
pluginsCancelInstall: () => call({ type: "pluginsCancelInstall" }),
pluginsRemove: (p) => call({ type: "pluginsRemove", ...p }),
pluginsSetPluginEnabled: (p) => call({ type: "pluginsSetPluginEnabled", ...p }),
```

The UI picks these up automatically (`asPlugins(client)`). `ApprovalView.decoded` carries `pluginInsights` through unchanged.

Mobile (`apps/mobile`): no plugins. React Native has no sandboxed iframe, and a WebView sandbox would need its own review. Leave the client methods out; the UI hides the feature.

---

## 2. Google / Apple sign-in for backups

Server: `services/backup/src/oidc.ts` + `migrations/0002_oidc.sql`. Setup, secrets and commands: `docs/phase25/deploy.md` → "Google / Apple sign-in". Client: `BackupClient.providers()`, `startSocialSignIn(provider, returnTo)`, `completeSocialSignIn(returnedUrl, pending)`.

Background, using the new `packages/engine/src/social-signin.ts` (export `@clip-wallet/engine/social-signin`):

```ts
import { SocialSignInService } from "@clip-wallet/engine/social-signin";
// constructor
this.social = new SocialSignInService({
  backup: deps.backup,                                   // same factory as PlatformService
  kv,
  launchWebAuthFlow: (url) => chrome.identity.launchWebAuthFlow({ url, interactive: true }),
  returnUrl: chrome.identity.getRedirectURL("backup"),   // https://<extension id>.chromiumapp.org/backup → put in OIDC_RETURN_URLS
  changed: () => env.broadcast(),
});
// dispatch(), next to the platform line
if (this.social.handles(m.type)) return this.social.handle(m as SocialSignInRequest);
```

The bus needs the `identity` permission (1a). Schemas:

```ts
z.object({ type: z.literal("backupProviders") }),
z.object({ type: z.literal("backupSocialSignIn"), provider: z.enum(["google", "apple"]) }),
// ResponseMap
backupProviders: { email: boolean; google: boolean; apple: boolean }; backupSocialSignIn: void;
// bus.ts / engine client.ts
backupProviders: () => call({ type: "backupProviders" }),
backupSocialSignIn: (p) => call({ type: "backupSocialSignIn", ...p }),
```

The deployed backup's `ALLOWED_ORIGINS` doesn't matter here: the background calls it with host permission.

Mobile: pass `launchWebAuthFlow` built on `expo-web-browser` `openAuthSessionAsync(url, returnUrl)` (ASWebAuthenticationSession / Custom Tabs), with an https universal-link `returnUrl` added to `OIDC_RETURN_URLS`. Without it, the mobile UI simply doesn't show the buttons.

What users are told (in the UI and the README): Google or Apple only tells the service which backups are yours. They never see your keys, and the backup stays locked with your passkey. Email, Google and Apple are separate backup accounts.

---

## 3. "Trade & earn" in Explore

Data: `packages/features/src/dapps/featured.json`, category `"trade"`, with `kind` and `note`. It is served by the existing `featFeatured` message, so nothing to wire. `Explore.tsx` shows the entries in their own section under `TRADE_DISCLAIMER`. Opening an app is `openExternal(url)`; the wallet then connects only through 1Mask (EIP-6963 injected) or WalletConnect, on the normal approval path. Clip Wallet builds none of these products natively.

| App | Kind | Domain | Checked 2026-10-03 | Connects with | Availability (from the app's docs or terms) |
|---|---|---|---|---|---|
| Hyperliquid | perps | app.hyperliquid.xyz | 200 | EVM wallets, WalletConnect | Not US, Ontario, sanctioned ([terms](https://app.hyperliquid.xyz/terms)) |
| dYdX | perps | dydx.trade | 200 | MetaMask/EVM, Phantom, Keplr, WalletConnect ([help](https://help.dydx.trade/en/articles/166997-supported-default-wallets-on-dydx-chain)) | Not US, Canada, UK, sanctioned ([geo](https://help.dydx.trade/en/articles/166970-geo-restrictions-site-access)) |
| GMX | perps | app.gmx.io | 200 (→ /trade) | EVM wallets, WalletConnect | Varies |
| Polymarket | predictions | polymarket.com | **not reachable from the checking network** (DNS-blocked in the Philippines), listed from docs/press | MetaMask, WalletConnect (or email) | Blocked in many countries |
| Ondo | stocks / funds | app.ondo.finance | 200 | EVM wallets ([MetaMask × Ondo](https://metamask.io/news/metamask-adds-tokenized-us-stocks-etfs-and-commodities-via-ondo-global)) | Not US ([docs](https://docs.ondo.finance/ondo-global-markets/overview)); KYC |
| Sky | yield | app.sky.money | 200 | EVM wallets | n/a |
| Ethena | yield | app.ethena.fi | 200 | EVM wallets | Some countries restricted |
| Pendle | yield | app.pendle.finance | 200 | EVM wallets | n/a |

The perps note reads "Leveraged trading can lose everything you put in, fast" rather than "more than you put in". On these venues a position is liquidated at its margin, so "everything you put in" is the accurate worst case. Every entry also carries a geo note or falls under the section disclaimer.

---

## Sources (checked 2026-10-03)

- Chrome MV3 sandbox pages: https://developer.chrome.com/docs/extensions/reference/manifest/sandbox (no extension APIs, unique origin, eval allowed, CSP must have `sandbox` and no `allow-same-origin`).
- SES 2.3.0 (`npm view ses version`): https://github.com/endojs/endo/tree/master/packages/ses (lockdown, Compartment, security claims and caveats).
- MetaMask Snaps execution environment (SES, permissions-gated globals): https://docs.metamask.io/snaps/learn/about-snaps/execution-environment/
- npm `dist.integrity` (SRI sha512): https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json
- Google OIDC: https://developers.google.com/identity/openid-connect/openid-connect and https://accounts.google.com/.well-known/openid-configuration (endpoints, `iss`, PKCE `S256`, RS256).
- Apple: https://appleid.apple.com/.well-known/openid-configuration (endpoints, `response_mode` incl. `form_post`, RS256, no PKCE advertised), https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens (token request, redirect URI must be https with a domain), https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret (ES256 client secret, ≤ 15777000 s).

## Tests

| Package | Command | New tests |
|---|---|---|
| plugins | `pnpm --filter @clip-wallet/plugins test` | 44: isolation under real SES (13), install/manifest/schema/registry (29), example plugin (2) |
| services/backup | `pnpm --filter @clip-wallet/service-backup test` | 22 OIDC tests (46 total), mocked token/JWKS endpoints, ID tokens signed offline (`test/oidc-fixtures.ts`) |
| backup-client | `pnpm --filter @clip-wallet/backup-client test` | 3 |
| engine | `test/social-signin.test.ts` | 3 |
| names | `PluginBackend` | 2 |
| features | Trade & earn | 2 |
| ui | social sign-in (3), plugins + approval notes (5), Explore Trade & earn (2) | 10 |

## Gaps

- The real iframe + offscreen wiring has no Chrome e2e: this stream did not touch the extension. The unit tests run the same runtime and SES in Node with an in-process channel.
- A plugin's infinite loop is handled by the offscreen-document timeout and close. That is designed, but untestable in-process.
- Apple's client secret expires every ≤ 6 months and must be re-minted (`services/backup/scripts/apple-client-secret.mjs`). Apple may refuse the shared workers.dev domain; a custom domain then fixes it.
- Google is asked for `openid email`, because Google's docs require email or profile. The email claim is discarded.
- Polymarket's domain couldn't be fetched from this network (DNS block); it is verified only from documentation.
- Plugin install is from npm only, with no publisher signatures beyond npm's integrity and the manifest hash. A reviewed allowlist is a likely next step before plugins leave Advanced mode.
